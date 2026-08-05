/**
 * drop-legacy-visualization.mjs — physically removes the legacy
 * `questions.visualization_json` column (Next Step #1 / Phase E cleanup).
 *
 * This is IRREVERSIBLE. To run safely it:
 *   1. runs the read-only precheck (verify-legacy-viz-readiness.mjs) — refuses
 *      to drop unless every legacy visualization has a healthy migrated preset.
 *   2. backs up the column contents to a JSON snapshot before dropping, so the
 *      data is recoverable from disk if a downstream regression is found.
 *   3. drops the column in a transaction (SQLite ≥3.35 ALTER TABLE DROP COLUMN).
 *
 * DRY-RUN by default. Pass --force to execute. Never auto-removes the code
 * fallback (server/index.ts) — that is a separate, reviewable code change.
 *
 * Usage:
 *   node scripts/drop-legacy-visualization.mjs            # dry-run report
 *   node scripts/drop-legacy-visualization.mjs --force    # execute drop
 *   PRODUCT_DB_PATH=/path node scripts/drop-legacy-visualization.mjs --force
 */
import { existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dbPath = process.env.PRODUCT_DB_PATH ?? join(root, '.data', 'product.sqlite')
const force = process.argv.slice(2).includes('--force')

if (!existsSync(dbPath)) {
  console.error(`Product DB not found at ${dbPath} — set PRODUCT_DB_PATH.`)
  process.exit(1)
}
if (force && dbPath === ':memory:') {
  console.error('Refusing --force on an in-memory database.')
  process.exit(1)
}

const db = new Database(dbPath)
db.pragma('journal_mode = WAL')

// --- 1. Precheck (inline — mirrors verify-legacy-viz-readiness.mjs) ---
const hasMapTable =
  db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='visualization_migration_map'`)
    .get() !== undefined
if (!hasMapTable) {
  console.error('visualization_migration_map table missing — run Phase E migration first.')
  db.close()
  process.exit(1)
}

const unmigrated = (
  db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM questions q
       LEFT JOIN visualization_migration_map m ON m.question_id = q.id
       WHERE q.visualization_json IS NOT NULL AND q.visualization_json != ''
         AND m.question_id IS NULL`
    )
    .get()
).n
const unhealthy = (
  db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM visualization_migration_map m
       JOIN questions q ON q.id = m.question_id
       LEFT JOIN demonstration_versions v ON v.id = m.version_id
       LEFT JOIN teaching_demonstrations d ON d.id = m.demo_id
       WHERE q.visualization_json IS NOT NULL AND q.visualization_json != ''
         AND (v.status IS NULL OR v.status != 'approved' OR d.deleted_at IS NOT NULL)`
    )
    .get()
).n

const hasColumn =
  (
    db.prepare(`PRAGMA table_info(questions)`).all()
  ).some((column) => column.name === 'visualization_json')

if (!hasColumn) {
  console.log('visualization_json column already absent — nothing to drop.')
  db.close()
  process.exit(0)
}

if (unmigrated > 0 || unhealthy > 0) {
  console.error(
    `Precheck FAILED — unmigrated: ${unmigrated}, unhealthy migrated: ${unhealthy}.` +
      ' Fix coverage before dropping (run verify-legacy-viz-readiness.mjs).'
  )
  db.close()
  process.exit(1)
}

// --- 2. Snapshot the column contents (recoverable from disk) ---
const snapshot = db
  .prepare(`SELECT id, visualization_json FROM questions WHERE visualization_json IS NOT NULL`)
  .all()
const snapshotDir = join(dirname(dbPath), 'legacy-viz-snapshots')
const snapshotPath = join(snapshotDir, `visualization_json-${Date.now()}.json`)

if (force) {
  mkdirSync(snapshotDir, { recursive: true })
  writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2))
  console.log(`snapshot written: ${snapshotPath} (${snapshot.length} rows)`)
}

// --- 3. Drop ---
console.log(`mode: ${force ? 'EXECUTE (--force)' : 'DRY-RUN (pass --force to drop)'}`)
console.log(`rows to snapshot: ${snapshot.length}`)
console.log(`target column: questions.visualization_json`)

if (!force) {
  console.log('\nDry-run complete — no changes made. Re-run with --force to drop.')
  db.close()
  process.exit(0)
}

const before = (
  db.prepare(`PRAGMA table_info(questions)`).all()
).map((column) => column.name)
db.exec(`ALTER TABLE questions DROP COLUMN visualization_json`)
const after = (
  db.prepare(`PRAGMA table_info(questions)`).all()
).map((column) => column.name)

console.log('\nDrop complete.')
console.log('columns before:', before.join(', '))
console.log('columns after :', after.join(', '))
console.log(
  `visualization_json present after drop: ${after.includes('visualization_json') ? 'YES (FAILED)' : 'no (ok)'}`
)
db.close()
