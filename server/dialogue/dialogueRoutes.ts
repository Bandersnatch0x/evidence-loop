/**
 * dialogueRoutes — T21 人物对话探究的 HTTP 面。
 *
 *   GET  /api/personas                           预置人物列表（固定目录）
 *   POST /api/practice/dialogue                  开会话（仅 practice 态）
 *   POST /api/practice/dialogue/:id/turn         多轮（轮次上限 8–12）
 *   POST /api/practice/dialogue/:id/close        结束探究 → 引导做论述题
 *
 * 边界：
 *   * mode 门（D1）：开会话时 body.mode 必须是 practice；assessment 一律 403，
 *     不产生任何会话/轮次。
 *   * 全程只写自有表（dialogue_sessions / dialogue_turns / personas 镜像），
 *     绝不 touch score / evidence / MasteryProfile / Attempt（ADR-0001）。
 *   * 会话所有权：学生只能读写自己的会话（studentId 以 session 为准）。
 *   * 轮次上限到达返回 409 + suggestedNext:'essay'，前端引导转论述题。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import type { SessionUser } from '../auth/SessionProvider'
import { HttpError, readJsonBody, respondJson } from '../http/httpUtils'
import {
  DIALOGUE_MAX_ROUNDS,
  DIALOGUE_PRACTICE_NOTICE,
  type CloseDialogueResponse,
  type DialogueTurnResult,
  type OpenDialogueResponse
} from '../../shared/personaDialogue'
import type { PersonaDialogueService } from './PersonaDialogueService'
import {
  DialogueModeError,
  DialoguePersonaNotFoundError,
  DialogueRoundLimitError,
  DialogueSessionClosedError,
  DialogueSessionForbiddenError,
  DialogueSessionNotFoundError
} from './ports'

const openSchema = z.object({
  personaId: z.string().min(1).max(64),
  mode: z.enum(['practice', 'assessment']),
  kpId: z.string().min(1).max(64).optional(),
  questionId: z.string().min(1).max(64).optional()
})

const turnSchema = z.object({
  message: z.string().min(1).max(2000)
})

export interface DialogueRouteContext {
  dialogue: PersonaDialogueService
  user: SessionUser
}

const PERSONAS_PATH = '/api/personas'
const OPEN_PATH = '/api/practice/dialogue'
const TURN_PATTERN = /^\/api\/practice\/dialogue\/([^/]+)\/turn$/
const CLOSE_PATTERN = /^\/api\/practice\/dialogue\/([^/]+)\/close$/

/**
 * 返回 true 表示请求已被消费。
 */
export async function handleDialogueApi(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  context: DialogueRouteContext
): Promise<boolean> {
  const { pathname } = requestUrl
  const turnMatch = TURN_PATTERN.exec(pathname)
  const closeMatch = CLOSE_PATTERN.exec(pathname)

  const isDialoguePath =
    pathname === PERSONAS_PATH ||
    pathname === OPEN_PATH ||
    turnMatch !== null ||
    closeMatch !== null
  if (!isDialoguePath) return false

  try {
    if (!context.user.userId) {
      respondJson(response, 401, { error: 'Unauthorized' })
      return true
    }

    if (request.method === 'GET' && pathname === PERSONAS_PATH) {
      handleListPersonas(requestUrl, response, context)
      return true
    }
    if (request.method === 'POST' && pathname === OPEN_PATH) {
      await handleOpen(request, response, context)
      return true
    }
    if (request.method === 'POST' && turnMatch?.[1] !== undefined) {
      await handleTurn(request, response, decodeURIComponent(turnMatch[1]), context)
      return true
    }
    if (request.method === 'POST' && closeMatch?.[1] !== undefined) {
      handleClose(response, decodeURIComponent(closeMatch[1]), context)
      return true
    }

    respondJson(response, 405, { error: 'Method not allowed' })
    return true
  } catch (error) {
    return respondError(response, error)
  }
}

// ---------------------------------------------------------------------------
// handlers
// ---------------------------------------------------------------------------

function handleListPersonas(
  requestUrl: URL,
  response: ServerResponse,
  context: DialogueRouteContext
): void {
  const subject = requestUrl.searchParams.get('subject')?.trim() ?? ''
  const personas = context.dialogue.listPersonas(subject)
  respondJson(response, 200, { personas, notice: DIALOGUE_PRACTICE_NOTICE })
}

async function handleOpen(
  request: IncomingMessage,
  response: ServerResponse,
  context: DialogueRouteContext
): Promise<void> {
  const body = await readJsonBody(request)
  const parsed = openSchema.safeParse(body)
  if (!parsed.success) {
    respondJson(response, 400, {
      error: 'Invalid dialogue open request',
      details: parsed.error.issues.map(
        (issue) => `${issue.path.join('.')}: ${issue.message}`
      )
    })
    return
  }

  const result: OpenDialogueResponse = context.dialogue.open({
    personaId: parsed.data.personaId,
    mode: parsed.data.mode,
    kpId: parsed.data.kpId,
    questionId: parsed.data.questionId,
    studentId: context.user.studentId ?? context.user.userId
  })
  respondJson(response, 201, result)
}

async function handleTurn(
  request: IncomingMessage,
  response: ServerResponse,
  sessionId: string,
  context: DialogueRouteContext
): Promise<void> {
  const body = await readJsonBody(request)
  const parsed = turnSchema.safeParse(body)
  if (!parsed.success) {
    respondJson(response, 400, {
      error: 'Invalid dialogue turn request',
      details: parsed.error.issues.map(
        (issue) => `${issue.path.join('.')}: ${issue.message}`
      )
    })
    return
  }

  const result: DialogueTurnResult = await context.dialogue.turn({
    sessionId,
    studentId: context.user.studentId ?? context.user.userId,
    message: parsed.data.message
  })
  respondJson(response, 200, result)
}

function handleClose(
  response: ServerResponse,
  sessionId: string,
  context: DialogueRouteContext
): void {
  const session = context.dialogue.close({
    sessionId,
    studentId: context.user.studentId ?? context.user.userId
  })
  const payload: CloseDialogueResponse = {
    session,
    suggestedNext: 'essay'
  }
  respondJson(response, 200, payload)
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function respondError(response: ServerResponse, error: unknown): boolean {
  if (error instanceof DialogueModeError) {
    respondJson(response, error.statusCode, { error: error.message })
    return true
  }
  if (error instanceof DialoguePersonaNotFoundError) {
    respondJson(response, 404, { error: error.message })
    return true
  }
  if (error instanceof DialogueSessionNotFoundError) {
    respondJson(response, 404, { error: error.message })
    return true
  }
  if (error instanceof DialogueSessionForbiddenError) {
    respondJson(response, 403, { error: error.message })
    return true
  }
  if (error instanceof DialogueSessionClosedError) {
    respondJson(response, 409, { error: error.message })
    return true
  }
  if (error instanceof DialogueRoundLimitError) {
    respondJson(response, 409, {
      error: error.message,
      suggestedNext: 'essay',
      roundLimit: DIALOGUE_MAX_ROUNDS
    })
    return true
  }
  if (error instanceof HttpError) {
    respondJson(response, error.statusCode, { error: error.message })
    return true
  }
  console.error(error)
  respondJson(response, 500, { error: 'Internal server error' })
  return true
}
