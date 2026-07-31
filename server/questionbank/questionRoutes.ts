import type { IncomingMessage, ServerResponse } from 'node:http'
import { ZodError } from 'zod'
import {
  SECURITY_WARNING_HEADER,
  SECURITY_WARNING_VALUE
} from '../auth/MockSessionProvider'
import type { SessionUser } from '../auth/SessionProvider'
import type { QuestionQuery } from './QuestionStore'
import {
  QuestionNotFoundError,
  QuestionOwnershipError,
  type AssembleByKpOptions,
  type QuestionBankService
} from './QuestionBankService'
import { QuestionValidationError, type QuestionDraft } from './questionValidation'
import { SolutionValidationError } from './solution'
import {
  generateVisualization,
  parseVisualization
} from './visualizationSchema'

/**
 * Independent HTTP routes for the T03 question bank. Kept out of the main
 * server assembly (server/index.ts) so the coordinator wires it in one place.
 * Exposes a single `handleQuestionBankApi` that returns true when it consumed
 * the request, false to let the main router continue.
 *
 * Every route is teacher-scoped: the question bank is teacher-private (共享出界),
 * so a non-teacher session is refused with 403 and reads/writes are always
 * scoped by the resolved teacher's id.
 */

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  [SECURITY_WARNING_HEADER]: SECURITY_WARNING_VALUE
} as const

const MAX_BODY_BYTES = 256 * 1024

export interface QuestionBankRouteContext {
  questionBank: QuestionBankService
  user: SessionUser
}

/**
 * Route dispatcher. Returns true when the request matched a question-bank route
 * (and a response was written), false when the path is not ours.
 */
export async function handleQuestionBankApi(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  context: QuestionBankRouteContext
): Promise<boolean> {
  const { pathname } = requestUrl
  if (!pathname.startsWith('/api/questions') && !pathname.startsWith('/api/papers')) {
    return false
  }

  // Question bank is teacher-private. Only teachers (and admins for demo
  // parity) may touch it; students never see another user's private bank.
  if (context.user.role !== 'teacher' && context.user.role !== 'admin') {
    respondJson(response, 403, {
      error: 'Forbidden: question bank is teacher-private'
    })
    return true
  }

  const authorId = context.user.userId

  try {
    // POST /api/questions — create from hand-entry.
    if (request.method === 'POST' && pathname === '/api/questions') {
      const body = await readJsonBody(request)
      const draft = toDraft(body, authorId)
      const created = context.questionBank.create(draft)
      respondJson(response, 201, created)
      return true
    }

    // GET /api/questions — list the teacher's bank (with filters).
    if (request.method === 'GET' && pathname === '/api/questions') {
      const filters = parseListFilters(requestUrl)
      respondJson(response, 200, context.questionBank.list(authorId, filters))
      return true
    }

    // POST /api/papers/assemble — manual or KP-based assembly.
    if (request.method === 'POST' && pathname === '/api/papers/assemble') {
      const body = await readJsonBody(request)
      const paper = assemble(context.questionBank, authorId, body)
      respondJson(response, 201, paper)
      return true
    }

    const idMatch = pathname.match(/^\/api\/questions\/([^/]+)$/)
    if (idMatch?.[1]) {
      const id = decodeURIComponent(idMatch[1])
      if (request.method === 'GET') {
        respondJson(response, 200, context.questionBank.get(id, authorId))
        return true
      }
      if (request.method === 'PATCH' || request.method === 'PUT') {
        const body = await readJsonBody(request)
        const patch = toPatch(body, authorId)
        respondJson(response, 200, context.questionBank.update(id, authorId, patch))
        return true
      }
      if (request.method === 'DELETE') {
        const deleted = context.questionBank.delete(id, authorId)
        respondJson(response, deleted ? 200 : 404, { id, deleted })
        return true
      }
    }

    const solutionMatch = pathname.match(/^\/api\/questions\/([^/]+)\/solution$/)
    if (solutionMatch?.[1]) {
      const id = decodeURIComponent(solutionMatch[1])
      if (request.method === 'GET') {
        const solution = context.questionBank.getSolution(id, authorId)
        // No solution → 待补; report the tutoring degradation explicitly (T09).
        respondJson(response, 200, {
          solution: solution ?? null,
          tutoring: context.questionBank.tutoringContextFor(id, authorId)
        })
        return true
      }
    }

    // POST /api/questions/:id/adopt-solution — T09 promote AI draft → authored.
    const adoptMatch = pathname.match(
      /^\/api\/questions\/([^/]+)\/adopt-solution$/
    )
    if (request.method === 'POST' && adoptMatch?.[1]) {
      const id = decodeURIComponent(adoptMatch[1])
      const body = await readJsonBody(request)
      if (typeof body !== 'object' || body === null) {
        throw new QuestionValidationError('Request body must be a JSON object')
      }
      const record = body as Record<string, unknown>
      if (typeof record.content !== 'string' || record.content.trim() === '') {
        throw new QuestionValidationError(
          'adopt-solution requires a non-empty content string'
        )
      }
      let keyPoints: string[] | undefined
      if (Array.isArray(record.keyPoints)) {
        const points = record.keyPoints.filter(
          (point): point is string => typeof point === 'string'
        )
        if (points.length === record.keyPoints.length) {
          keyPoints = points
        }
      }
      const latex =
        typeof record.latex === 'string' ? record.latex : undefined
      const updated = context.questionBank.adoptSolution(id, authorId, {
        content: record.content,
        latex,
        keyPoints
      })
      respondJson(response, 200, {
        question: updated,
        solution: updated.solution ?? null,
        tutoring: context.questionBank.tutoringContextFor(id, authorId)
      })
      return true
    }

    // POST /api/questions/:id/preview-visualization — LLM proposes a ball-stick
    // geometry from a teacher's natural-language description. NOT persisted;
    // the teacher must adopt-visualization to store it (ADR-0015).
    const previewVizMatch = pathname.match(
      /^\/api\/questions\/([^/]+)\/preview-visualization$/
    )
    if (request.method === 'POST' && previewVizMatch?.[1]) {
      const id = decodeURIComponent(previewVizMatch[1])
      const body = await readJsonBody(request)
      if (typeof body !== 'object' || body === null) {
        throw new QuestionValidationError('Request body must be a JSON object')
      }
      const record = body as Record<string, unknown>
      if (typeof record.description !== 'string') {
        throw new QuestionValidationError(
          'preview-visualization requires a description string'
        )
      }
      // Assert the question exists + is owned by this teacher before spending
      // an LLM call on it.
      context.questionBank.get(id, authorId)
      const result = await generateVisualization(record.description)
      if (!result.ok) {
        respondJson(response, 422, { error: result.message, reason: result.reason })
        return true
      }
      respondJson(response, 200, {
        visualization: result.visualization,
        warnings: result.warnings
      })
      return true
    }

    // POST /api/questions/:id/adopt-visualization — confirm a previewed geometry
    // and store it on the question. Pass visualization: null to clear.
    const adoptVizMatch = pathname.match(
      /^\/api\/questions\/([^/]+)\/adopt-visualization$/
    )
    if (request.method === 'POST' && adoptVizMatch?.[1]) {
      const id = decodeURIComponent(adoptVizMatch[1])
      const body = await readJsonBody(request)
      if (typeof body !== 'object' || body === null) {
        throw new QuestionValidationError('Request body must be a JSON object')
      }
      const record = body as Record<string, unknown>
      let visualization
      if (record.visualization === null) {
        visualization = null
      } else {
        visualization = parseVisualization(record.visualization)
      }
      const updated = context.questionBank.adoptVisualization(id, authorId, visualization)
      respondJson(response, 200, { question: updated })
      return true
    }

    respondJson(response, 404, { error: 'Question bank route not found' })
    return true
  } catch (error) {
    return handleError(response, error)
  }
}

function handleError(response: ServerResponse, error: unknown): boolean {
  if (error instanceof QuestionOwnershipError) {
    respondJson(response, 403, { error: error.message })
    return true
  }
  if (error instanceof QuestionNotFoundError) {
    respondJson(response, 404, { error: error.message })
    return true
  }
  if (
    error instanceof QuestionValidationError ||
    error instanceof SolutionValidationError
  ) {
    respondJson(response, 400, { error: error.message })
    return true
  }
  if (error instanceof ZodError) {
    // visualizationSchema / payload parse failures are client errors, not 500.
    const first = error.issues[0]?.message ?? '校验失败'
    respondJson(response, 400, { error: first, issues: error.issues })
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

function toDraft(body: unknown, authorId: string): QuestionDraft {
  if (typeof body !== 'object' || body === null) {
    throw new QuestionValidationError('Request body must be a JSON object')
  }
  const record = body as Record<string, unknown>
  // authorId always comes from the session — never trust a client-supplied one.
  return {
    questionBankId: asString(record.questionBankId),
    authorId,
    subject: asString(record.subject),
    questionType: asString(record.questionType),
    stem: asString(record.stem),
    payload: record.payload,
    kpIds: record.kpIds,
    difficulty: record.difficulty,
    source: record.source,
    termId: typeof record.termId === 'string' ? record.termId : undefined,
    solution: stampSolutionAuthor(record.solution, authorId)
  }
}

/** Coerce a JSON field to a string; non-strings become '' so validation rejects them. */
function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function toPatch(body: unknown, authorId: string): Partial<QuestionDraft> {
  if (typeof body !== 'object' || body === null) {
    throw new QuestionValidationError('Request body must be a JSON object')
  }
  const record = body as Record<string, unknown>
  const patch: Partial<QuestionDraft> = {}
  if (typeof record.questionBankId === 'string') patch.questionBankId = record.questionBankId
  if (typeof record.subject === 'string') patch.subject = record.subject
  if (typeof record.questionType === 'string') patch.questionType = record.questionType
  if (typeof record.stem === 'string') patch.stem = record.stem
  if ('payload' in record) patch.payload = record.payload
  if ('kpIds' in record) patch.kpIds = record.kpIds
  if ('difficulty' in record) patch.difficulty = record.difficulty
  if ('source' in record) patch.source = record.source
  if (typeof record.termId === 'string') patch.termId = record.termId
  // Distinguish "clear solution" (explicit null) from "leave unchanged".
  // Stamp session authorId so clients need not (and cannot) spoof solution ownership.
  if ('solution' in record) {
    patch.solution =
      record.solution === null
        ? undefined
        : stampSolutionAuthor(record.solution, authorId)
  }
  return patch
}

/**
 * Force StandardSolution.authorId to the session teacher. Clients may omit it
 * or send a placeholder; never trust a foreign authorId on the solution.
 * null/undefined pass through (clear / leave-unset semantics).
 */
function stampSolutionAuthor(solution: unknown, authorId: string): unknown {
  if (solution === null || solution === undefined) return solution
  if (typeof solution !== 'object') return solution
  return {
    ...(solution as Record<string, unknown>),
    authorId,
    source: 'authored'
  }
}

function assemble(
  service: QuestionBankService,
  authorId: string,
  body: unknown
) {
  if (typeof body !== 'object' || body === null) {
    throw new QuestionValidationError('Request body must be a JSON object')
  }
  const record = body as Record<string, unknown>
  const mode = record.mode

  if (mode === 'manual') {
    const ids = record.questionIds
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
      throw new QuestionValidationError('manual assembly requires questionIds: string[]')
    }
    const title = typeof record.title === 'string' ? record.title : undefined
    return service.assembleManual(authorId, ids as string[], title)
  }

  if (mode === 'by_kp') {
    const kpIds = record.kpIds
    if (!Array.isArray(kpIds) || kpIds.some((kp) => typeof kp !== 'string')) {
      throw new QuestionValidationError('by_kp assembly requires kpIds: string[]')
    }
    const options: AssembleByKpOptions = {
      authorId,
      kpIds: kpIds as string[]
    }
    if (typeof record.minDifficulty === 'number') options.minDifficulty = record.minDifficulty
    if (typeof record.maxDifficulty === 'number') options.maxDifficulty = record.maxDifficulty
    if (typeof record.limit === 'number') options.limit = record.limit
    if (typeof record.title === 'string') options.title = record.title
    return service.assembleByKnowledgePoints(options)
  }

  throw new QuestionValidationError("assembly mode must be 'manual' or 'by_kp'")
}

function parseListFilters(requestUrl: URL): Omit<QuestionQuery, 'authorId'> {
  const filters: Omit<QuestionQuery, 'authorId'> = {}
  const subject = requestUrl.searchParams.get('subject')
  if (subject) filters.subject = subject as QuestionQuery['subject']
  const questionType = requestUrl.searchParams.get('questionType')
  if (questionType) filters.questionType = questionType as QuestionQuery['questionType']
  const questionBankId = requestUrl.searchParams.get('questionBankId')
  if (questionBankId) filters.questionBankId = questionBankId
  const kpIdsRaw = requestUrl.searchParams.get('kpIds')
  if (kpIdsRaw) filters.kpIds = kpIdsRaw.split(',').filter((kp) => kp.trim() !== '')
  const minDifficulty = numberParam(requestUrl.searchParams.get('minDifficulty'))
  if (minDifficulty !== undefined) filters.minDifficulty = minDifficulty
  const maxDifficulty = numberParam(requestUrl.searchParams.get('maxDifficulty'))
  if (maxDifficulty !== undefined) filters.maxDifficulty = maxDifficulty
  return filters
}

function numberParam(value: string | null): number | undefined {
  if (value === null || value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
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
