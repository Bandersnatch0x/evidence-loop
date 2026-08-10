/**
 * T15 材料 → 草稿题 HTTP 层。未接进 server/index.ts —— 由主控在装配时把
 * `tryHandleMaterialImportRoute` 挂到 `/api/teacher/material-import/*`
 * （与 T04 import / T17 transparency 同一模式）。
 *
 * 端点：
 *   POST  /api/teacher/material-import                      投料 → 生成草稿
 *   GET   /api/teacher/material-import                      我的生成任务列表
 *   GET   /api/teacher/material-import/:jobId               任务 + 草稿列表
 *   POST  /api/teacher/material-import/:jobId/confirm-batch 批量确认（逐题走闸门）
 *   GET   /api/teacher/material-import/drafts/:id           单条草稿
 *   PATCH /api/teacher/material-import/drafts/:id           教师修正字段
 *   POST  /api/teacher/material-import/drafts/:id/confirm   校对闸门 → 入库
 *   POST  /api/teacher/material-import/drafts/:id/discard   丢弃
 *   GET   /api/teacher/material-import/drafts/:id/assessment-ref
 *         未确认 → 422（「未确认草稿不可用于测评」的服务端强制点）
 *
 * 铁律：本文件不返回、不接受任何 score / evidence 字段，也不引用任何计分模块。
 */
import { respondJson } from '../http/httpUtils'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { SessionUser } from '../auth/SessionProvider'
import type { SubjectLanguage } from '../../shared/contracts'
import {
  MATERIAL_IMPORT_GATE_NOTICE,
  type DraftQuestionOption,
  type MaterialSourceKind
} from '../../shared/materialImport'
import {
  MaterialImportGateError,
  MaterialImportInputError,
  MaterialImportNotFoundError,
  MaterialImportOwnershipError,
  type ConfirmDraftInput,
  type CreateMaterialJobInput,
  type DraftPatchInput,
  type MaterialImportService
} from './MaterialImportService'

const ROUTE_PREFIX = '/api/teacher/material-import'
const MAX_BODY_BYTES = 2 * 1024 * 1024

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

const SOURCE_KINDS: readonly MaterialSourceKind[] = [
  'paste',
  'text_file',
  'doc_parse'
]

export interface MaterialImportRouteContext {
  materialImportService: MaterialImportService
  user: SessionUser
}

/**
 * 路由分发器。命中并已写响应返回 true；路径不属于本模块返回 false。
 */
export async function tryHandleMaterialImportRoute(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  context: MaterialImportRouteContext
): Promise<boolean> {
  const { pathname } = requestUrl
  if (pathname !== ROUTE_PREFIX && !pathname.startsWith(`${ROUTE_PREFIX}/`)) {
    return false
  }

  if (context.user.role !== 'teacher' && context.user.role !== 'admin') {
    respondJson(response, 403, {
      error: 'Forbidden: material import is teacher-private',
      gateNotice: MATERIAL_IMPORT_GATE_NOTICE
    })
    return true
  }

  const teacherId = context.user.userId
  const service = context.materialImportService

  try {
    // POST /api/teacher/material-import
    if (request.method === 'POST' && pathname === ROUTE_PREFIX) {
      const body = await readJsonBody(request)
      const view = await service.createJob(parseCreateBody(body, teacherId))
      respondJson(response, 201, {
        ...view,
        // 生成物永远不是题库题，回包里显式声明。
        publishedToQuestionBank: false,
        requiresTeacherConfirmation: true
      })
      return true
    }

    // GET /api/teacher/material-import
    if (request.method === 'GET' && pathname === ROUTE_PREFIX) {
      respondJson(response, 200, {
        jobs: service.listJobs(teacherId),
        gateNotice: MATERIAL_IMPORT_GATE_NOTICE
      })
      return true
    }

    // GET /api/teacher/material-import/drafts/:id
    const draftMatch = matchPath(pathname, /^\/drafts\/([^/]+)$/)
    if (draftMatch && request.method === 'GET') {
      const draft = service.getDraft(draftMatch, teacherId)
      respondJson(response, 200, {
        draft,
        usableForAssessment: service.isDraftAssessable(draft),
        gateNotice: MATERIAL_IMPORT_GATE_NOTICE
      })
      return true
    }

    // PATCH /api/teacher/material-import/drafts/:id
    if (draftMatch && request.method === 'PATCH') {
      const body = await readJsonBody(request)
      const draft = service.patchDraft(draftMatch, teacherId, parsePatch(body))
      respondJson(response, 200, {
        draft,
        usableForAssessment: service.isDraftAssessable(draft),
        gateNotice: MATERIAL_IMPORT_GATE_NOTICE
      })
      return true
    }

    // POST /api/teacher/material-import/drafts/:id/confirm
    const confirmMatch = matchPath(pathname, /^\/drafts\/([^/]+)\/confirm$/)
    if (confirmMatch && request.method === 'POST') {
      const body = await readJsonBody(request)
      const result = service.confirmDraft(
        confirmMatch,
        teacherId,
        parseConfirm(body)
      )
      respondJson(response, 200, {
        draft: result.draft,
        question: result.question,
        job: result.job,
        usableForAssessment: service.isDraftAssessable(result.draft)
      })
      return true
    }

    // POST /api/teacher/material-import/drafts/:id/discard
    const discardMatch = matchPath(pathname, /^\/drafts\/([^/]+)\/discard$/)
    if (discardMatch && request.method === 'POST') {
      const result = service.discardDraft(discardMatch, teacherId)
      respondJson(response, 200, {
        draft: result.draft,
        job: result.job,
        usableForAssessment: false
      })
      return true
    }

    // GET /api/teacher/material-import/drafts/:id/assessment-ref
    const assessmentMatch = matchPath(
      pathname,
      /^\/drafts\/([^/]+)\/assessment-ref$/
    )
    if (assessmentMatch && request.method === 'GET') {
      try {
        const questionId = service.resolveAssessmentQuestionId(
          assessmentMatch,
          teacherId
        )
        respondJson(response, 200, { questionId, usableForAssessment: true })
      } catch (error) {
        // 闸门在测评引用路径上返回 422：语义合法但状态不允许布置。
        if (error instanceof MaterialImportGateError) {
          respondJson(response, 422, {
            error: error.message,
            usableForAssessment: false,
            gateNotice: MATERIAL_IMPORT_GATE_NOTICE
          })
          return true
        }
        throw error
      }
      return true
    }

    // POST /api/teacher/material-import/:jobId/confirm-batch
    const batchMatch = matchPath(pathname, /^\/([^/]+)\/confirm-batch$/)
    if (batchMatch && request.method === 'POST') {
      const result = service.confirmBatch(batchMatch, teacherId)
      respondJson(response, 200, {
        job: result.job,
        confirmed: result.confirmed,
        questions: result.questions,
        skipped: result.skipped,
        gateNotice: MATERIAL_IMPORT_GATE_NOTICE
      })
      return true
    }

    // GET /api/teacher/material-import/:jobId
    const jobMatch = matchPath(pathname, /^\/([^/]+)$/)
    if (jobMatch && request.method === 'GET') {
      respondJson(response, 200, service.getJobView(jobMatch, teacherId))
      return true
    }

    respondJson(response, 404, { error: 'Material import route not found' })
    return true
  } catch (error) {
    return handleError(response, error)
  }
}

function matchPath(pathname: string, pattern: RegExp): string | undefined {
  const suffix = pathname.slice(ROUTE_PREFIX.length)
  const matched = suffix.match(pattern)
  if (!matched?.[1]) return undefined
  return decodeURIComponent(matched[1])
}

function handleError(response: ServerResponse, error: unknown): boolean {
  if (error instanceof MaterialImportOwnershipError) {
    respondJson(response, 403, { error: error.message })
    return true
  }
  if (error instanceof MaterialImportNotFoundError) {
    respondJson(response, 404, { error: error.message })
    return true
  }
  if (error instanceof MaterialImportGateError) {
    // Confirm / assessment-ref gates: 422 = valid request, illegal state.
    respondJson(response, 422, {
      error: error.message,
      gateNotice: MATERIAL_IMPORT_GATE_NOTICE
    })
    return true
  }
  if (error instanceof MaterialImportInputError) {
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

function asRecord(body: unknown, what: string): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new MaterialImportInputError(`${what} must be a JSON object`)
  }
  return body as Record<string, unknown>
}

function parseCreateBody(
  body: unknown,
  teacherId: string
): CreateMaterialJobInput {
  const record = asRecord(body, 'Request body')
  const subject = record.subject
  if (
    typeof subject !== 'string' ||
    !SUBJECTS.includes(subject as SubjectLanguage)
  ) {
    throw new MaterialImportInputError(`Unsupported subject: ${String(subject)}`)
  }
  if (typeof record.questionBankId !== 'string') {
    throw new MaterialImportInputError('questionBankId is required')
  }
  if (typeof record.rawText !== 'string') {
    throw new MaterialImportInputError('rawText must be a string')
  }

  const input: CreateMaterialJobInput = {
    teacherId,
    questionBankId: record.questionBankId,
    subject: subject as SubjectLanguage,
    rawText: record.rawText
  }
  if (
    typeof record.sourceKind === 'string' &&
    SOURCE_KINDS.includes(record.sourceKind as MaterialSourceKind)
  ) {
    input.sourceKind = record.sourceKind as MaterialSourceKind
  }
  if (typeof record.sourceRef === 'string') input.sourceRef = record.sourceRef
  if (typeof record.teachingUnitId === 'string') {
    input.teachingUnitId = record.teachingUnitId
  }
  return input
}

function parsePatch(body: unknown): DraftPatchInput {
  const record = asRecord(body, 'Request body')
  const patch: DraftPatchInput = {}
  if (typeof record.stem === 'string') patch.stem = record.stem
  if (typeof record.questionType === 'string') {
    patch.questionType = record.questionType
  }
  if (Array.isArray(record.options)) {
    patch.options = record.options.map((entry, index) => {
      const option = asRecord(entry, `options[${String(index)}]`)
      if (typeof option.id !== 'string' || typeof option.text !== 'string') {
        throw new MaterialImportInputError(
          `options[${String(index)}] needs string id and text`
        )
      }
      const parsed: DraftQuestionOption = { id: option.id, text: option.text }
      return parsed
    })
  }
  if ('payload' in record) patch.payload = record.payload
  if (Array.isArray(record.kpIds)) {
    patch.kpIds = record.kpIds.filter(
      (kp): kp is string => typeof kp === 'string'
    )
  }
  if (typeof record.difficulty === 'number') {
    patch.difficulty = record.difficulty
  }
  if (typeof record.solutionDraft === 'string') {
    patch.solutionDraft = record.solutionDraft
  }
  return patch
}

function parseConfirm(body: unknown): ConfirmDraftInput {
  const record = asRecord(body, 'Request body')
  const confirm: ConfirmDraftInput = parsePatch(record)
  if (typeof record.solution === 'string') confirm.solution = record.solution
  if (typeof record.note === 'string') confirm.note = record.note
  return confirm
}

class BodyTooLargeError extends Error {}
class MalformedJsonError extends Error {}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const declaredSize = Number(request.headers['content-length'] ?? 0)
  if (Number.isFinite(declaredSize) && declaredSize > MAX_BODY_BYTES) {
    throw new BodyTooLargeError('Request body is too large')
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += buffer.length
    if (size > MAX_BODY_BYTES) {
      throw new BodyTooLargeError('Request body is too large')
    }
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.length === 0) return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new MalformedJsonError('Malformed JSON request body')
  }
}
