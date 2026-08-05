import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import type {
  EvidenceSource,
  Question,
  QuestionType,
  SubjectLanguage
} from '../../shared/contracts'
import type { RunnerSpec } from '../data/assignments'
import { applyProductMigrations } from '../db/migrate'
import { parseSolution, serializeSolution } from './solution'


/**
 * SQLite-backed store for the T03 question bank. Owns the `questions` table
 * created by migration 0003 (+ solution_json from 0004). Mirrors AuditStore's
 * connection handling: a shared physical DB file (ADR-0007) or `:memory:` for
 * tests. May reuse an already-open connection so it shares the same in-memory
 * DB as the rest of the memory layer in unit suites.
 */

export interface QuestionStoreOptions {
  dbPath?: string
  /** Reuse an existing connection (shared :memory: DB in tests). */
  database?: Database.Database
}

export interface QuestionQuery {
  authorId?: string
  questionBankId?: string
  subject?: SubjectLanguage
  questionType?: QuestionType
  /** Match questions tagged with ANY of these knowledge points. */
  kpIds?: string[]
  /** Inclusive difficulty band filter. */
  minDifficulty?: number
  maxDifficulty?: number
  limit?: number
}

interface QuestionRow {
  id: string
  question_bank_id: string
  author_id: string
  subject: string
  question_type: string
  stem: string
  payload_json: string
  kp_ids: string
  difficulty: number
  source: string
  created_at: string
  term_id: string | null
  solution_json: string | null
}

const DEFAULT_QUERY_LIMIT = 500

export class QuestionStore {
  private readonly db: Database.Database
  private readonly ownsDb: boolean

  public constructor(options: QuestionStoreOptions = {}) {
    if (options.database) {
      this.db = options.database
      this.ownsDb = false
      applyProductMigrations(this.db)
      return
    }

    const dbPath = options.dbPath ?? ':memory:'
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true })
    }
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.ownsDb = true
    applyProductMigrations(this.db)
  }

  /** Insert or replace a fully-formed Question. */
  public save(question: Question): void {
    this.db
      .prepare(
        `INSERT INTO questions (
          id, question_bank_id, author_id, subject, question_type, stem,
          payload_json, kp_ids, difficulty, source, created_at, term_id,
          solution_json
        ) VALUES (
          @id, @question_bank_id, @author_id, @subject, @question_type, @stem,
          @payload_json, @kp_ids, @difficulty, @source, @created_at, @term_id,
          @solution_json
        )
        ON CONFLICT(id) DO UPDATE SET
          question_bank_id = excluded.question_bank_id,
          author_id = excluded.author_id,
          subject = excluded.subject,
          question_type = excluded.question_type,
          stem = excluded.stem,
          payload_json = excluded.payload_json,
          kp_ids = excluded.kp_ids,
          difficulty = excluded.difficulty,
          source = excluded.source,
          created_at = excluded.created_at,
          term_id = excluded.term_id,
          solution_json = excluded.solution_json`
      )
      .run(toRow(question))
  }

  public get(id: string): Question | undefined {
    const row = this.db
      .prepare(`SELECT * FROM questions WHERE id = ?`)
      .get(id) as QuestionRow | undefined
    return row ? rowToQuestion(row) : undefined
  }

  public list(query: QuestionQuery = {}): Question[] {
    const clauses: string[] = []
    const bindings: Record<string, string | number> = {}

    if (query.authorId !== undefined) {
      clauses.push('author_id = @authorId')
      bindings.authorId = query.authorId
    }
    if (query.questionBankId !== undefined) {
      clauses.push('question_bank_id = @questionBankId')
      bindings.questionBankId = query.questionBankId
    }
    if (query.subject !== undefined) {
      clauses.push('subject = @subject')
      bindings.subject = query.subject
    }
    if (query.questionType !== undefined) {
      clauses.push('question_type = @questionType')
      bindings.questionType = query.questionType
    }
    if (query.minDifficulty !== undefined) {
      clauses.push('difficulty >= @minDifficulty')
      bindings.minDifficulty = query.minDifficulty
    }
    if (query.maxDifficulty !== undefined) {
      clauses.push('difficulty <= @maxDifficulty')
      bindings.maxDifficulty = query.maxDifficulty
    }

    const limit = Math.min(
      Math.max(query.limit ?? DEFAULT_QUERY_LIMIT, 1),
      2_000
    )
    bindings.limit = limit

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
    const rows = this.db
      .prepare(
        `SELECT * FROM questions ${where} ORDER BY created_at DESC LIMIT @limit`
      )
      .all(bindings) as QuestionRow[]

    const questions = rows.map(rowToQuestion)

    // kpId filtering happens in-process: kp_ids is a JSON array, and SQLite
    // JSON functions are avoided here to keep the query portable.
    if (query.kpIds && query.kpIds.length > 0) {
      const wanted = new Set(query.kpIds)
      return questions.filter((question) =>
        question.kpIds.some((kpId) => wanted.has(kpId))
      )
    }
    return questions
  }

  public delete(id: string): boolean {
    const result = this.db.prepare(`DELETE FROM questions WHERE id = ?`).run(id)
    return result.changes > 0
  }

  public count(query: QuestionQuery = {}): number {
    return this.list({ ...query, limit: 2_000 }).length
  }

  public close(): void {
    if (this.ownsDb) {
      this.db.close()
    }
  }
}

/** Generate a stable question id. */
export function newQuestionId(): string {
  return `q_${randomUUID()}`
}

function toRow(question: Question): QuestionRow {
  return {
    id: question.id,
    question_bank_id: question.questionBankId,
    author_id: question.authorId,
    subject: question.subject,
    question_type: question.questionType,
    stem: question.stem,
    payload_json: JSON.stringify(question.payload),
    kp_ids: JSON.stringify(question.kpIds),
    difficulty: question.difficulty,
    source: question.source,
    created_at: question.createdAt,
    term_id: question.termId ?? null,
    solution_json: serializeSolution(question.solution)
  }
}

function rowToQuestion(row: QuestionRow): Question {
  const question: Question = {
    id: row.id,
    questionBankId: row.question_bank_id,
    authorId: row.author_id,
    subject: row.subject as SubjectLanguage,
    questionType: row.question_type as QuestionType,
    stem: row.stem,
    payload: parsePayload(row.payload_json),
    kpIds: parseKpIds(row.kp_ids),
    difficulty: row.difficulty,
    source: row.source as EvidenceSource,
    createdAt: row.created_at
  }
  if (row.term_id !== null) question.termId = row.term_id
  const solution = parseSolution(row.solution_json)
  if (solution !== undefined) question.solution = solution
  return question
}

function parsePayload(json: string): RunnerSpec {
  return JSON.parse(json) as RunnerSpec
}

function parseKpIds(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    return []
  }
}
