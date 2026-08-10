/**
 * PersonaDialogueService — T21 人物对话探究的编排层。
 *
 * 职责（与 T19 WeeklyReportService / T18 StudyPlanService 同款分层）：
 *   1. 只读静态目录 `PERSONA_CATALOG`（固定人物集，非 LLM 自由发挥）；
 *   2. 通过 `DialogueSessionWriter`（自有表）落会话与轮次；
 *   3. 交给生成器产出一轮角色回复，**统一盖 `llm_inference` provenance**。
 *
 * 铁律（ADR-0001 / ADR-0006 / D1）：
 *   * mode 门在 Service 层再守一遍：非 practice 一律 `DialogueModeError`(403)；
 *   * 本类持有的唯一写句柄是自有表 writer 与生成器 —— 不存在 attempts /
 *     evaluations / mastery 的任何写路径，「对话探究不写分」是结构性的；
 *   * 每一条 assistant 轮次都带 `llm_inference` provenance 落库（可审计），
 *     `source` 区分 llm / 模板降级；
 *   * 关闭对话不产生 Attempt（除非用户另开测评题）。
 */
import { randomUUID } from 'node:crypto'
import {
  DIALOGUE_MAX_ROUNDS,
  DIALOGUE_PRACTICE_NOTICE,
  PERSONA_CATALOG,
  PERSONA_CATALOG_VERSION,
  findPersonaEntry,
  type DialogueSessionView,
  type DialogueTurn,
  type DialogueTurnResult,
  type OpenDialogueRequest,
  type OpenDialogueResponse,
  type PersonaCatalogEntry,
  type PersonaDialogueMessage,
  type PersonaId
} from '../../shared/personaDialogue'
import { resolveLlmProvider } from '../tutoring/callOpenAICompatible'
import {
  DialogueModeError,
  DialoguePersonaNotFoundError,
  DialogueRoundLimitError,
  DialogueSessionClosedError,
  DialogueSessionForbiddenError,
  DialogueSessionNotFoundError,
  type DialogueSessionRecord,
  type DialogueSessionWriter
} from './ports'
import {
  computeLowEffortStreak,
  LlmPersonaDialogueGenerator,
  PERSONA_TEMPLATE_MODEL,
  type PersonaDialogueDraft,
  type PersonaDialogueGenerator
} from './PersonaDialogueGenerator'
import { createTurnId } from './DialogueStore'

export interface PersonaDialogueServiceOptions {
  /** 自有表 writer（DialogueStore）。 */
  store: DialogueSessionWriter
  /** 生成器。缺省按环境 LLM 自动选择；测试可注入模板生成器。 */
  generator?: PersonaDialogueGenerator
  now?: () => Date
}

export class PersonaDialogueService {
  private readonly store: DialogueSessionWriter
  private readonly generator: PersonaDialogueGenerator
  private readonly now: () => Date

  public constructor(options: PersonaDialogueServiceOptions) {
    this.store = options.store
    this.generator =
      options.generator ?? new LlmPersonaDialogueGenerator(resolveLlmProvider())
    this.now = options.now ?? (() => new Date())

    // 目录镜像快照：静态目录仍是唯一事实源，personas 表只记录挂载版本。
    this.store.seedCatalog(PERSONA_CATALOG, PERSONA_CATALOG_VERSION, this.now().toISOString())
  }

  /** 预置人物列表（固定目录；可按学科过滤）。 */
  public listPersonas(subject?: string): PersonaCatalogEntry[] {
    const all = [...PERSONA_CATALOG]
    if (subject === undefined || subject === '') return all
    return all.filter((entry) => entry.subject === subject)
  }

  /** 开会话（仅 practice 态；assessment 一律拒绝，不产生任何会话）。 */
  public open(input: OpenDialogueRequest & { studentId: string }): OpenDialogueResponse {
    if (input.mode !== 'practice') {
      throw new DialogueModeError(
        'Persona dialogue inquiry is only available in practice mode (D1)'
      )
    }
    const persona = findPersonaEntry(input.personaId)
    if (!persona) throw new DialoguePersonaNotFoundError(input.personaId)

    const createdAt = this.now().toISOString()
    const sessionId = `dialogue-${randomUUID()}`
    const session: DialogueSessionRecord = {
      id: sessionId,
      studentId: input.studentId,
      personaId: persona.id,
      kpId: input.kpId,
      questionId: input.questionId,
      status: 'open',
      createdAt,
      lastTurnAt: createdAt
    }
    // 开场白是静态目录文案（local-policy），同样带 llm_inference provenance，
    // 让整份 transcript 的「建议层自证」从头到尾一致。
    const opening: DialogueTurn = this.buildAssistantTurn(
      {
        content: persona.openingLine,
        source: 'local-policy',
        model: PERSONA_TEMPLATE_MODEL,
        disclaimer: persona.disclaimer
      },
      sessionId,
      0,
      createdAt
    )
    this.store.createSession(session)
    this.store.appendTurn(opening)

    return {
      session: this.toView(session, [opening]),
      persona,
      notice: DIALOGUE_PRACTICE_NOTICE
    }
  }

  /** 多轮。轮次上限到达后拒绝继续，引导转论述题。 */
  public async turn(input: {
    sessionId: string
    studentId: string
    message: string
  }): Promise<DialogueTurnResult> {
    const session = this.requireOwnedOpenSession(input.sessionId, input.studentId)
    const persona = findPersonaEntry(session.personaId)
    if (!persona) throw new DialoguePersonaNotFoundError(session.personaId)

    const turns = this.store.listTurns(session.id)
    const userTurnCount = turns.filter((turn) => turn.role === 'user').length
    if (userTurnCount >= DIALOGUE_MAX_ROUNDS) {
      throw new DialogueRoundLimitError(DIALOGUE_MAX_ROUNDS)
    }

    const nowIso = this.now().toISOString()
    const history = turns.map((turn) => ({ role: turn.role, content: turn.content }))

    // 用户轮：先落库（审计「哪轮提问」），再生成角色回复。
    const userTurn: DialogueTurn = {
      id: createTurnId(),
      sessionId: session.id,
      turnIndex: turns.length,
      role: 'user',
      content: input.message,
      createdAt: nowIso
    }
    this.store.appendTurn(userTurn)

    const lowEffortStreak = computeLowEffortStreak(history, input.message)
    const draft = await this.generator.reply({
      persona,
      message: input.message,
      history,
      lowEffortStreak
    })
    const assistantTurn = this.buildAssistantTurn(
      draft,
      session.id,
      turns.length + 1,
      nowIso
    )
    this.store.appendTurn(assistantTurn)

    const allTurns = [...turns, userTurn, assistantTurn]
    const view = this.toView(session, allTurns)
    return {
      message: toMessage(assistantTurn),
      session: view,
      roundLimitReached: view.userTurnCount >= DIALOGUE_MAX_ROUNDS
    }
  }

  /** 结束探究（幂等）。关闭后不产生任何 Attempt。 */
  public close(input: { sessionId: string; studentId: string }): DialogueSessionView {
    const session = this.store.getSession(input.sessionId)
    if (!session) throw new DialogueSessionNotFoundError(input.sessionId)
    if (session.studentId !== input.studentId) {
      throw new DialogueSessionForbiddenError()
    }
    if (session.status === 'open') {
      this.store.closeSession(input.sessionId, this.now().toISOString())
    }
    const updated = this.store.getSession(input.sessionId)
    // closeSession 在 status=open 时必然成功；会话已关闭时直接读回。
    return this.toView(
      updated ?? session,
      this.store.listTurns(input.sessionId)
    )
  }

  // ---------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------

  private requireOwnedOpenSession(
    sessionId: string,
    studentId: string
  ): DialogueSessionRecord {
    const session = this.store.getSession(sessionId)
    if (!session) throw new DialogueSessionNotFoundError(sessionId)
    if (session.studentId !== studentId) throw new DialogueSessionForbiddenError()
    if (session.status !== 'open') throw new DialogueSessionClosedError(sessionId)
    return session
  }

  /**
   * 盖戳（ADR-0006）：任何生成器 draft 都被重写为 llm_inference 的 assistant
   * 轮次。provenance 恒为 `{ kind: 'llm_inference', sourceMessages, model,
   * extractedAt }` —— 一个 evidence 标签都装不进来。
   */
  private buildAssistantTurn(
    draft: PersonaDialogueDraft,
    sessionId: string,
    turnIndex: number,
    extractedAt: string
  ): DialogueTurn {
    return {
      id: createTurnId(),
      sessionId,
      turnIndex,
      role: 'assistant',
      content: draft.content,
      source: draft.source,
      model: draft.model,
      provenance: {
        kind: 'llm_inference',
        sourceMessages: draft.sourceMessages ?? [draft.content],
        model: draft.model,
        extractedAt,
        ...(draft.confidence !== undefined ? { confidence: draft.confidence } : {})
      },
      ...(draft.disclaimer !== undefined ? { disclaimer: draft.disclaimer } : {}),
      createdAt: extractedAt
    }
  }

  private toView(
    session: DialogueSessionRecord,
    turns: DialogueTurn[]
  ): DialogueSessionView {
    return {
      id: session.id,
      studentId: session.studentId,
      personaId: session.personaId as PersonaId,
      ...(session.kpId ? { kpId: session.kpId } : {}),
      ...(session.questionId ? { questionId: session.questionId } : {}),
      mode: 'practice',
      status: session.status,
      turns,
      userTurnCount: turns.filter((turn) => turn.role === 'user').length,
      roundLimit: DIALOGUE_MAX_ROUNDS,
      createdAt: session.createdAt,
      ...(session.closedAt ? { closedAt: session.closedAt } : {})
    }
  }
}

/** 落库轮次 → HTTP 响应载体。 */
function toMessage(turn: DialogueTurn): PersonaDialogueMessage {
  return {
    id: turn.id,
    sessionId: turn.sessionId,
    role: 'assistant',
    content: turn.content,
    source: turn.source ?? 'local-policy',
    model: turn.model ?? PERSONA_TEMPLATE_MODEL,
    provenance: turn.provenance ?? {
      kind: 'llm_inference',
      sourceMessages: [turn.content],
      model: turn.model ?? PERSONA_TEMPLATE_MODEL,
      extractedAt: turn.createdAt
    },
    createdAt: turn.createdAt,
    ...(turn.disclaimer !== undefined ? { disclaimer: turn.disclaimer } : {})
  }
}
