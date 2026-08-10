/**
 * T15 SQLite 存储：material_import_jobs + draft_questions（迁移 0012）。
 *
 * 与 T04 `ImportDraftStore` 同构，共享 product DB 迁移路径。
 * 这两张表里没有任何 score / evidence / attempt 列 —— 草稿永远不是成绩数据。
 */
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import type { SubjectLanguage } from '../../shared/contracts'
import type {
  DraftQuestion,
  DraftQuestionProvenance,
  DraftQuestionStatus,
  MaterialImportJob,
  MaterialImportJobStatus,
  MaterialSourceKind,
  QuestionDraftShape
} from '../../shared/materialImport'
import { applyProductMigrations } from '../db/migrate'

export interface MaterialImportStoreOptions {
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

interface DraftRow {
  id: string
  job_id: string
  teacher_id: string
  payload_json: string
  source_excerpt: string
  status: string
  provenance_json: string
  confidence: number
  confirmed_question_id: string | null
  created_at: string
  updated_at: string
}

export function newMaterialJobId(): string {
  return `mij_${randomUUID().replace(/-/g, '').slice(0, 16)}`
}

export function newDraftQuestionId(): string {
  return `dq_${randomUUID().replace(/-/g, '').slice(0, 16)}`
}

export class MaterialImportStore {
  private readonly db: Database.Database
  private readonly ownsDb: boolean

  public constructor(options: MaterialImportStoreOptions = {}) {
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

  public saveJob(job: MaterialImportJob): void {
    this.db
      .prepare(
        `INSERT INTO material_import_jobs (
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

  public getJob(id: string): MaterialImportJob | undefined {
    const row = this.db
      .prepare(`SELECT * FROM material_import_jobs WHERE id = ?`)
      .get(id) as JobRow | undefined
    return row ? rowToJob(row) : undefined
  }

  public listJobsByTeacher(teacherId: string): MaterialImportJob[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM material_import_jobs
         WHERE teacher_id = ? ORDER BY created_at DESC`
      )
      .all(teacherId) as JobRow[]
    return rows.map(rowToJob)
  }

  /** 配额提示用：某教师自 `sinceIso` 起创建的任务数。 */
  public countJobsSince(teacherId: string, sinceIso: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS total FROM material_import_jobs
         WHERE teacher_id = ? AND created_at >= ?`
      )
      .get(teacherId, sinceIso) as { total: number } | undefined
    return row?.total ?? 0
  }

  // -------------------------------------------------------------------------
  // drafts
  // -------------------------------------------------------------------------

  public saveDraft(draft: DraftQuestion): void {
    this.db
      .prepare(
        `INSERT INTO draft_questions (
          id, job_id, teacher_id, payload_json, source_excerpt, status,
          provenance_json, confidence, confirmed_question_id, created_at, updated_at
        ) VALUES (
          @id, @job_id, @teacher_id, @payload_json, @source_excerpt, @status,
          @provenance_json, @confidence, @confirmed_question_id, @created_at, @updated_at
        )
        ON CONFLICT(id) DO UPDATE SET
          payload_json = excluded.payload_json,
          source_excerpt = excluded.source_excerpt,
          status = excluded.status,
          provenance_json = excluded.provenance_json,
          confidence = excluded.confidence,
          confirmed_question_id = excluded.confirmed_question_id,
          updated_at = excluded.updated_at`
      )
      .run({
        id: draft.id,
        job_id: draft.jobId,
        teacher_id: draft.teacherId,
        payload_json: JSON.stringify(draft.payload),
        source_excerpt: draft.sourceExcerpt,
        status: draft.status,
        provenance_json: JSON.stringify(draft.provenance),
        confidence: draft.confidence,
        confirmed_question_id: draft.confirmedQuestionId ?? null,
        created_at: draft.createdAt,
        updated_at: draft.updatedAt
      })
  }

  public getDraft(id: string): DraftQuestion | undefined {
    const row = this.db
      .prepare(`SELECT * FROM draft_questions WHERE id = ?`)
      .get(id) as DraftRow | undefined
    return row ? rowToDraft(row) : undefined
  }

  public listDraftsByJob(jobId: string): DraftQuestion[] {
    const rows = this.db
      .prepare(
        // rowid 兜底：同一批草稿 created_at 相同，需按插入顺序返回，
        // 让并排校对顺序 == 生成顺序（id 是随机串，不能用于排序）。
        `SELECT * FROM draft_questions WHERE job_id = ? ORDER BY created_at, rowid`
      )
      .all(jobId) as DraftRow[]
    return rows.map(rowToDraft)
  }

  public transaction<T>(operation: () => T): T {
    return this.db.transaction(operation)()
  }

  public close(): void {
    if (this.ownsDb) this.db.close()
  }
}

function rowToJob(row: JobRow): MaterialImportJob {
  const job: MaterialImportJob = {
    id: row.id,
    teacherId: row.teacher_id,
    questionBankId: row.question_bank_id,
    subject: row.subject as SubjectLanguage,
    sourceKind: row.source_kind as MaterialSourceKind,
    rawTextHash: row.raw_text_hash,
    status: row.status as MaterialImportJobStatus,
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

function rowToDraft(row: DraftRow): DraftQuestion {
  const draft: DraftQuestion = {
    id: row.id,
    jobId: row.job_id,
    teacherId: row.teacher_id,
    payload: JSON.parse(row.payload_json) as QuestionDraftShape,
    sourceExcerpt: row.source_excerpt,
    status: row.status as DraftQuestionStatus,
    provenance: JSON.parse(row.provenance_json) as DraftQuestionProvenance,
    confidence: row.confidence,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
  if (row.confirmed_question_id) {
    draft.confirmedQuestionId = row.confirmed_question_id
  }
  return draft
}
