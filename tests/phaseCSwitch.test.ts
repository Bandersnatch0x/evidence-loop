/**
 * T-L Phase C write-path switch tests — adopt-visualization now writes the new
 * demonstration model (dual-read fallback retained), student-side generation
 * entry is removed, and the rollback path keeps scoring/answering alive when
 * the new model fails (spec §7.4/§7.5).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Database from 'better-sqlite3'
import { applyProductMigrations } from '../server/db/migrate'
import { QuestionStore } from '../server/questionbank/QuestionStore'
import { QuestionBankService } from '../server/questionbank/QuestionBankService'
import { ensureDemonstrationMigration } from '../server/demonstration/migrationRunner'
import { SEED_AUTHOR_ID } from '../server/questionbank/seedFromAssignments'
import type { Visualization } from '../shared/contracts'

const HELIX: Visualization = {
  kind: 'curve',
  points: [[0, 0, 0], [0.5, 0.2, 0.3], [1, 0.5, 0.6]],
  label: '磁场螺旋'
}

function makeEnv(): {
  db: Database.Database
  store: QuestionStore
  bank: QuestionBankService
} {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  applyProductMigrations(db)
  const store = new QuestionStore({ database: db })
  const bank = new QuestionBankService({ store })
  return { db, store, bank }
}

function seedQuestion(
  env: { store: QuestionStore },
  id: string,
  viz?: Visualization,
  author = SEED_AUTHOR_ID
): void {
  env.store.save({
    id,
    questionBankId: 'qb-1',
    authorId: author,
    subject: 'physics',
    questionType: 'choice',
    stem: '演示题',
    payload: { kind: 'choice', options: [{ id: 'a', text: 'a' }, { id: 'b', text: 'b' }], correctOptionIds: ['a'] },
    kpIds: ['kp.phy.demo'],
    difficulty: 3,
    source: 'authored_key',
    createdAt: new Date().toISOString(),
    visualization: viz
  } as never)
}

describe('T-L write-path switch (Phase C)', () => {
  it('adopt-visualization no longer persists a legacy field (column deleted, #30)', () => {
    const env = makeEnv()
    seedQuestion(env, 'q1')
    env.bank.adoptVisualization('q1', SEED_AUTHOR_ID, HELIX)

    // Phase C (#30): the legacy visualization_json column is deleted, so
    // adopting a visualization cannot persist it. The field stays transient
    // (a no-op write) and the store never returns it.
    const question = env.store.get('q1')
    expect(question?.visualization).toBeUndefined()
  })

  it('new-model failure does not block scoring/answering (rollback path, spec §7.5)', () => {
    const env = makeEnv()
    seedQuestion(env, 'q1')
    // Simulate new-model failure: corrupt the migration guard table schema by
    // dropping the demo tables — migration runner must fail WITHOUT touching
    // the question (old path keeps working).
    env.db.exec(`DROP TABLE demonstration_versions`)
    env.db.exec(`DROP TABLE demonstration_drafts`)
    env.db.exec(`DROP TABLE teaching_demonstrations`)
    expect(() => ensureDemonstrationMigration(env.db, env.store)).toThrow()
    // Question untouched — scoring/answering unaffected.
    const question = env.store.get('q1')
    expect(question?.stem).toBe('演示题')
  })
})

describe('T-L student-side generation entry removed', () => {
  it('student never authors/binds demonstrations (ticket 07 contract)', () => {
    // App.tsx no longer mounts StudentVizPreview for the student role.
    const appSource = readFileSync(resolve(__dirname, '../src/App.tsx'), 'utf8')
    expect(appSource).not.toMatch(/demoRole === 'student' \? <StudentVizPreview/)
    expect(appSource).toMatch(/StudentVizPreview \(student-side generation entry\) removed/)
  })
})
