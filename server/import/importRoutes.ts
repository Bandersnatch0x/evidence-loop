/**
 * Import HTTP surface (T04). Not wired into server/index.ts — coordinator
 * mounts `tryHandleImportRoute` on `/api/import/*` during assembly (same
 * pattern as T02 auth + T03 question bank).
 *
 * Endpoints:
 *   POST /api/import/parse              upload document → ImportDraft
 *   GET  /api/import/drafts             list teacher's drafts
 *   GET  /api/import/drafts/:id         fetch one draft for review UI
 *   POST /api/import/drafts/:id/confirm teacher gate → Questions
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  SECURITY_WARNING_HEADER,
  SECURITY_WARNING_VALUE
} from '../auth/MockSessionProvider'
import type { SessionUser } from '../auth/SessionProvider'
import type { SubjectLanguage } from '../../shared/contracts'
import {
  ImportGateError,
  ImportNotFoundError,
  ImportOwnershipError,
  ImportParseError,
  IMPORT_PRIVACY_NOTICE,
  type ConfirmItemInput,
  type ImportService
} from './ImportService'

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  [SECURITY_WARNING_HEADER]: SECURITY_WARNING_VALUE
} as const

const MAX_BODY_BYTES = 8 * 1024 * 1024
const SUBJECTS: readonly SubjectLanguage[] = [
  'python',
  'math',
  'physics',
  'chemistry',
  'chinese',
  'english',
  'biology',
  'politics',
  'history',
  'geography'
]

export interface ImportRouteContext {
  importService: ImportService
  user: SessionUser
}

/**
 * Route dispatcher. Returns true when the request matched an import route
 * (and a response was written), false when the path is not ours.
 */
export async function tryHandleImportRoute(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  context: ImportRouteContext
): Promise<boolean> {
  if (!requestUrl.pathname.startsWith('/api/import')) {
    return false
  }

  if (context.user.role !== 'teacher' && context.user.role !== 'admin') {
    respondJson(response, 403, {
      error: 'Forbidden: import is teacher-private',
      privacyNotice: IMPORT_PRIVACY_NOTICE
    })
    return true
  }

  const authorId = context.user.userId
  const { pathname } = requestUrl

  try {
    // POST /api/import/parse
    if (request.method === 'POST' && pathname === '/api/import/parse') {
      const body = await readJsonBody(request)
      const parsed = parseUploadBody(body, authorId)
      const draft = await context.importService.parseDocument(parsed)
      respondJson(response, 201, {
        draft,
        privacyNotice: IMPORT_PRIVACY_NOTICE,
        requiresTeacherConfirmation: true
      })
      return true
    }

    // GET /api/import/drafts
    if (request.method === 'GET' && pathname === '/api/import/drafts') {
      respondJson(response, 200, {
        drafts: context.importService.listDrafts(authorId),
        privacyNotice: IMPORT_PRIVACY_NOTICE
      })
      return true
    }

    const draftMatch = pathname.match(/^\/api\/import\/drafts\/([^/]+)$/)
    if (request.method === 'GET' && draftMatch?.[1]) {
      const id = decodeURIComponent(draftMatch[1])
      const draft = context.importService.getDraft(id, authorId)
      respondJson(response, 200, {
        draft,
        usableForAssessment:
          context.importService.isUsableForAssessment(draft),
        privacyNotice: IMPORT_PRIVACY_NOTICE
      })
      return true
    }

    const confirmMatch = pathname.match(
      /^\/api\/import\/drafts\/([^/]+)\/confirm$/
    )
    if (request.method === 'POST' && confirmMatch?.[1]) {
      const id = decodeURIComponent(confirmMatch[1])
      const body = await readJsonBody(request)
      const items = parseConfirmItems(body)
      const result = context.importService.confirmDraft({
        draftId: id,
        authorId,
        items
      })
      respondJson(response, 200, {
        draft: result.draft,
        questions: result.questions,
        usableForAssessment: context.importService.isUsableForAssessment(
          result.draft
        )
      })
      return true
    }

    respondJson(response, 404, { error: 'Import route not found' })
    return true
  } catch (error) {
    return handleError(response, error)
  }
}

function handleError(response: ServerResponse, error: unknown): boolean {
  if (error instanceof ImportOwnershipError) {
    respondJson(response, 403, { error: error.message })
    return true
  }
  if (error instanceof ImportNotFoundError) {
    respondJson(response, 404, { error: error.message })
    return true
  }
  if (
    error instanceof ImportGateError ||
    error instanceof ImportParseError
  ) {
    respondJson(response, 400, { error: error.message })
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

function parseUploadBody(
  body: unknown,
  authorId: string
): {
  authorId: string
  questionBankId: string
  subject: SubjectLanguage
  filename: string
  bytes?: Buffer
  rawText?: string
  mimeType?: string
} {
  if (typeof body !== 'object' || body === null) {
    throw new ImportParseError('Request body must be a JSON object')
  }
  const record = body as Record<string, unknown>
  const questionBankId =
    typeof record.questionBankId === 'string' ? record.questionBankId : ''
  const subjectRaw = typeof record.subject === 'string' ? record.subject : ''
  const filename =
    typeof record.filename === 'string' ? record.filename : 'upload.bin'
  const mimeType =
    typeof record.mimeType === 'string' ? record.mimeType : undefined
  const rawText =
    typeof record.rawText === 'string' ? record.rawText : undefined
  const contentBase64 =
    typeof record.contentBase64 === 'string' ? record.contentBase64 : undefined

  if (!SUBJECTS.includes(subjectRaw as SubjectLanguage)) {
    throw new ImportParseError(`Unsupported subject: ${subjectRaw}`)
  }

  const result: {
    authorId: string
    questionBankId: string
    subject: SubjectLanguage
    filename: string
    bytes?: Buffer
    rawText?: string
    mimeType?: string
  } = {
    authorId,
    questionBankId,
    subject: subjectRaw as SubjectLanguage,
    filename
  }
  if (mimeType) result.mimeType = mimeType
  if (rawText !== undefined) result.rawText = rawText
  if (contentBase64) {
    try {
      result.bytes = Buffer.from(contentBase64, 'base64')
    } catch {
      throw new ImportParseError('contentBase64 is not valid base64')
    }
  }
  if (result.bytes === undefined && result.rawText === undefined) {
    throw new ImportParseError('Provide contentBase64 or rawText')
  }
  return result
}

function parseConfirmItems(body: unknown): ConfirmItemInput[] {
  if (typeof body !== 'object' || body === null) {
    throw new ImportGateError('Request body must be a JSON object')
  }
  const record = body as Record<string, unknown>
  if (!Array.isArray(record.items)) {
    throw new ImportGateError('items must be an array')
  }
  return record.items.map((entry, i) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new ImportGateError(`items[${i}] must be an object`)
    }
    const item = entry as Record<string, unknown>
    if (typeof item.index !== 'number' || !Number.isInteger(item.index)) {
      throw new ImportGateError(`items[${i}].index must be an integer`)
    }
    if (item.action !== 'confirm' && item.action !== 'skip') {
      throw new ImportGateError(
        `items[${i}].action must be 'confirm' or 'skip'`
      )
    }
    const out: ConfirmItemInput = {
      index: item.index,
      action: item.action
    }
    if (typeof item.stem === 'string') out.stem = item.stem
    if (typeof item.questionType === 'string') out.questionType = item.questionType
    if ('payload' in item) out.payload = item.payload
    if (Array.isArray(item.kpIds)) {
      out.kpIds = item.kpIds.filter(
        (kp): kp is string => typeof kp === 'string'
      )
    }
    if (typeof item.difficulty === 'number') out.difficulty = item.difficulty
    if (typeof item.termId === 'string') out.termId = item.termId
    return out
  })
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
