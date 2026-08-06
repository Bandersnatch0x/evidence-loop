import type { IncomingMessage, ServerResponse } from 'node:http'
import { respondJson } from '../http/httpUtils'
import { z } from 'zod'
import type { SessionUser } from '../auth/SessionProvider'
import type { StartPracticeRequest } from '../../shared/contracts'
import type { TeacherTipService } from '../teacher/TeacherTipService'
import { TeacherTipError } from '../teacher/TeacherTipService'
import { generateVisualization } from '../questionbank/visualizationSchema'
import type { PracticeSessionService } from './PracticeSessionService'
import type { MistakeBookService } from './MistakeBookService'

/**
 * HTTP surface for T07 student practice + T14 tip inbox + ADR-0015 preview.
 *
 * - GET  /api/student/sessions       — list the student's practice sessions
 * - GET  /api/student/mistakes        — mistake book (active + mastered history)
 * - POST /api/student/practice        — start a fresh practice/assessment attempt
 * - POST /api/student/preview-visualization — LLM draft geometry (NOT persisted)
 * - GET  /api/student/tips            — teacher tip inbox (T14)
 * - POST /api/student/tips/:id/read   — mark tip read (T14)
 *
 * Student-scoped: every read is bound to the resolved session's studentId, so
 * a demo role switch can never leak another student's mistake book. Tutoring
 * enablement is derived server-side from the attempt's mode (D1) — the client
 * cannot claim tutoring in assessment mode.
 *
 * Student visualization generate is preview-only (never adopt/save) so scoring
 * and teacher authority stay untouched (ADR-0015 / PRODUCT.md).
 */

const MAX_BODY_BYTES = 256 * 1024

const startPracticeSchema = z.object({
  questionId: z.string().min(1).max(128),
  teachingUnitId: z.string().min(1).max(128),
  termId: z.string().min(1).max(128),
  mode: z.enum(['practice', 'assessment']),
  paperId: z.string().min(1).max(128).optional()
})

const previewVisualizationSchema = z.object({
  description: z.string().min(1).max(2000)
})

export interface StudentRouteContext {
  sessions: PracticeSessionService
  mistakes: MistakeBookService
  tips: TeacherTipService
  user: SessionUser
}

export async function handleStudentApi(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  context: StudentRouteContext
): Promise<boolean> {
  const { pathname } = requestUrl
  if (!pathname.startsWith('/api/student/')) return false

  const studentId = resolveStudentId(context.user)
  if (studentId === null) {
    respondJson(response, 403, {
      error: 'Forbidden: student routes require a student session'
    })
    return true
  }

  // GET /api/student/sessions
  if (request.method === 'GET' && pathname === '/api/student/sessions') {
    const sessions = await context.sessions.listSessions(studentId)
    respondJson(response, 200, sessions)
    return true
  }

  // GET /api/student/mistakes
  if (request.method === 'GET' && pathname === '/api/student/mistakes') {
    const view = await context.mistakes.view(studentId)
    respondJson(response, 200, view)
    return true
  }

  // POST /api/student/practice
  if (request.method === 'POST' && pathname === '/api/student/practice') {
    const parsed = startPracticeSchema.safeParse(await readJsonBody(request))
    if (!parsed.success) {
      respondJson(response, 400, {
        error: 'Invalid start-practice request',
        details: parsed.error.issues.map((issue) => issue.message)
      })
      return true
    }
    const input: StartPracticeRequest = parsed.data
    const result = await context.sessions.startPractice(input, studentId)
    respondJson(response, 201, result)
    return true
  }

  // POST /api/student/preview-visualization — ADR-0015 student draft (no save).
  if (
    request.method === 'POST' &&
    pathname === '/api/student/preview-visualization'
  ) {
    const parsed = previewVisualizationSchema.safeParse(
      await readJsonBody(request)
    )
    if (!parsed.success) {
      respondJson(response, 400, {
        error: 'preview-visualization requires a non-empty description',
        details: parsed.error.issues.map((issue) => issue.message)
      })
      return true
    }
    const result = await generateVisualization(parsed.data.description)
    if (!result.ok) {
      respondJson(response, 422, {
        error: result.message,
        reason: result.reason
      })
      return true
    }
    respondJson(response, 200, {
      visualization: result.visualization,
      warnings: result.warnings,
      // Explicit contract: students cannot persist visualization.
      persisted: false
    })
    return true
  }

  // GET /api/student/tips — inbox (unread first)
  if (request.method === 'GET' && pathname === '/api/student/tips') {
    const inbox = context.tips.listForStudent(studentId)
    respondJson(response, 200, inbox)
    return true
  }

  // POST /api/student/tips/:id/read
  const tipReadMatch = pathname.match(/^\/api\/student\/tips\/([^/]+)\/read$/)
  if (request.method === 'POST' && tipReadMatch?.[1]) {
    const tipId = decodeURIComponent(tipReadMatch[1])
    try {
      const item = context.tips.markRead(tipId, studentId)
      respondJson(response, 200, item)
    } catch (error) {
      if (error instanceof TeacherTipError) {
        respondJson(response, 404, { error: error.message })
      } else {
        console.error('student tip error:', error)
        respondJson(response, 500, { error: 'Internal server error' })
      }
    }
    return true
  }

  respondJson(response, 404, { error: 'Student route not found' })
  return true
}

function resolveStudentId(user: SessionUser): string | null {
  // Students are scoped by studentId; admin demo falls back to userId.
  if (user.role === 'student') return user.studentId ?? user.userId
  // Teachers/admins have no mistake book of their own.
  return null
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Uint8Array[] = []
  let size = 0
  const declaredSize = Number(request.headers['content-length'] ?? 0)
  if (Number.isFinite(declaredSize) && declaredSize > MAX_BODY_BYTES) {
    throw new HttpLikeError(413, 'Request body is too large')
  }
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) {
      throw new HttpLikeError(413, 'Request body is too large')
    }
    chunks.push(buffer)
  }
  const body = Buffer.concat(chunks).toString('utf8')
  if (body.length === 0) return {}
  try {
    return JSON.parse(body) as unknown
  } catch {
    throw new HttpLikeError(400, 'Malformed JSON request body')
  }
}

class HttpLikeError extends Error {
  public constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message)
  }
}
