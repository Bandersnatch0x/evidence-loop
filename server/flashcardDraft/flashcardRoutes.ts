/**
 * T22 媒体/转写 → 闪卡草稿 HTTP 层。未接进 server/index.ts —— 由主控在
 * 装配时把 `tryHandleFlashcardDraftRoute` 挂到 `/api/teacher/flashcard-drafts/*`
 * （与 T15 material-import / T17 transparency 同一模式）。
 *
 * 端点：
 *   POST  /api/teacher/flashcard-drafts                   投料（transcript/webvtt）→ 生成草稿
 *   POST  /api/teacher/flashcard-drafts/audio             音频任务（FLASHCARD_AUDIO_ENABLED）
 *   GET   /api/teacher/flashcard-drafts                   我的生成任务列表
 *   GET   /api/teacher/flashcard-drafts/:jobId            任务 + 草稿列表
 *   GET   /api/teacher/flashcard-drafts/flashcards/:id    单张闪卡
 *   PATCH /api/teacher/flashcard-drafts/flashcards/:id    教师修正字段
 *   POST  /api/teacher/flashcard-drafts/flashcards/:id/confirm   校对闸门 → 入库
 *   POST  /api/teacher/flashcard-drafts/flashcards/:id/discard   丢弃
 *   GET   /api/teacher/flashcard-drafts/flashcards/:id/assessment-ref
 *         未确认 → 422（「未确认草稿不可用于测评」的服务端强制点）
 *
 * 铁律：本文件不返回、不接受任何 score / evidence 字段，也不引用任何计分模块。
 * 闪卡草稿是建议层（llm_inference），只有教师确认后才成为题库题（authored_key）。
 */
import { respondJson } from '../http/httpUtils'
import { readJsonBody } from '../http/httpUtils'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { SessionUser } from '../auth/SessionProvider'
import type { SubjectLanguage } from '../../shared/contracts'
import { FLASHCARD_GATE_NOTICE } from '../../shared/flashcardDraft'
import {
  FlashcardAudioDisabledError,
  FlashcardDraftGateError,
  FlashcardDraftInputError,
  FlashcardDraftNotFoundError,
  FlashcardDraftOwnershipError,
  FlashcardEgressGateError,
  FlashcardStudentSpeechError,
  type ConfirmFlashcardInput,
  type CreateAudioJobInput,
  type CreateFlashcardJobInput,
  type FlashcardDraftService,
  type FlashcardPatchInput
} from './FlashcardDraftService'
import { isWebVtt, parseWebVtt, WebVttInputError } from './WebVttParser'

const ROUTE_PREFIX = '/api/teacher/flashcard-drafts'

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

export interface FlashcardDraftRouteContext {
  flashcardDraft: FlashcardDraftService
  user: SessionUser
}

/**
 * 路由分发器。命中并已写响应返回 true；路径不属于本模块返回 false。
 * 注意匹配顺序：`/flashcards/:id` 必须在 `/:jobId` 之前判断，
 * 否则 `flashcards/xxx` 会被 jobId 捕获。
 */
export async function tryHandleFlashcardDraftRoute(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  context: FlashcardDraftRouteContext
): Promise<boolean> {
  const { pathname } = requestUrl
  if (pathname !== ROUTE_PREFIX && !pathname.startsWith(`${ROUTE_PREFIX}/`)) {
    return false
  }

  if (context.user.role !== 'teacher' && context.user.role !== 'admin') {
    respondJson(response, 403, {
      error: 'Forbidden: flashcard draft import is teacher-private',
      gateNotice: FLASHCARD_GATE_NOTICE
    })
    return true
  }

  const teacherId = context.user.userId
  const service = context.flashcardDraft

  try {
    // POST /api/teacher/flashcard-drafts/audio —— 必须最先匹配（含斜杠子路径）。
    if (request.method === 'POST' && pathname === `${ROUTE_PREFIX}/audio`) {
      const body = (await readJsonBody(request)) as Record<string, unknown>
      const view = await service.createAudioJob(parseAudioBody(body, teacherId))
      respondJson(response, 201, {
        ...view,
        publishedToQuestionBank: false,
        requiresTeacherConfirmation: true
      })
      return true
    }

    // POST /api/teacher/flashcard-drafts
    if (request.method === 'POST' && pathname === ROUTE_PREFIX) {
      const body = (await readJsonBody(request)) as Record<string, unknown>
      const view = await service.createJob(parseCreateBody(body, teacherId))
      respondJson(response, 201, {
        ...view,
        publishedToQuestionBank: false,
        requiresTeacherConfirmation: true
      })
      return true
    }

    // GET /api/teacher/flashcard-drafts
    if (request.method === 'GET' && pathname === ROUTE_PREFIX) {
      respondJson(response, 200, {
        jobs: service.listJobs(teacherId),
        gateNotice: FLASHCARD_GATE_NOTICE
      })
      return true
    }

    // ---- 闪卡子资源（先于 jobId 匹配） ----

    // GET /api/teacher/flashcard-drafts/flashcards/:id
    const flashcardMatch = matchPath(pathname, /^\/flashcards\/([^/]+)$/)
    if (flashcardMatch && request.method === 'GET') {
      const flashcard = service.getFlashcard(flashcardMatch, teacherId)
      respondJson(response, 200, {
        flashcard,
        usableForAssessment: service.isFlashcardAssessable(flashcard),
        gateNotice: FLASHCARD_GATE_NOTICE
      })
      return true
    }

    // PATCH /api/teacher/flashcard-drafts/flashcards/:id
    if (flashcardMatch && request.method === 'PATCH') {
      const body = (await readJsonBody(request)) as Record<string, unknown>
      const flashcard = service.patchFlashcard(
        flashcardMatch,
        teacherId,
        parsePatch(body)
      )
      respondJson(response, 200, {
        flashcard,
        usableForAssessment: service.isFlashcardAssessable(flashcard),
        gateNotice: FLASHCARD_GATE_NOTICE
      })
      return true
    }

    // POST /api/teacher/flashcard-drafts/flashcards/:id/confirm
    const confirmMatch = matchPath(pathname, /^\/flashcards\/([^/]+)\/confirm$/)
    if (confirmMatch && request.method === 'POST') {
      const body = (await readJsonBody(request)) as Record<string, unknown>
      const result = service.confirmFlashcard(
        confirmMatch,
        teacherId,
        parseConfirm(body)
      )
      respondJson(response, 200, {
        flashcard: result.flashcard,
        question: result.question,
        job: result.job,
        gateNotice: FLASHCARD_GATE_NOTICE
      })
      return true
    }

    // POST /api/teacher/flashcard-drafts/flashcards/:id/discard
    const discardMatch = matchPath(pathname, /^\/flashcards\/([^/]+)\/discard$/)
    if (discardMatch && request.method === 'POST') {
      const result = service.discardFlashcard(discardMatch, teacherId)
      respondJson(response, 200, {
        flashcard: result.flashcard,
        job: result.job,
        gateNotice: FLASHCARD_GATE_NOTICE
      })
      return true
    }

    // GET /api/teacher/flashcard-drafts/flashcards/:id/assessment-ref
    const refMatch = matchPath(pathname, /^\/flashcards\/([^/]+)\/assessment-ref$/)
    if (refMatch && request.method === 'GET') {
      // 硬闸门：未确认草稿不可用于测评（422，不是提示）。
      const questionId = service.resolveAssessmentQuestionId(refMatch, teacherId)
      respondJson(response, 200, {
        questionId,
        gateNotice: FLASHCARD_GATE_NOTICE
      })
      return true
    }

    // GET /api/teacher/flashcard-drafts/:jobId
    const jobMatch = matchPath(pathname, /^\/([^/]+)$/)
    if (jobMatch && request.method === 'GET') {
      respondJson(response, 200, service.getJobView(jobMatch, teacherId))
      return true
    }

    respondJson(response, 405, { error: 'Method not allowed' })
    return true
  } catch (error) {
    return respondError(response, error)
  }
}

// ---------------------------------------------------------------------------
// body 解析
// ---------------------------------------------------------------------------

function parseCreateBody(
  body: Record<string, unknown>,
  teacherId: string
): CreateFlashcardJobInput {
  const rawText = readString(body.rawText)
  if (rawText === '') {
    throw new FlashcardDraftInputError('rawText is required')
  }
  // WebVTT 字幕自动转纯文本。
  const text = isWebVtt(rawText) ? parseWebVtt(rawText).text : rawText
  return {
    teacherId,
    questionBankId: readRequiredString(body.questionBankId, 'questionBankId'),
    subject: readSubject(body.subject),
    rawText: text,
    noStudentSpeechDeclaration: body.noStudentSpeechDeclaration === true,
    ...optionalString('sourceKind', body.sourceKind),
    ...optionalString('sourceRef', body.sourceRef),
    ...optionalString('teachingUnitId', body.teachingUnitId)
  }
}

function parseAudioBody(
  body: Record<string, unknown>,
  teacherId: string
): CreateAudioJobInput {
  return {
    teacherId,
    questionBankId: readRequiredString(body.questionBankId, 'questionBankId'),
    subject: readSubject(body.subject),
    ...optionalString('transcript', body.transcript),
    ...optionalString('audioBase64', body.audioBase64),
    ...optionalNumber('durationSeconds', body.durationSeconds),
    ...optionalString('sourceRef', body.sourceRef),
    ...optionalString('teachingUnitId', body.teachingUnitId),
    noStudentSpeechDeclaration: body.noStudentSpeechDeclaration === true
  }
}

function parsePatch(body: Record<string, unknown>): FlashcardPatchInput {
  return {
    ...optionalString('front', body.front),
    ...optionalString('back', body.back)
  }
}

function parseConfirm(body: Record<string, unknown>): ConfirmFlashcardInput {
  return {
    ...optionalString('front', body.front),
    ...optionalString('back', body.back),
    ...optionalString('solution', body.solution),
    ...optionalString('note', body.note)
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function readRequiredString(
  value: unknown,
  label: string
): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new FlashcardDraftInputError(`${label} is required`)
  }
  return value.trim()
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readSubject(value: unknown): SubjectLanguage {
  const subject = readString(value)
  if (!SUBJECTS.includes(subject as SubjectLanguage)) {
    throw new FlashcardDraftInputError(
      `subject must be one of: ${SUBJECTS.join(', ')}`
    )
  }
  return subject as SubjectLanguage
}

function optionalString(
  key: string,
  value: unknown
): Record<string, string> {
  if (typeof value !== 'string') return {}
  const trimmed = value.trim()
  return trimmed === '' ? {} : { [key]: trimmed }
}

function optionalNumber(
  key: string,
  value: unknown
): Record<string, number> {
  if (typeof value !== 'number' || !Number.isFinite(value)) return {}
  return { [key]: value }
}

function matchPath(pathname: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(pathname.replace(ROUTE_PREFIX, ''))
  return match?.[1] !== undefined ? decodeURIComponent(match[1]) : undefined
}

function respondError(response: ServerResponse, error: unknown): boolean {
  if (error instanceof FlashcardDraftNotFoundError) {
    respondJson(response, 404, { error: error.message, gateNotice: FLASHCARD_GATE_NOTICE })
    return true
  }
  if (error instanceof FlashcardDraftOwnershipError) {
    respondJson(response, 403, { error: error.message, gateNotice: FLASHCARD_GATE_NOTICE })
    return true
  }
  if (error instanceof FlashcardDraftGateError) {
    respondJson(response, 422, { error: error.message, gateNotice: FLASHCARD_GATE_NOTICE })
    return true
  }
  if (error instanceof FlashcardAudioDisabledError) {
    respondJson(response, 501, { error: error.message, gateNotice: FLASHCARD_GATE_NOTICE })
    return true
  }
  if (error instanceof FlashcardStudentSpeechError) {
    respondJson(response, 400, { error: error.message, gateNotice: FLASHCARD_GATE_NOTICE })
    return true
  }
  if (error instanceof FlashcardEgressGateError) {
    respondJson(response, 400, { error: error.message, gateNotice: FLASHCARD_GATE_NOTICE })
    return true
  }
  if (error instanceof WebVttInputError) {
    respondJson(response, 400, { error: error.message, gateNotice: FLASHCARD_GATE_NOTICE })
    return true
  }
  if (error instanceof FlashcardDraftInputError) {
    respondJson(response, 400, { error: error.message, gateNotice: FLASHCARD_GATE_NOTICE })
    return true
  }
  respondJson(response, 500, { error: 'Internal server error' })
  return true
}
