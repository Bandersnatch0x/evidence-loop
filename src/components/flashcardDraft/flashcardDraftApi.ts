/**
 * flashcardDraftApi — T22 闪卡草稿的前端读取/操作层。
 *
 * 独立于 src/lib/api.ts（避免与并行票冲突），复用同一套 demo-role 请求头。
 * 端点全部在 `/api/teacher/flashcard-drafts/*`（教师私有）。前端不自行放行：
 * 未确认草稿的 assessment-ref 会拿到 422，本层原样抛错。
 */
import type { ApiError } from '../../../shared/contracts'
import type {
  FlashcardDraft,
  FlashcardDraftJob,
  FlashcardDraftJobView
} from '../../../shared/flashcardDraft'
import { DEMO_ROLE_HEADER, readStoredDemoRole } from '../../lib/demoRole'

const API_BASE = '/api/teacher/flashcard-drafts'

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      accept: 'application/json',
      [DEMO_ROLE_HEADER]: readStoredDemoRole(),
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers
    }
  })
  const payload = (await response.json()) as T | ApiError
  if (!response.ok) {
    const apiError = payload as ApiError
    throw new Error(apiError.details?.join('；') ?? apiError.error)
  }
  return payload as T
}

export interface CreateFlashcardDraftInput {
  questionBankId: string
  subject: string
  rawText: string
  noStudentSpeechDeclaration: boolean
}

/** 投料（转写 / WebVTT 字幕）→ 生成草稿。 */
export function createFlashcardDrafts(
  input: CreateFlashcardDraftInput
): Promise<FlashcardDraftJobView> {
  return requestJson(`${API_BASE}`, {
    method: 'POST',
    body: JSON.stringify(input)
  })
}

/** 我的生成任务列表。 */
export function listFlashcardJobs(): Promise<{
  jobs: FlashcardDraftJob[]
  gateNotice: string
}> {
  return requestJson(`${API_BASE}`)
}

/** 任务 + 草稿列表。 */
export function getFlashcardJob(jobId: string): Promise<FlashcardDraftJobView> {
  return requestJson(`${API_BASE}/${encodeURIComponent(jobId)}`)
}

/** 教师修正闪卡字段。 */
export function patchFlashcard(
  id: string,
  patch: { front?: string; back?: string }
): Promise<{ flashcard: FlashcardDraft; usableForAssessment: boolean }> {
  return requestJson(`${API_BASE}/flashcards/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch)
  })
}

/** 校对闸门 → 入库。 */
export function confirmFlashcard(
  id: string,
  input: { front?: string; back?: string; note?: string }
): Promise<{ flashcard: FlashcardDraft; question: { id: string } }> {
  return requestJson(`${API_BASE}/flashcards/${encodeURIComponent(id)}/confirm`, {
    method: 'POST',
    body: JSON.stringify(input)
  })
}

/** 丢弃草稿。 */
export function discardFlashcard(id: string): Promise<{ flashcard: FlashcardDraft }> {
  return requestJson(`${API_BASE}/flashcards/${encodeURIComponent(id)}/discard`, {
    method: 'POST'
  })
}

/** 未确认草稿 → 422（硬闸门）。 */
export function getAssessmentRef(
  id: string
): Promise<{ questionId: string }> {
  return requestJson(`${API_BASE}/flashcards/${encodeURIComponent(id)}/assessment-ref`)
}
