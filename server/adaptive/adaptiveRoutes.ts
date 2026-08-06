import type { IncomingMessage, ServerResponse } from 'node:http'
import { respondJson } from '../http/httpUtils'
import type { Database } from 'better-sqlite3'
import type { SessionUser } from '../auth/SessionProvider'
import { authorizeAccess } from '../auth/authorization'
import {
  AssignByWeaknessError,
  type AssignByWeaknessService
} from './AssignByWeaknessService'
import type { NextPracticeService } from './NextPracticeService'
import { TeachingUnitNotFoundError } from './OrgReader'

/**
 * HTTP surface for the T06 adaptive loop. Kept out of server/index.ts so the
 * coordinator can mount it in one place (same pattern as T02 auth / T03 bank).
 *
 * - GET  /api/adaptive/next?studentId=&unitId=
 * - POST /api/adaptive/assign-weakness
 */

const MAX_BODY_BYTES = 256 * 1024

export interface AdaptiveRouteContext {
  db: Database
  nextPractice: NextPracticeService
  assignByWeakness: AssignByWeaknessService
  user: SessionUser
}

/**
 * Returns true when the request was consumed (response written), false when
 * the path is not under /api/adaptive.
 */
export async function handleAdaptiveApi(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  context: AdaptiveRouteContext
): Promise<boolean> {
  const { pathname } = requestUrl
  if (!pathname.startsWith('/api/adaptive')) {
    return false
  }

  try {
    if (request.method === 'GET' && pathname === '/api/adaptive/next') {
      await handleNext(requestUrl, response, context)
      return true
    }

    if (
      request.method === 'POST' &&
      pathname === '/api/adaptive/assign-weakness'
    ) {
      await handleAssignWeakness(request, response, context)
      return true
    }

    respondJson(response, 404, { error: 'Adaptive route not found' })
    return true
  } catch (error) {
    return handleError(response, error)
  }
}

async function handleNext(
  requestUrl: URL,
  response: ServerResponse,
  context: AdaptiveRouteContext
): Promise<void> {
  const studentId = requestUrl.searchParams.get('studentId')?.trim() ?? ''
  const unitId =
    requestUrl.searchParams.get('unitId')?.trim() ??
    requestUrl.searchParams.get('teachingUnitId')?.trim() ??
    ''

  if (studentId === '' || unitId === '') {
    respondJson(response, 400, {
      error: 'studentId and unitId query parameters are required'
    })
    return
  }

  const access = authorizeAccess(context.db, context.user, {
    purpose: 'student-data',
    studentId
  })
  if (!access.allowed) {
    respondJson(response, 403, {
      error: 'Forbidden: cannot view practice plan for this student'
    })
    return
  }

  const plan = await context.nextPractice.generate(studentId, unitId)
  respondJson(response, 200, plan)
}

async function handleAssignWeakness(
  request: IncomingMessage,
  response: ServerResponse,
  context: AdaptiveRouteContext
): Promise<void> {
  const access = authorizeAccess(context.db, context.user, {
    purpose: 'teaching'
  })
  if (!access.allowed) {
    respondJson(response, 403, {
      error: 'Forbidden: only teachers may assign by weakness'
    })
    return
  }

  const body = await readJsonBody(request)
  if (typeof body !== 'object' || body === null) {
    respondJson(response, 400, { error: 'Request body must be a JSON object' })
    return
  }
  const record = body as Record<string, unknown>
  const teachingUnitId =
    typeof record.teachingUnitId === 'string' ? record.teachingUnitId.trim() : ''
  if (teachingUnitId === '') {
    respondJson(response, 400, { error: 'teachingUnitId is required' })
    return
  }

  const kpIds = asStringArray(record.kpIds)
  const studentIds = asStringArray(record.studentIds)
  const limit =
    typeof record.limit === 'number' && Number.isFinite(record.limit)
      ? record.limit
      : undefined
  const mode =
    record.mode === 'assessment' || record.mode === 'practice'
      ? record.mode
      : undefined

  const result = await context.assignByWeakness.assign({
    teachingUnitId,
    teacherId: context.user.userId,
    kpIds,
    studentIds,
    limit,
    mode
  })
  respondJson(response, 201, result)
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  if (value.some((item) => typeof item !== 'string')) return undefined
  return value as string[]
}

function handleError(response: ServerResponse, error: unknown): boolean {
  if (error instanceof TeachingUnitNotFoundError) {
    respondJson(response, 404, { error: error.message })
    return true
  }
  if (error instanceof AssignByWeaknessError) {
    const forbidden = error.message.startsWith('Forbidden')
    respondJson(response, forbidden ? 403 : 400, { error: error.message })
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
