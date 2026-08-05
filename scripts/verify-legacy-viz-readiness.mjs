/**
 * verify-legacy-viz-readiness.mjs — precheck gate for physical removal of the
 * legacy `questions.visualization_json` column (Next Step #1 / Phase E cleanup).
 *
 * Read-only. Verifies the Phase E dual-read window is stable BEFORE any column
 * is dropped, so the assignment display layer never loses demonstrable content:
 *
 *   1. coverage — every question with a non-null visualization_json has a
 *      visualization_migration_map row (its preset demonstration exists).
 *   2. health — every migrated preset version is approved and its demo is not
 *      soft-deleted (the assignment display surfaces it as a demonstration,
 *      not a legacy fallback).
 *
 * Exit 0 when ready (or nothing to clean); exit 1 when any legacy
 * visualization lacks a healthy migrated demonstration.
 *
 * Usage:
 *   node scripts/verify-legacy-viz-readiness.mjs
 *   PRODUCT_DB_PATH=/path node scripts/verify-legacy-viz-readiness.mjs
 */
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dbPath = process.env.PRODUCT_DB_PATH ?? join(root, '.data', 'product.sqlite')

if (!existsSync(dbPath)) {
  console.error(`Product DB not found at ${dbPath} — set PRODUCT_DB_PATH or run the server once.`)
  process.exit(1)
}

const db = new Database(dbPath, { readonly: true })

// Guard: the migration table must exist (Phase E migration ran).
const hasMapTable =
  db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='visualization_migration_map'`)
    .get() !== undefined
if (!hasMapTable) {
  console.error('visualization_migration_map table missing — run Phase E migration first.')
  db.close()
  process.exit(1)
}

// 1. Coverage: legacy visualizations without a migration-map row.
const unmigrated = db
  .prepare(
    `SELECT q.id AS questionId
     FROM questions q
     LEFT JOIN visualization_migration_map m ON m.question_id = q.id
     WHERE q.visualization_json IS NOT NULL AND q.visualization_json != ''
       AND m.question_id IS NULL`
  )
  .all()

// 2. Health: migrated presets that are NOT approved+healthy would leave the
//    assignment display with neither a demonstration nor (after drop) a legacy
//    fallback — a coverage gap.
const unhealthy = db
  .prepare(
    `SELECT m.question_id AS questionId, v.status, d.deleted_at AS deletedAt
     FROM visualization_migration_map m
     JOIN questions q ON q.id = m.question_id
     LEFT JOIN demonstration_versions v ON v.id = m.version_id
     LEFT JOIN teaching_demonstrations d ON d.id = m.demo_id
     WHERE q.visualization_json IS NOT NULL AND q.visualization_json != ''`
  )
  .all()

const legacyCount = (
  db
    .prepare(`SELECT COUNT(*) AS n FROM questions WHERE visualization_json IS NOT NULL AND visualization_json != ''`)
    .get()
).n
const migratedCount = (
  db.prepare(`SELECT COUNT(*) AS n FROM visualization_migration_map`).get()
).n

const unhealthyRows = unhealthy.filter(
  (row) => row.status !== 'approved' || row.deletedAt !== null
)

console.log('legacy visualization_json count:', legacyCount)
console.log('migration_map rows:', migratedCount)
console.log('unmigrated legacy visualizations:', unmigrated.length)
console.log('migrated but not approved/healthy:', unhealthyRows.length)

let failed = false
if (unmigrated.length > 0) {
  console.error('\nNOT READY — questions with legacy visualization but no migration:')
  for (const row of unmigrated.slice(0, 20)) console.error('  ', row.questionId)
  failed = true
}
if (unhealthyRows.length > 0) {
  console.error('\nNOT READY — migrated presets not approved/healthy:')
  for (const row of unhealthyRows.slice(0, 20))
    console.error(`   ${row.questionId} (status=${row.status}, deletedAt=${row.deletedAt})`)
  failed = true
}

db.close()
if (failed) {
  console.error('\nPrecheck FAILED — fix coverage/health before dropping the column.')
  process.exit(1)
}
console.log('\nPrecheck passed — legacy visualization column is safe to drop.')
