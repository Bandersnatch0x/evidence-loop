import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import type {
  ImportDraft,
  ImportDraftItem,
  ImportDraftStatus,
  ImportParseMethod,
  SubjectLanguage
} from '../../shared/contracts'
import { applyProductMigrations } from '../db/migrate'

/**
 * SQLite-backed store for T04 import drafts. Shares the product DB migration
 * path with QuestionStore / AuthStore. Drafts are never Questions — only the
 * confirm gate promotes items into the question bank.
 */

export interface ImportDraftStoreOptions {
  dbPath?: string
  database?: Database.Database
}

interface ImportDraftRow {
  id: string
  author_id: string
  question_bank_id: string
  subject: string
  status: string
  source_filename: string
  parse_method: string
  raw_text: string
  items_json: string
  privacy_notice: string
  created_at: string
  confirmed_at: string | null
  confirmed_question_ids: string
  ocr_provider: string | null
  egress_class: string
  allows_egress: number
}

export function newImportDraftId(): string {
  return `imp_${randomUUID().replace(/-/g, '').slice(0, 16)}`
}

export class ImportDraftStore {
  private readonly db: Database.Database
  private readonly ownsDb: boolean

  public constructor(options: ImportDraftStoreOptions = {}) {
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

  public save(draft: ImportDraft): void {
    this.db
      .prepare(
        `INSERT INTO import_drafts (
          id, author_id, question_bank_id, subject, status, source_filename,
          parse_method, raw_text, items_json, privacy_notice, created_at,
          confirmed_at, confirmed_question_ids, ocr_provider, egress_class,
          allows_egress
        ) VALUES (
          @id, @author_id, @question_bank_id, @subject, @status, @source_filename,
          @parse_method, @raw_text, @items_json, @privacy_notice, @created_at,
          @confirmed_at, @confirmed_question_ids, @ocr_provider, @egress_class,
          @allows_egress
        )
        ON CONFLICT(id) DO UPDATE SET
          author_id = excluded.author_id,
          question_bank_id = excluded.question_bank_id,
          subject = excluded.subject,
          status = excluded.status,
          source_filename = excluded.source_filename,
          parse_method = excluded.parse_method,
          raw_text = excluded.raw_text,
          items_json = excluded.items_json,
          privacy_notice = excluded.privacy_notice,
          created_at = excluded.created_at,
          confirmed_at = excluded.confirmed_at,
          confirmed_question_ids = excluded.confirmed_question_ids,
          ocr_provider = excluded.ocr_provider,
          egress_class = excluded.egress_class,
          allows_egress = excluded.allows_egress`
      )
      .run(toRow(draft))
  }

  public get(id: string): ImportDraft | undefined {
    const row = this.db
      .prepare(`SELECT * FROM import_drafts WHERE id = ?`)
      .get(id) as ImportDraftRow | undefined
    return row ? rowToDraft(row) : undefined
  }

  public listByAuthor(authorId: string): ImportDraft[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM import_drafts WHERE author_id = ? ORDER BY created_at DESC`
      )
      .all(authorId) as ImportDraftRow[]
    return rows.map(rowToDraft)
  }

  public close(): void {
    if (this.ownsDb) this.db.close()
  }
}

function toRow(draft: ImportDraft): Record<string, string | number | null> {
  return {
    id: draft.id,
    author_id: draft.authorId,
    question_bank_id: draft.questionBankId,
    subject: draft.subject,
    status: draft.status,
    source_filename: draft.sourceFilename,
    parse_method: draft.parseMethod,
    raw_text: draft.rawText,
    items_json: JSON.stringify(draft.items),
    privacy_notice: draft.privacyNotice,
    created_at: draft.createdAt,
    confirmed_at: draft.confirmedAt ?? null,
    confirmed_question_ids: JSON.stringify(draft.confirmedQuestionIds),
    ocr_provider: draft.ocrProvider ?? null,
    egress_class: draft.egressClass,
    allows_egress: draft.allowsEgress ? 1 : 0
  }
}

function rowToDraft(row: ImportDraftRow): ImportDraft {
  const items = JSON.parse(row.items_json) as ImportDraftItem[]
  const confirmedQuestionIds = JSON.parse(
    row.confirmed_question_ids
  ) as string[]

  const draft: ImportDraft = {
    id: row.id,
    authorId: row.author_id,
    questionBankId: row.question_bank_id,
    subject: row.subject as SubjectLanguage,
    status: row.status as ImportDraftStatus,
    sourceFilename: row.source_filename,
    parseMethod: row.parse_method as ImportParseMethod,
    rawText: row.raw_text,
    items,
    privacyNotice: row.privacy_notice,
    createdAt: row.created_at,
    confirmedQuestionIds,
    egressClass: 'L1',
    allowsEgress: row.allows_egress === 1
  }
  if (row.confirmed_at) draft.confirmedAt = row.confirmed_at
  if (row.ocr_provider) draft.ocrProvider = row.ocr_provider
  return draft
}
