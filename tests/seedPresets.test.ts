// @vitest-environment node
/**
 * #32 seed preset demonstrations — built-in demos for the seed question bank,
 * replacing the deleted legacy visualization migration.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { applyProductMigrations } from '../server/db/migrate'
import { QuestionStore } from '../server/questionbank/QuestionStore'
import { seedQuestionsFromAssignments } from '../server/questionbank/seedFromAssignments'
import { seedPresetDemonstrations } from '../server/demonstration/seedPresets'

function makeDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  applyProductMigrations(db)
  return db
}

describe('seed preset demonstrations (#32)', () => {
  let db: Database.Database
  let store: QuestionStore

  beforeEach(() => {
    db = makeDb()
    store = new QuestionStore({ database: db })
    seedQuestionsFromAssignments(store)
  })

  it('creates primary demonstrations for the three preset seed questions', () => {
    const result = seedPresetDemonstrations(db)
    expect(result.created).toBe(3)

    const refs = db
      .prepare(
        `SELECT question_id, role FROM demonstration_references WHERE role = 'primary' ORDER BY question_id`
      )
      .all() as Array<{ question_id: string; role: string }>
    expect(refs.length).toBe(3)
    expect(refs.some((r) => r.question_id === 'seed:physics-magnetic-helix')).toBe(true)
    expect(refs.some((r) => r.question_id === 'seed:bio-dna-double-helix')).toBe(true)
    expect(refs.some((r) => r.question_id === 'seed:numeric-ohm-law')).toBe(true)
  })

  it('approves the preset versions so the display layer resolves them', () => {
    seedPresetDemonstrations(db)
    const approved = db
      .prepare(`SELECT COUNT(*) AS c FROM demonstration_versions WHERE status = 'approved'`)
      .get() as { c: number }
    expect(approved.c).toBe(3)
  })

  it('is idempotent — a second run skips already-linked questions', () => {
    const first = seedPresetDemonstrations(db)
    expect(first.created).toBe(3)
    const second = seedPresetDemonstrations(db)
    expect(second.created).toBe(0)
    expect(second.skipped).toBe(3)
    // No duplicate references or demos.
    const refs = db
      .prepare(`SELECT COUNT(*) AS c FROM demonstration_references WHERE role = 'primary'`)
      .get() as { c: number }
    expect(refs.c).toBe(3)
  })

  it('writes valid SceneDocuments that pass the security guards on submit', () => {
    seedPresetDemonstrations(db)
    const docs = db
      .prepare(`SELECT snapshot_document_json FROM demonstration_versions`)
      .all() as Array<{ snapshot_document_json: string }>
    expect(docs.length).toBe(3)
    for (const row of docs) {
      const doc = JSON.parse(row.snapshot_document_json) as { documentMeta: { sceneFormatVersion: string } }
      expect(doc.documentMeta.sceneFormatVersion).toBe('1.0')
    }
  })
})
