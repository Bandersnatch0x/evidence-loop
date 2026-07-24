import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import {
  SECURITY_WARNING_HEADER,
  SECURITY_WARNING_VALUE
} from '../auth/MockSessionProvider'
import type { SessionUser } from '../auth/SessionProvider'
import type {
  CreateAssignmentInput,
  CreateTeacherTipInput,
  CreateTeachingUnitInput,
  GradeSubjectiveInput,
  RosterRow
} from '../../shared/contracts'
import { AssignmentError, type AssignmentService } from './AssignmentService'
import {
  SubjectiveGradingError,
  type SubjectiveGradingService
} from './SubjectiveGradingService'
import { TeachingUnitError, type TeachingUnitService } from './TeachingUnitService'
import {
  StudentImportError,
  type StudentImportService
} from './StudentImportService'
import { TeacherTipError, type TeacherTipService } from './TeacherTipService'

/**
 * HTTP surface for T08 teacher workflow + T14 tips.
 *
 * - POST /api/teacher/teaching-units          — create a teaching unit
 * - GET  /api/teacher/teaching-units          — list units for this teacher
 * - GET  /api/teacher/teaching-units/:id      — view a teaching unit
 * - POST /api/teacher/roster/import            — import student roster
 * - POST /api/teacher/assignments             — create an assignment (3 shapes)
 * - GET  /api/teacher/grading/:teachingUnitId  — subjective grading queue
 * - POST /api/teacher/grading/:attemptId       — teacher final adjudication
 * - POST /api/teacher/tips                    — batch tip fan-out (T14)
 * - GET  /api/teacher/tips?teachingUnitId=    — list tips + read counts (T14)
 *
 * Teacher-scoped: every write is bound to the resolved teacher's userId, and
 * the主观题 grading path takes exactly ONE attemptId per call (no batch —
 * 守铁律: 主观题不可批量给分). Tips are messages, not scores — batch OK.
 */

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  [SECURITY_WARNING_HEADER]: SECURITY_WARNING_VALUE
} as const

const MAX_BODY_BYTES = 256 * 1024

const createUnitSchema = z.object({
  classId: z.string().min(1).max(128),
  subjectId: z.string().min(1).max(128),
  termId: z.string().min(1).max(128),
  taughtKpIds: z.array(z.string().min(1).max(128)).max(500)
})

const rosterRowSchema = z.object({
  studentNumber: z.string().min(1).max(64),
  displayName: z.string().min(1).max(128)
})

const importRosterSchema = z.object({
  teachingUnitId: z.string().min(1).max(128),
  rows: z.array(rosterRowSchema).min(1).max(1000)
})

const assignmentSchema = z.object({
  teachingUnitId: z.string().min(1).max(128),
  mode: z.enum(['practice', 'assessment']),
  kind: z.enum(['handpick', 'assemble_by_kp', 'by_weakness']),
  questionIds: z.array(z.string().min(1).max(128)).max(200).optional(),
  kpIds: z.array(z.string().min(1).max(128)).max(200).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  studentIds: z.array(z.string().min(1).max(128)).max(500).optional(),
  title: z.string().min(1).max(200).optional(),
  /** ISO-8601 deadline (T12/P1). */
  dueAt: z.string().min(1).max(64).optional()
})

const gradeSchema = z.object({
  subjectiveScore: z.number().min(0).max(1000),
  subjectiveMaxScore: z.number().int().positive().max(1000),
  note: z.string().min(1).max(2000)
})

const createTipSchema = z.object({
  teachingUnitId: z.string().min(1).max(128),
  body: z.string().min(1).max(2000),
  studentIds: z.array(z.string().min(1).max(128)).max(500).optional(),
  kpIds: z.array(z.string().min(1).max(128)).max(200).optional(),
  paperId: z.string().min(1).max(128).optional(),
  questionId: z.string().min(1).max(128).optional()
})

export interface TeacherRouteContext {
  teachingUnits: TeachingUnitService
  roster: StudentImportService
  assignments: AssignmentService
  grading: SubjectiveGradingService
  tips: TeacherTipService
  user: SessionUser
}

export async function handleTeacherApi(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  context: TeacherRouteContext
): Promise<boolean> {
  const { pathname } = requestUrl
  if (!pathname.startsWith('/api/teacher/')) return false

  // Teacher workflow is teacher-only (admin has demo parity).
  if (context.user.role !== 'teacher' && context.user.role !== 'admin') {
    respondJson(response, 403, {
      error: 'Forbidden: teacher routes require a teacher session'
    })
    return true
  }
  const teacherId = context.user.userId

  // POST /api/teacher/teaching-units
  if (request.method === 'POST' && pathname === '/api/teacher/teaching-units') {
    const parsed = createUnitSchema.safeParse(await readJsonBody(request))
    if (!parsed.success) {
      respondJson(response, 400, {
        error: 'Invalid teaching unit request',
        details: parsed.error.issues.map((issue) => issue.message)
      })
      return true
    }
    const input: CreateTeachingUnitInput = parsed.data
    const unit = context.teachingUnits.create(input, teacherId)
    respondJson(response, 201, unit)
    return true
  }

  // GET /api/teacher/teaching-units — list units owned by this teacher
  if (request.method === 'GET' && pathname === '/api/teacher/teaching-units') {
    const units = context.teachingUnits.listForTeacher(teacherId)
    respondJson(response, 200, units)
    return true
  }

  // GET /api/teacher/teaching-units/:id
  const unitViewMatch = pathname.match(
    /^\/api\/teacher\/teaching-units\/([^/]+)$/
  )
  if (request.method === 'GET' && unitViewMatch?.[1]) {
    try {
      const view = context.teachingUnits.getView(
        decodeURIComponent(unitViewMatch[1]),
        teacherId
      )
      respondJson(response, 200, view)
    } catch (error) {
      respondServiceError(response, error, 403)
    }
    return true
  }

  // POST /api/teacher/roster/import
  if (request.method === 'POST' && pathname === '/api/teacher/roster/import') {
    const parsed = importRosterSchema.safeParse(await readJsonBody(request))
    if (!parsed.success) {
      respondJson(response, 400, {
        error: 'Invalid roster import request',
        details: parsed.error.issues.map((issue) => issue.message)
      })
      return true
    }
    const rows: RosterRow[] = parsed.data.rows
    try {
      const result = context.roster.import(
        { userId: teacherId, role: context.user.role },
        parsed.data.teachingUnitId,
        rows
      )
      respondJson(response, 201, result)
    } catch (error) {
      respondServiceError(response, error, 422)
    }
    return true
  }

  // POST /api/teacher/assignments
  if (request.method === 'POST' && pathname === '/api/teacher/assignments') {
    const parsed = assignmentSchema.safeParse(await readJsonBody(request))
    if (!parsed.success) {
      respondJson(response, 400, {
        error: 'Invalid assignment request',
        details: parsed.error.issues.map((issue) => issue.message)
      })
      return true
    }
    const input: CreateAssignmentInput = parsed.data
    try {
      const result = await context.assignments.create(input, teacherId)
      respondJson(response, 201, result)
    } catch (error) {
      respondServiceError(response, error, 422)
    }
    return true
  }

  // GET /api/teacher/grading/:teachingUnitId
  const gradingQueueMatch = pathname.match(
    /^\/api\/teacher\/grading\/([^/]+)$/
  )
  if (request.method === 'GET' && gradingQueueMatch?.[1]) {
    try {
      const items = await context.grading.queue(
        decodeURIComponent(gradingQueueMatch[1]),
        teacherId
      )
      respondJson(response, 200, items)
    } catch (error) {
      respondServiceError(response, error, 403)
    }
    return true
  }

  // POST /api/teacher/grading/:attemptId — exactly ONE item per call (no batch)
  const gradeMatch = pathname.match(/^\/api\/teacher\/grading\/([^/]+)$/)
  if (request.method === 'POST' && gradeMatch?.[1]) {
    const attemptId = decodeURIComponent(gradeMatch[1])
    const parsed = gradeSchema.safeParse(await readJsonBody(request))
    if (!parsed.success) {
      respondJson(response, 400, {
        error: 'Invalid grade request',
        details: parsed.error.issues.map((issue) => issue.message)
      })
      return true
    }
    const input: GradeSubjectiveInput = {
      attemptId,
      ...parsed.data
    }
    try {
      const result = await context.grading.grade(input, teacherId)
      respondJson(response, 200, result)
    } catch (error) {
      respondServiceError(response, error, 422)
    }
    return true
  }

  // POST /api/teacher/tips — batch tip fan-out (T14; messages, not scores)
  if (request.method === 'POST' && pathname === '/api/teacher/tips') {
    const parsed = createTipSchema.safeParse(await readJsonBody(request))
    if (!parsed.success) {
      respondJson(response, 400, {
        error: 'Invalid tip request',
        details: parsed.error.issues.map((issue) => issue.message)
      })
      return true
    }
    const input: CreateTeacherTipInput = parsed.data
    try {
      const result = context.tips.send(input, teacherId)
      respondJson(response, 201, result)
    } catch (error) {
      respondTipError(response, error)
    }
    return true
  }

  // GET /api/teacher/tips?teachingUnitId=
  if (request.method === 'GET' && pathname === '/api/teacher/tips') {
    const teachingUnitId = requestUrl.searchParams.get('teachingUnitId')
    if (!teachingUnitId) {
      respondJson(response, 400, {
        error: 'teachingUnitId query parameter is required'
      })
      return true
    }
    try {
      const list = context.tips.listForTeacher(teachingUnitId, teacherId)
      respondJson(response, 200, list)
    } catch (error) {
      respondTipError(response, error)
    }
    return true
  }

  respondJson(response, 404, { error: 'Teacher route not found' })
  return true
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Uint8Array[] = []
  let size = 0
  const declaredSize = Number(request.headers['content-length'] ?? 0)
  if (Number.isFinite(declaredSize) && declaredSize > MAX_BODY_BYTES) {
    throw new TeacherHttpError(413, 'Request body is too large')
  }
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) {
      throw new TeacherHttpError(413, 'Request body is too large')
    }
    chunks.push(buffer)
  }
  const body = Buffer.concat(chunks).toString('utf8')
  if (body.length === 0) return {}
  try {
    return JSON.parse(body) as unknown
  } catch {
    throw new TeacherHttpError(400, 'Malformed JSON request body')
  }
}

class TeacherHttpError extends Error {
  public constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message)
  }
}

/**
 * Dispatch a service-layer error to an HTTP status. Domain errors
 * (TeachingUnitError / AssignmentError / SubjectiveGradingError) map to
 * 403/422 with their own message; unknown errors (storage I/O, JSON
 * serialization, undefined fields) log + fall back to 500 instead of being
 * silently misclassified as business-validation failures.
 */
function respondServiceError(
  response: ServerResponse,
  error: unknown,
  domainStatus: 403 | 422
): void {
  if (
    error instanceof TeachingUnitError ||
    error instanceof AssignmentError ||
    error instanceof SubjectiveGradingError ||
    error instanceof StudentImportError ||
    error instanceof TeacherTipError
  ) {
    respondJson(response, domainStatus, { error: error.message })
    return
  }
  console.error('teacher service error:', error)
  respondJson(response, 500, { error: 'Internal server error' })
}

/**
 * Tip errors: ownership → 403; validation/enrollment → 422.
 */
function respondTipError(response: ServerResponse, error: unknown): void {
  if (error instanceof TeacherTipError) {
    const forbidden = error.message.startsWith('Forbidden:')
    respondJson(response, forbidden ? 403 : 422, { error: error.message })
    return
  }
  console.error('teacher tip error:', error)
  respondJson(response, 500, { error: 'Internal server error' })
}

function respondJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown
): void {
  response.writeHead(statusCode, JSON_HEADERS)
  response.end(JSON.stringify(payload))
}
