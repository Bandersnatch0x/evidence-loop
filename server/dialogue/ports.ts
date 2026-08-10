/**
 * ports — T21 人物对话探究模块的依赖端口。
 *
 * 与 T18 `server/studyPlan/ports.ts` / T19 `server/reports/ports.ts` 同款设计：
 * 结构化（duck-typed）声明，刻意**不 import** server/mastery、server/review、
 * server/runner、server/store 中的任何实体：
 *
 *   - 本模块唯一的数据依赖是 `DialogueSessionWriter`（自有的 DialogueStore，
 *     只读写 personas / dialogue_sessions / dialogue_turns 三张自有表）；
 *   - `server/dialogue/` 的 import 图里没有任何一条边指向评分/Attempt 存储，
 *     「对话探究不写分」因此是**结构性**成立的，而不是靠人自觉。
 *
 * 唯一的对外写句柄是自有表（dialogue_sessions / dialogue_turns）。整个模块
 * 不存在 attempts / evaluations / mastery_scores 的写路径（ADR-0001）。
 */
import type {
  DialogueTurn,
  PersonaCatalogEntry
} from '../../shared/personaDialogue'

/** 一次会话的落库形状（镜像 dialogue_sessions 行）。 */
export interface DialogueSessionRecord {
  id: string
  studentId: string
  personaId: string
  kpId?: string
  questionId?: string
  status: 'open' | 'closed'
  createdAt: string
  lastTurnAt?: string
  closedAt?: string
}

/**
 * 会话 + 轮次持久化端口。**只**读写自有表，绝无 attempts / evaluations /
 * mastery_scores 的写方法。
 */
export interface DialogueSessionWriter {
  /** 镜像静态目录（personas 表，按 catalog_version 快照）。 */
  seedCatalog(
    catalog: readonly PersonaCatalogEntry[],
    catalogVersion: string,
    now: string
  ): void
  createSession(session: DialogueSessionRecord): void
  appendTurn(turn: DialogueTurn): void
  getSession(sessionId: string): DialogueSessionRecord | undefined
  listTurns(sessionId: string): DialogueTurn[]
  closeSession(sessionId: string, closedAt: string): void
}

/** D1 双态门：对话探究只开放 practice 模式（assessment 关闭辅导）。 */
export class DialogueModeError extends Error {
  public readonly statusCode: number

  public constructor(message: string, statusCode = 403) {
    super(message)
    this.name = 'DialogueModeError'
    this.statusCode = statusCode
  }
}

/** 角色必须是固定目录里的人（非 LLM 自由发挥）。 */
export class DialoguePersonaNotFoundError extends Error {
  public constructor(personaId: string) {
    super(`Persona not found in fixed catalog: ${personaId}`)
    this.name = 'DialoguePersonaNotFoundError'
  }
}

/** 会话不存在。 */
export class DialogueSessionNotFoundError extends Error {
  public constructor(sessionId: string) {
    super(`Dialogue session not found: ${sessionId}`)
    this.name = 'DialogueSessionNotFoundError'
  }
}

/** 越权访问他人会话。 */
export class DialogueSessionForbiddenError extends Error {
  public constructor() {
    super('Forbidden: cannot access another student dialogue session')
    this.name = 'DialogueSessionForbiddenError'
  }
}

/** 会话已关闭。 */
export class DialogueSessionClosedError extends Error {
  public constructor(sessionId: string) {
    super(`Dialogue session already closed: ${sessionId}`)
    this.name = 'DialogueSessionClosedError'
  }
}

/** 轮次上限到达（8–12），拒绝继续，引导转论述题。 */
export class DialogueRoundLimitError extends Error {
  public constructor(limit: number) {
    super(
      `Dialogue reached the round limit of ${String(limit)}; end the inquiry and move to the essay`
    )
    this.name = 'DialogueRoundLimitError'
  }
}
