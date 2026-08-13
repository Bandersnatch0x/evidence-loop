import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import type {
  Attempt,
  EvaluationHistoryItem,
  EvaluationResult
} from '../../shared/contracts'
import { applyProductMigrations } from '../db/migrate'
import {
  ensureEvaluationProvenance,
  type EvaluationListFilters
} from './EvaluationStore'
import {
  evaluationToLegacyAttempt,
  normalizeAttempt,
  readAttemptsJson,
  type AttemptListFilters,
  type AttemptStore
} from './AttemptStore'

/**
 * SQLite-backed AttemptStore (复赛 item 2: 评估历史迁移到数据库，支持多实例).
 *
 * Owns the `attempts` table (migration 0002, extended by 0020 with paper_id /
 * due_at). Mirrors QuestionStore's connection handling: a shared physical DB
 * file or an injected connection (same :memory: DB as the rest of the unit
 * suite). Implements the full EvaluationStore surface via Attempt projection
 * so MasteryService / HTTP layer keep working without a hard cutover
 * (T01 expand-contract).
 *
 * 多实例：rows live in a shared SQLite file with WAL, so any number of server
 * processes can read/write the same history — unlike JsonAttemptStore which is
 * a single process-local JSON file.
 */
export interface SqliteAttemptStoreOptions {
  dbPath?: string
  /** Reuse an existing connection (shared :memory: DB in tests / productDb). */
  database?: Database.Database
}

interface AttemptRow {
  id: string
  student_id: string
  question_id: string
  teaching_unit_id: string
  term_id: string
  mode: string
  created_at: string
  result_json: string
  paper_id: string | null
  due_at: string | null
}

export class SqliteAttemptStore implements AttemptStore {
  private readonly db: Database.Database
  private readonly ownsDb: boolean
  private readonly upsertStmt: Database.Statement
  private readonly getStmt: Database.Statement
  private readonly latestStmt: Database.Statement
  private readonly latestForStudentStmt: Database.Statement
  private readonly deleteStmt: Database.Statement
  private readonly countStmt: Database.Statement

  public constructor(options: SqliteAttemptStoreOptions = {}) {
    if (options.database) {
      this.db = options.database
      this.ownsDb = false
    } else {
      const dbPath = options.dbPath ?? ':memory:'
      if (dbPath !== ':memory:') {
        mkdirSync(dirname(dbPath), { recursive: true })
      }
      this.db = new Database(dbPath)
      this.db.pragma('journal_mode = WAL')
      this.db.pragma('synchronous = NORMAL')
      this.ownsDb = true
    }
    applyProductMigrations(this.db)

    this.upsertStmt = this.db.prepare(`
      INSERT INTO attempts (
        id, student_id, question_id, teaching_unit_id, term_id, mode,
        created_at, result_json, paper_id, due_at
      ) VALUES (
        @id, @studentId, @questionId, @teachingUnitId, @termId, @mode,
        @createdAt, @resultJson, @paperId, @dueAt
      )
      ON CONFLICT(id) DO UPDATE SET
        student_id       = excluded.student_id,
        question_id      = excluded.question_id,
        teaching_unit_id = excluded.teaching_unit_id,
        term_id          = excluded.term_id,
        mode             = excluded.mode,
        created_at       = excluded.created_at,
        result_json      = excluded.result_json,
        paper_id         = excluded.paper_id,
        due_at           = excluded.due_at
    `)
    this.getStmt = this.db.prepare('SELECT * FROM attempts WHERE id = ?')
    this.latestStmt = this.db.prepare(
      'SELECT * FROM attempts WHERE question_id = ? ORDER BY created_at DESC LIMIT 1'
    )
    this.latestForStudentStmt = this.db.prepare(
      'SELECT * FROM attempts WHERE question_id = ? AND student_id = ? ORDER BY created_at DESC LIMIT 1'
    )
    this.deleteStmt = this.db.prepare('DELETE FROM attempts WHERE id = ?')
    this.countStmt = this.db.prepare('SELECT COUNT(*) AS count FROM attempts')
  }

  /** Close the connection only when this instance opened it. */
  public close(): void {
    if (this.ownsDb) this.db.close()
  }

  /**
   * One-shot legacy migration (expand-contract): when the target table is empty
   * and a legacy JSON file exists, import all normalized rows. Idempotent and
   * non-destructive — the JSON file is left untouched, and a second boot is a
   * no-op (table no longer empty). Concurrent first-boots are safe because the
   * insert is keyed on `id` (upsert).
   *
   * @returns number of imported attempts (0 when nothing to do).
   */
  public async importLegacyJson(filePath: string): Promise<number> {
    if (!existsSync(filePath)) return 0
    const { count } = this.countStmt.get() as { count: number }
    if (count > 0) return 0
    const rows = await readAttemptsJson(filePath)
    if (rows.length === 0) return 0
    await this.saveAttempts(rows)
    return rows.length
  }

  // ---------------------------------------------------------------------------
  // AttemptStore surface
  // ---------------------------------------------------------------------------

  public saveAttempt(attempt: Attempt): Promise<void> {
    return this.saveAttempts([attempt])
  }

  public saveAttempts(attempts: Attempt[]): Promise<void> {
    const write = this.db.transaction((items: Attempt[]) => {
      for (const attempt of items) {
        const normalized = normalizeAttempt(attempt)
        if (normalized === undefined) {
          throw new Error(
            `Cannot save attempt ${attempt.id}: missing valid result payload`
          )
        }
        this.upsertStmt.run({
          id: normalized.id,
          studentId: normalized.studentId,
          questionId: normalized.questionId,
          teachingUnitId: normalized.teachingUnitId,
          termId: normalized.termId,
          mode: normalized.mode,
          createdAt: normalized.createdAt,
          resultJson: JSON.stringify(normalized.result),
          paperId: normalized.paperId ?? null,
          dueAt: normalized.dueAt ?? null
        })
      }
    })
    write(attempts)
    return Promise.resolve()
  }

  public getAttempt(id: string): Promise<Attempt | undefined> {
    const row = this.getStmt.get(id) as AttemptRow | undefined
    return Promise.resolve(row ? rowToAttempt(row) : undefined)
  }

  public listAttempts(
    filters: AttemptListFilters = {}
  ): Promise<Attempt[]> {
    const where: string[] = []
    const params: Record<string, unknown> = {}
    if (filters.studentId !== undefined) {
      where.push('student_id = @studentId')
      params.studentId = filters.studentId
    }
    if (filters.questionId !== undefined) {
      where.push('question_id = @questionId')
      params.questionId = filters.questionId
    }
    if (filters.termId !== undefined) {
      where.push('term_id = @termId')
      params.termId = filters.termId
    }
    if (filters.teachingUnitId !== undefined) {
      where.push('teaching_unit_id = @teachingUnitId')
      params.teachingUnitId = filters.teachingUnitId
    }
    if (filters.mode !== undefined) {
      where.push('mode = @mode')
      params.mode = filters.mode
    }
    const sql =
      'SELECT * FROM attempts' +
      (where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '') +
      ' ORDER BY created_at DESC'
    const rows = this.db.prepare(sql).all(params) as unknown as AttemptRow[]
    return Promise.resolve(rows.map(rowToAttempt))
  }

  public deleteAttempt(id: string): Promise<boolean> {
    const result = this.deleteStmt.run(id)
    return Promise.resolve(result.changes > 0)
  }

  // ---------------------------------------------------------------------------
  // EvaluationStore projection (expand-contract)
  // ---------------------------------------------------------------------------

  public save(evaluation: EvaluationResult): Promise<void> {
    return this.saveAttempt(evaluationToLegacyAttempt(evaluation))
  }

  public async get(id: string): Promise<EvaluationResult | undefined> {
    const attempt = await this.getAttempt(id)
    return attempt ? ensureEvaluationProvenance(attempt.result) : undefined
  }

  public latest(assignmentId: string): Promise<EvaluationResult | undefined> {
    const row = this.latestStmt.get(assignmentId) as AttemptRow | undefined
    return Promise.resolve(
      row ? ensureEvaluationProvenance(rowToAttempt(row).result) : undefined
    )
  }

  public latestForStudent(
    assignmentId: string,
    studentId: string
  ): Promise<EvaluationResult | undefined> {
    const row = this.latestForStudentStmt.get(assignmentId, studentId) as
      | AttemptRow
      | undefined
    return Promise.resolve(
      row ? ensureEvaluationProvenance(rowToAttempt(row).result) : undefined
    )
  }

  public async list(
    filters?: EvaluationListFilters | string
  ): Promise<EvaluationHistoryItem[]> {
    const normalized =
      typeof filters === 'string'
        ? { assignmentId: filters }
        : (filters ?? {})
    const attempts = await this.listAttempts({
      studentId: normalized.studentId,
      questionId: normalized.assignmentId
    })
    return attempts.map((attempt) => {
      const result = ensureEvaluationProvenance(attempt.result)
      return {
        id: result.id,
        assignmentId: result.assignmentId,
        attempt: result.attempt,
        createdAt: result.createdAt,
        score: result.score,
        scoreDelta: result.scoreDelta,
        status: result.status,
        studentId: result.studentId
      }
    })
  }

  public async listResults(
    filters: EvaluationListFilters = {}
  ): Promise<EvaluationResult[]> {
    const attempts = await this.listAttempts({
      studentId: filters.studentId,
      questionId: filters.assignmentId
    })
    return attempts.map((attempt) =>
      ensureEvaluationProvenance(attempt.result)
    )
  }

  public delete(id: string): Promise<boolean> {
    return this.deleteAttempt(id)
  }
}

function rowToAttempt(row: AttemptRow): Attempt {
  const result = ensureEvaluationProvenance(
    JSON.parse(row.result_json) as EvaluationResult
  )
  const raw: Attempt = {
    id: row.id,
    studentId: row.student_id,
    questionId: row.question_id,
    teachingUnitId: row.teaching_unit_id,
    termId: row.term_id,
    mode: row.mode === 'practice' ? 'practice' : 'assessment',
    createdAt: row.created_at,
    ...(row.paper_id !== null ? { paperId: row.paper_id } : {}),
    ...(row.due_at !== null ? { dueAt: row.due_at } : {}),
    result
  }
  return normalizeAttempt(raw) ?? raw
}
