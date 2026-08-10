/**
 * personaDialogueApi — T21 人物对话探究的前端读取层。
 *
 * 独立于 src/lib/api.ts（避免与并行票冲突），但复用同一套 demo-role
 * 请求头约定，行为一致。全部端点只服务**练习态**探究对话：
 *   GET  /api/personas            预置人物列表（固定目录）
 *   POST /api/practice/dialogue   开会话
 *   POST /api/practice/dialogue/:id/turn   多轮
 *   POST /api/practice/dialogue/:id/close  结束探究 → 引导转论述题
 *
 * 铁律（ADR-0001 / ADR-0006 / D1）：对话产出只进建议层，永不进入
 * score / evidence；本文件不提供任何评分/提交相关调用。
 */
import type { ApiError } from '../../../shared/contracts'
import type {
  CloseDialogueResponse,
  DialogueSessionView,
  DialogueTurnResult,
  OpenDialogueResponse,
  PersonaCatalogEntry
} from '../../../shared/personaDialogue'
import { DEMO_ROLE_HEADER, readStoredDemoRole } from '../../lib/demoRole'

/** GET /api/personas 响应体。 */
export interface PersonaListResponse {
  personas: PersonaCatalogEntry[]
  notice: string
}

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

/** 预置人物列表（可按学科过滤）。 */
export function listPersonas(subject?: string): Promise<PersonaListResponse> {
  const query = subject ? `?subject=${encodeURIComponent(subject)}` : ''
  return requestJson(`/api/personas${query}`)
}

/** 开会话（仅 practice 态；assessment 会被服务端 403 拒绝）。 */
export function openDialogue(input: {
  personaId: string
  mode: 'practice' | 'assessment'
  kpId?: string
  questionId?: string
}): Promise<OpenDialogueResponse> {
  return requestJson('/api/practice/dialogue', {
    method: 'POST',
    body: JSON.stringify(input)
  })
}

/** 多轮。轮次上限到达后服务端返回 409 + suggestedNext:'essay'。 */
export function sendDialogueTurn(
  sessionId: string,
  message: string
): Promise<DialogueTurnResult> {
  return requestJson(`/api/practice/dialogue/${encodeURIComponent(sessionId)}/turn`, {
    method: 'POST',
    body: JSON.stringify({ message })
  })
}

/** 结束探究（幂等）。关闭后不产生 Attempt。 */
export function closeDialogue(sessionId: string): Promise<CloseDialogueResponse> {
  return requestJson(`/api/practice/dialogue/${encodeURIComponent(sessionId)}/close`, {
    method: 'POST'
  })
}

/** 类型便捷导出，供组件消费。 */
export type { DialogueSessionView }
