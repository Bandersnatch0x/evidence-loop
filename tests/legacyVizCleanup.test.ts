/**
 * Legacy visualization cleanup scripts — precheck + drop behavior.
 * Verifies the precheck gates correctly (ready / not-ready) and the drop
 * script is dry-run by default + refuses an unsafe DB.
 */
// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import Database from 'better-sqlite3'
import { openMemoryDatabase } from '../server/db/memorySchema'
import { ensureDemonstrationMigration } from '../server/demonstration/migrationRunner'
import { QuestionStore } from '../server/questionbank/QuestionStore'

const ROOT = process.cwd()
let tmpDir: string | undefined

afterEach(() => {
  if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true })
  tmpDir = undefined
})

function seedReviewedTeacher(db: Database.Database): void {
  db.prepare(
    `INSERT INTO users (id, person_id, role, login_id, display_name, created_at, public_library_reviewer)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run('reviewer-1', 'p-1', 'teacher', 'login-1', 'reviewer', new Date().toISOString(), 1)
}

/** Create a temp product DB with the legacy visualization column populated. */
function makeReadyDb(): string {
  tmpDir = mkdtempSync(join(tmpdir(), 'legacy-viz-'))
  const dbPath = join(tmpDir, 'product.sqlite')
  const db = openMemoryDatabase(dbPath)
  seedReviewedTeacher(db)
  const store = new QuestionStore({ database: db })
  // A question WITH a legacy visualization.
  store.save({
    id: 'q-legacy',
    questionBankId: 'qb-1',
    authorId: 'seed',
    subject: 'physics',
    questionType: 'choice',
    stem: 'legacy',
    payload: {},
    kpIds: [],
    difficulty: 1,
    source: 'authored_key',
    createdAt: new Date().toISOString(),
    visualization: { kind: 'curve', points: [[0, 0, 0], [1, 1, 1]] }
  })
  // Run Phase E migration → creates the preset demonstration + guard row.
  ensureDemonstrationMigration(db, store)
  db.pragma('wal_checkpoint(TRUNCATE)')
  db.close()
  return dbPath
}

function run(script: string, dbPath: string, args: string[] = []): { code: number; out: string } {
  const out = execFileSync('node', [join(ROOT, 'scripts', script), ...args], {
    env: { ...process.env, PRODUCT_DB_PATH: dbPath },
    encoding: 'utf8'
  })
  return { code: 0, out }
}

describe('legacy visualization cleanup scripts', () => {
  it('precheck passes when every legacy visualization is migrated + healthy', () => {
    const dbPath = makeReadyDb()
    const { out } = run('verify-legacy-viz-readiness.mjs', dbPath)
    expect(out).toContain('Precheck passed')
    expect(out).toContain('safe to drop')
  })

  it('precheck fails when a legacy visualization is unmigrated', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'legacy-viz-'))
    const dbPath = join(tmpDir, 'product.sqlite')
    const db = openMemoryDatabase(dbPath)
    seedReviewedTeacher(db)
    const store = new QuestionStore({ database: db })
    store.save({
      id: 'q-unmigrated',
      questionBankId: 'qb-1',
      authorId: 'seed',
      subject: 'physics',
      questionType: 'choice',
      stem: 'unmigrated',
      payload: {},
      kpIds: [],
      difficulty: 1,
      source: 'authored_key',
      createdAt: new Date().toISOString(),
      visualization: { kind: 'curve', points: [[0, 0, 0], [1, 1, 1]] }
    })
    db.pragma('wal_checkpoint(TRUNCATE)')
    db.close()
    let exitCode = 0
    let stderr = ''
    try {
      execFileSync('node', [join(ROOT, 'scripts', 'verify-legacy-viz-readiness.mjs')], {
        env: { ...process.env, PRODUCT_DB_PATH: dbPath },
        encoding: 'utf8',
        stdio: ['ignore', 'ignore', 'pipe']
      })
    } catch (error) {
      exitCode = (error as { status?: number }).status ?? 1
      stderr = (error as { stderr?: string }).stderr ?? ''
    }
    expect(exitCode).toBe(1)
    expect(stderr).toContain('NOT READY')
    expect(stderr).toContain('q-unmigrated')
  })

  it('drop script is dry-run by default and reports without changing the schema', () => {
    const dbPath = makeReadyDb()
    const { out } = run('drop-legacy-visualization.mjs', dbPath)
    expect(out).toContain('DRY-RUN')
    // Column still present.
    const db = new Database(dbPath)
    const cols = (db.prepare(`PRAGMA table_info(questions)`).all() as Array<{ name: string }>).map(
      (c) => c.name
    )
    db.close()
    expect(cols).toContain('visualization_json')
  })

  it('drop script with --force removes the column after a snapshot', () => {
    const dbPath = makeReadyDb()
    run('drop-legacy-visualization.mjs', dbPath, ['--force'])
    const db = new Database(dbPath)
    const cols = (db.prepare(`PRAGMA table_info(questions)`).all() as Array<{ name: string }>).map(
      (c) => c.name
    )
    db.close()
    expect(cols).not.toContain('visualization_json')
    // Snapshot JSON exists.
    const snapDir = join(tmpDir!, 'legacy-viz-snapshots')
    const snaps = existsSync(snapDir)
    expect(snaps).toBe(true)
  })
})
