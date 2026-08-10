/**
 * T22 SQLite 存储：flashcard_draft_jobs + draft_flashcards（迁移 0018）。
 *
 * 与 T15 `MaterialImportStore` 同构，共享 product DB 迁移路径。
 * 这两张表里没有任何 score / evidence / attempt 列 —— 闪卡草稿永远不是成绩数据。
 */
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import type { SubjectLanguage } from '../../shared/contracts'
import type {
  FlashcardDraft,
  FlashcardDraftJob,
  FlashcardDraftProvenance,
  FlashcardDraftStatus,
  FlashcardJobStatus,
  FlashcardSourceKind
} from '../../shared/flashcardDraft'
import { applyProductMigrations } from '../db/migrate'

export interface FlashcardDraftStoreOptions {
  dbPath?: string
  database?: Database.Database
}

interface JobRow {
  id: string
  teacher_id: string
  teaching_unit_id: string | null
  question_bank_id: string
  subject: string
  source_kind: string
  source_ref: string | null
  raw_text_hash: string
  status: string
  generator_model: string
  degraded: number
  draft_count: number
  created_at: string
  updated_at: string
}

interface FlashcardRow {
  id: string
  job_id: string
  teacher_id: string
  front: string
  back: string
  source_excerpt: string
  status: string
  provenance_json: string
  confidence: number
  front_grounded: number
  confirmed_question_id: string | null
  created_at: string
  updated_at: string
}

export function newFlashcardJobId(): string {
  return `fdc_${randomUUID().replace(/-/g, '').slice(0, 16)}`
}

export function newFlashcardDraftId(): string {
  return `dfc_${randomUUID().replace(/-/g, '').slice(0, 16)}`
}

export class FlashcardDraftStore {
  private readonly db: Database.Database
  private readonly ownsDb: boolean

  public constructor(options: FlashcardDraftStoreOptions = {}) {
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

  // -------------------------------------------------------------------------
  // jobs
  // -------------------------------------------------------------------------

  public saveJob(job: FlashcardDraftJob): void {
    this.db
      .prepare(
        `INSERT INTO flashcard_draft_jobs (
          id, teacher_id, teaching_unit_id, question_bank_id, subject,
          source_kind, source_ref, raw_text_hash, status, generator_model,
          degraded, draft_count, created_at, updated_at
        ) VALUES (
          @id, @teacher_id, @teaching_unit_id, @question_bank_id, @subject,
          @source_kind, @source_ref, @raw_text_hash, @status, @generator_model,
          @degraded, @draft_count, @created_at, @updated_at
        )
        ON CONFLICT(id) DO UPDATE SET
          teaching_unit_id = excluded.teaching_unit_id,
          question_bank_id = excluded.question_bank_id,
          subject = excluded.subject,
          source_kind = excluded.source_kind,
          source_ref = excluded.source_ref,
          raw_text_hash = excluded.raw_text_hash,
          status = excluded.status,
          generator_model = excluded.generator_model,
          degraded = excluded.degraded,
          draft_count = excluded.draft_count,
          updated_at = excluded.updated_at`
      )
      .run({
        id: job.id,
        teacher_id: job.teacherId,
        teaching_unit_id: job.teachingUnitId ?? null,
        question_bank_id: job.questionBankId,
        subject: job.subject,
        source_kind: job.sourceKind,
        source_ref: job.sourceRef ?? null,
        raw_text_hash: job.rawTextHash,
        status: job.status,
        generator_model: job.generatorModel,
        degraded: job.degraded ? 1 : 0,
        draft_count: job.draftCount,
        created_at: job.createdAt,
        updated_at: job.updatedAt
      })
  }

  public getJob(id: string): FlashcardDraftJob | undefined {
    const row = this.db
      .prepare(`SELECT * FROM flashcard_draft_jobs WHERE id = ?`)
      .get(id) as JobRow | undefined
    return row ? rowToJob(row) : undefined
  }

  public listJobsByTeacher(teacherId: string): FlashcardDraftJob[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM flashcard_draft_jobs
         WHERE teacher_id = ? ORDER BY created_at DESC`
      )
      .all(teacherId) as JobRow[]
    return rows.map(rowToJob)
  }

  public countJobsSince(teacherId: string, sinceIso: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS total FROM flashcard_draft_jobs
         WHERE teacher_id = ? AND created_at >= ?`
      )
      .get(teacherId, sinceIso) as { total: number } | undefined
    return row?.total ?? 0
  }

  // -------------------------------------------------------------------------
  // drafts
  // -------------------------------------------------------------------------

  public saveFlashcard(flashcard: FlashcardDraft): void {
    this.db
      .prepare(
        `INSERT INTO draft_flashcards (
          id, job_id, teacher_id, front, back, source_excerpt, status,
          provenance_json, confidence, front_grounded, confirmed_question_id,
          created_at, updated_at
        ) VALUES (
          @id, @job_id, @teacher_id, @front, @back, @source_excerpt, @status,
          @provenance_json, @confidence, @front_grounded, @confirmed_question_id,
          @created_at, @updated_at
        )
        ON CONFLICT(id) DO UPDATE SET
          front = excluded.front,
          back = excluded.back,
          source_excerpt = excluded.source_excerpt,
          status = excluded.status,
          provenance_json = excluded.provenance_json,
          confidence = excluded.confidence,
          front_grounded = excluded.front_grounded,
          confirmed_question_id = excluded.confirmed_question_id,
          updated_at = excluded.updated_at`
      )
      .run({
        id: flashcard.id,
        job_id: flashcard.jobId,
        teacher_id: flashcard.teacherId,
        front: flashcard.front,
        back: flashcard.back,
        source_excerpt: flashcard.sourceExcerpt,
        status: flashcard.status,
        provenance_json: JSON.stringify(flashcard.provenance),
        confidence: flashcard.confidence,
        front_grounded: flashcard.frontGrounded ? 1 : 0,
        confirmed_question_id: flashcard.confirmedQuestionId ?? null,
        created_at: flashcard.createdAt,
        updated_at: flashcard.updatedAt
      })
  }

  public getFlashcard(id: string): FlashcardDraft | undefined {
    const row = this.db
      .prepare(`SELECT * FROM draft_flashcards WHERE id = ?`)
      .get(id) as FlashcardRow | undefined
    return row ? rowToFlashcard(row) : undefined
  }

  public listFlashcardsByJob(jobId: string): FlashcardDraft[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM draft_flashcards WHERE job_id = ? ORDER BY created_at, rowid`
      )
      .all(jobId) as FlashcardRow[]
    return rows.map(rowToFlashcard)
  }

  public transaction<T>(operation: () => T): T {
    return this.db.transaction(operation)()
  }

  public close(): void {
    if (this.ownsDb) this.db.close()
  }
}

function rowToJob(row: JobRow): FlashcardDraftJob {
  const job: FlashcardDraftJob = {
    id: row.id,
    teacherId: row.teacher_id,
    questionBankId: row.question_bank_id,
    subject: row.subject as SubjectLanguage,
    sourceKind: row.source_kind as FlashcardSourceKind,
    rawTextHash: row.raw_text_hash,
    status: row.status as FlashcardJobStatus,
    generatorModel: row.generator_model,
    degraded: row.degraded === 1,
    draftCount: row.draft_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
  if (row.teaching_unit_id) job.teachingUnitId = row.teaching_unit_id
  if (row.source_ref) job.sourceRef = row.source_ref
  return job
}

function rowToFlashcard(row: FlashcardRow): FlashcardDraft {
  const flashcard: FlashcardDraft = {
    id: row.id,
    jobId: row.job_id,
    teacherId: row.teacher_id,
    front: row.front,
    back: row.back,
    sourceExcerpt: row.source_excerpt,
    status: row.status as FlashcardDraftStatus,
    provenance: JSON.parse(row.provenance_json) as FlashcardDraftProvenance,
    confidence: row.confidence,
    frontGrounded: row.front_grounded === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
  if (row.confirmed_question_id) {
    flashcard.confirmedQuestionId = row.confirmed_question_id
  }
  return flashcard
}
