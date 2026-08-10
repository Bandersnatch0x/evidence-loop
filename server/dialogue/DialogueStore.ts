/**
 * DialogueStore — 人物对话探究的持久化（T21，迁移 0017）。
 *
 * 实现 `DialogueSessionWriter` 端口。整个文件只 touch `personas` /
 * `dialogue_sessions` / `dialogue_turns` 三张自有表：没有一条 SQL 提到
 * mastery_scores / review_cards / evaluations / attempts，所以「对话探究」
 * 这条路径在物理上不可能写计分数据（ADR-0001）。
 *
 * 语义要点：
 *   * `seedCatalog` 是镜像快照（INSERT OR REPLACE）——静态目录
 *     `PERSONA_CATALOG` 仍是唯一事实源，本表只按 catalog_version 记录
 *     「当时挂载的是哪一版」；
 *   * 会话 `mode` 列有 `CHECK (mode = 'practice')`，assessment 会话在
 *     存储层构造不出来；
 *   * 每一条 assistant 轮次都落 provenance_json（恒 llm_inference），
 *     可审计「哪次练习、哪个角色、哪轮提问」。
 */
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type {
  DialogueTurn,
  PersonaCatalogEntry
} from '../../shared/personaDialogue'
import {
  DialogueSessionNotFoundError,
  type DialogueSessionRecord,
  type DialogueSessionWriter
} from './ports'

interface SessionRow {
  id: string
  student_id: string
  persona_id: string
  mode: string
  kp_id: string | null
  question_id: string | null
  status: 'open' | 'closed'
  turn_count: number
  created_at: string
  last_turn_at: string | null
  closed_at: string | null
}

interface TurnRow {
  id: string
  session_id: string
  turn_index: number
  role: 'user' | 'assistant'
  content: string
  source: 'local-policy' | 'llm' | null
  model: string | null
  provenance_json: string | null
  created_at: string
}

export interface DialogueStoreOptions {
  database: Database.Database
}

export class DialogueStore implements DialogueSessionWriter {
  private readonly db: Database.Database

  public constructor(options: DialogueStoreOptions) {
    this.db = options.database
  }

  /** 镜像静态目录到 personas 表（INSERT OR REPLACE，幂等）。 */
  public seedCatalog(
    catalog: readonly PersonaCatalogEntry[],
    catalogVersion: string,
    now: string
  ): void {
    const upsert = this.db.prepare(
      `
      INSERT INTO personas (
        persona_id, name, subject, era_or_context,
        source_excerpts_json, disclaimer, catalog_version, updated_at
      ) VALUES (
        @persona_id, @name, @subject, @era_or_context,
        @source_excerpts_json, @disclaimer, @catalog_version, @updated_at
      )
      ON CONFLICT(persona_id) DO UPDATE SET
        name = excluded.name,
        subject = excluded.subject,
        era_or_context = excluded.era_or_context,
        source_excerpts_json = excluded.source_excerpts_json,
        disclaimer = excluded.disclaimer,
        catalog_version = excluded.catalog_version,
        updated_at = excluded.updated_at
      `
    )
    const run = this.db.transaction(() => {
      for (const entry of catalog) {
        upsert.run({
          persona_id: entry.id,
          name: entry.name,
          subject: entry.subject,
          era_or_context: entry.eraOrContext,
          source_excerpts_json: JSON.stringify(entry.sourceExcerpts),
          disclaimer: entry.disclaimer,
          catalog_version: catalogVersion,
          updated_at: now
        })
      }
    })
    run()
  }

  /** 创建会话（status='open'）。调用方先落开场白轮次。 */
  public createSession(session: DialogueSessionRecord): void {
    this.db
      .prepare(
        `
        INSERT INTO dialogue_sessions (
          id, student_id, persona_id, mode, kp_id, question_id,
          status, turn_count, created_at, last_turn_at
        ) VALUES (
          @id, @student_id, @persona_id, 'practice', @kp_id, @question_id,
          @status, @turn_count, @created_at, @last_turn_at
        )
        `
      )
      .run({
        id: session.id,
        student_id: session.studentId,
        persona_id: session.personaId,
        kp_id: session.kpId ?? null,
        question_id: session.questionId ?? null,
        status: session.status,
        turn_count: 1,
        created_at: session.createdAt,
        last_turn_at: session.lastTurnAt ?? null
      })
  }

  /** 追加一轮（用户/角色）。assistant 轮携带 provenance_json。 */
  public appendTurn(turn: DialogueTurn): void {
    this.db
      .prepare(
        `
        INSERT INTO dialogue_turns (
          id, session_id, turn_index, role, content,
          source, model, provenance_json, created_at
        ) VALUES (
          @id, @session_id, @turn_index, @role, @content,
          @source, @model, @provenance_json, @created_at
        )
        `
      )
      .run({
        id: turn.id,
        session_id: turn.sessionId,
        turn_index: turn.turnIndex,
        role: turn.role,
        content: turn.content,
        source: turn.source ?? null,
        model: turn.model ?? null,
        provenance_json: turn.provenance ? JSON.stringify(turn.provenance) : null,
        created_at: turn.createdAt
      })
    this.db
      .prepare(
        `
        UPDATE dialogue_sessions
        SET turn_count = turn_count + 1, last_turn_at = @last_turn_at
        WHERE id = @session_id
        `
      )
      .run({ session_id: turn.sessionId, last_turn_at: turn.createdAt })
  }

  /** 读会话。 */
  public getSession(sessionId: string): DialogueSessionRecord | undefined {
    const row = this.db
      .prepare(`SELECT * FROM dialogue_sessions WHERE id = @id`)
      .get({ id: sessionId }) as SessionRow | undefined
    if (!row) return undefined
    return {
      id: row.id,
      studentId: row.student_id,
      personaId: row.persona_id,
      kpId: row.kp_id ?? undefined,
      questionId: row.question_id ?? undefined,
      status: row.status,
      createdAt: row.created_at,
      lastTurnAt: row.last_turn_at ?? undefined,
      closedAt: row.closed_at ?? undefined
    }
  }

  /** 读会话 + 轮次。会话不存在返回 undefined。 */
  public loadSession(sessionId: string):
    | { session: DialogueSessionRecord; turns: DialogueTurn[] }
    | undefined {
    const session = this.getSession(sessionId)
    if (!session) return undefined
    return { session, turns: this.listTurns(sessionId) }
  }

  /** 按轮次序号升序读回全部轮次。 */
  public listTurns(sessionId: string): DialogueTurn[] {
    const rows = this.db
      .prepare(
        `
        SELECT * FROM dialogue_turns
        WHERE session_id = @sessionId
        ORDER BY turn_index ASC
        `
      )
      .all({ sessionId }) as TurnRow[]
    return rows.map(toTurn)
  }

  /** 关闭会话（幂等）。 */
  public closeSession(sessionId: string, closedAt: string): void {
    const result = this.db
      .prepare(
        `
        UPDATE dialogue_sessions
        SET status = 'closed', closed_at = @closed_at
        WHERE id = @session_id AND status = 'open'
        `
      )
      .run({ session_id: sessionId, closed_at: closedAt })
    if (result.changes === 0) {
      // 会话不存在或已关闭 —— 让调用方用 getSession 判定具体错误。
      throw new DialogueSessionNotFoundError(sessionId)
    }
  }
}

/**
 * 行 → 领域轮次。assistant 轮的 provenance 解析失败时，宁可丢弃该条
 * provenance 也不破坏返回（读侧容错）；但写侧从不写坏数据。
 */
function toTurn(row: TurnRow): DialogueTurn {
  return {
    id: row.id,
    sessionId: row.session_id,
    turnIndex: row.turn_index,
    role: row.role,
    content: row.content,
    ...(row.source ? { source: row.source } : {}),
    ...(row.model ? { model: row.model } : {}),
    ...(row.provenance_json ? { provenance: parseProvenance(row.provenance_json) } : {}),
    createdAt: row.created_at
  }
}

function parseProvenance(raw: string): DialogueTurn['provenance'] {
  try {
    const value = JSON.parse(raw) as { kind?: string }
    if (value.kind === 'llm_inference') {
      return value as Extract<DialogueTurn['provenance'], { kind: 'llm_inference' }>
    }
    return undefined
  } catch {
    return undefined
  }
}

/** 工厂：随机 id 的一个轮次（Service 用于拼接用户/角色轮）。 */
export function createTurnId(): string {
  return `dialogue-turn-${randomUUID()}`
}
