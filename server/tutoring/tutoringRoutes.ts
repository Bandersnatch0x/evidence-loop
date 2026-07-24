import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import {
  SECURITY_WARNING_HEADER,
  SECURITY_WARNING_VALUE
} from '../auth/MockSessionProvider'
import type { SessionUser } from '../auth/SessionProvider'
import type { StandardSolution, TutoringLayer } from '../../shared/contracts'
import {
  TutoringModeError,
  TutoringNotFoundError,
  type TutoringService
} from './TutoringService'

/**
 * HTTP surface for T05 tutoring.
 *
 * - POST /api/tutoring/explain
 * - POST /api/tutoring/socratic
 * - POST /api/tutoring/dialogue
 *
 * Mounted independently (same pattern as adaptive/auth) so assembly can wire
 * AttemptStore + session without bloating server/index.ts.
 */

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  [SECURITY_WARNING_HEADER]: SECURITY_WARNING_VALUE
} as const

const MAX_BODY_BYTES = 256 * 1024

const solutionSchema = z
  .object({
    content: z.string().min(1).max(20_000),
    latex: z.string().max(8_000).optional(),
    keyPoints: z.array(z.string().max(2_000)).max(50).optional(),
    authorId: z.string().min(1),
    source: z.literal('authored')
  })
  .optional()

const turnSchema = z.object({
  role: z.enum(['assistant', 'user']),
  content: z.string().min(1).max(4_000)
})

const baseSchema = z.object({
  attemptId: z.string().min(1).max(128),
  mode: z.enum(['practice', 'assessment']),
  solution: solutionSchema
})

const explainSchema = baseSchema

const socraticSchema = baseSchema.extend({
  message: z.string().min(1).max(2_000),
  history: z.array(turnSchema).max(20).optional(),
  lowEffortStreak: z.number().int().min(0).max(20).optional()
})

const dialogueSchema = baseSchema.extend({
  message: z.string().min(1).max(2_000),
  history: z.array(turnSchema).max(20).optional(),
  priorSummary: z.string().max(500).optional()
})

export interface TutoringRouteContext {
  tutoring: TutoringService
  user: SessionUser
}

/**
 * Returns true when the request was consumed (response written).
 */
export async function handleTutoringApi(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  context: TutoringRouteContext
): Promise<boolean> {
  const { pathname } = requestUrl
  if (!pathname.startsWith('/api/tutoring')) {
    return false
  }

  try {
    if (request.method !== 'POST') {
      respondJson(response, 405, { error: 'Method not allowed' })
      return true
    }

    if (pathname === '/api/tutoring/explain') {
      await handleLayer(request, response, context, 'explain', explainSchema)
      return true
    }
    if (pathname === '/api/tutoring/socratic') {
      await handleLayer(request, response, context, 'socratic', socraticSchema)
      return true
    }
    if (pathname === '/api/tutoring/dialogue') {
      await handleLayer(request, response, context, 'dialogue', dialogueSchema)
      return true
    }

    respondJson(response, 404, { error: 'Tutoring route not found' })
    return true
  } catch (error) {
    return handleError(response, error)
  }
}

async function handleLayer(
  request: IncomingMessage,
  response: ServerResponse,
  context: TutoringRouteContext,
  layer: TutoringLayer,
  schema: z.ZodType<{
    attemptId: string
    mode: 'practice' | 'assessment'
    message?: string
    history?: Array<{ role: 'assistant' | 'user'; content: string }>
    priorSummary?: string
    lowEffortStreak?: number
    solution?: StandardSolution
  }>
): Promise<void> {
  // Students (and teachers reviewing) may use tutoring; anonymous mock sessions
  // already resolve a demo user via SessionProvider.
  if (!context.user.userId) {
    respondJson(response, 401, { error: 'Unauthorized' })
    return
  }

  const body = await readJsonBody(request)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    respondJson(response, 400, {
      error: 'Invalid tutoring request',
      details: parsed.error.issues.map(
        (issue) => `${issue.path.join('.')}: ${issue.message}`
      )
    })
    return
  }

  const data = parsed.data
  const result = await context.tutoring.handle({
    attemptId: data.attemptId,
    mode: data.mode,
    layer,
    message: data.message,
    history: data.history,
    priorSummary: data.priorSummary,
    lowEffortStreak: data.lowEffortStreak,
    solution: data.solution
  })
  respondJson(response, 200, result)
}

function handleError(response: ServerResponse, error: unknown): boolean {
  if (error instanceof TutoringModeError) {
    respondJson(response, error.statusCode, { error: error.message })
    return true
  }
  if (error instanceof TutoringNotFoundError) {
    respondJson(response, 404, { error: error.message })
    return true
  }
  if (error instanceof BodyTooLargeError) {
    respondJson(response, 413, { error: error.message })
    return true
  }
  if (error instanceof MalformedJsonError) {
    respondJson(response, 400, { error: error.message })
    return true
  }
  console.error(error)
  respondJson(response, 500, { error: 'Internal server error' })
  return true
}

class BodyTooLargeError extends Error {}
class MalformedJsonError extends Error {}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Uint8Array[] = []
  let size = 0
  const declaredSize = Number(request.headers['content-length'] ?? 0)
  if (Number.isFinite(declaredSize) && declaredSize > MAX_BODY_BYTES) {
    throw new BodyTooLargeError('Request body is too large')
  }
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) {
      throw new BodyTooLargeError('Request body is too large')
    }
    chunks.push(buffer)
  }
  const body = Buffer.concat(chunks).toString('utf8')
  if (body.length === 0) return {}
  try {
    return JSON.parse(body) as unknown
  } catch {
    throw new MalformedJsonError('Malformed JSON request body')
  }
}

function respondJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown
): void {
  response.writeHead(statusCode, JSON_HEADERS)
  response.end(JSON.stringify(payload))
}
