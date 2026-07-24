import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type Database from 'better-sqlite3'

const migrationsDir = dirname(fileURLToPath(import.meta.url))
const SQL_DIR = join(migrationsDir, 'migrations')

interface AppliedMigration {
  id: number
  name: string
}

/**
 * Apply product SQL migrations in order (0001 memory layer, 0002 org/attempts).
 * Idempotent: tracks applied files in schema_migrations.
 *
 * Prefer plain SQL over drizzle-orm/migrator so :memory: and file DBs share
 * one path without requiring a drizzle meta folder hash layout.
 */
export function applyProductMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    );
  `)

  const applied = new Set(
    (
      db.prepare(`SELECT name FROM schema_migrations`).all() as AppliedMigration[]
    ).map((row) => row.name)
  )

  const files = readdirSync(SQL_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()

  const insert = db.prepare(
    `INSERT INTO schema_migrations (name, applied_at) VALUES (@name, @applied_at)`
  )

  for (const file of files) {
    if (applied.has(file)) continue
    const sql = readFileSync(join(SQL_DIR, file), 'utf8')
    const run = db.transaction(() => {
      db.exec(sql)
      insert.run({ name: file, applied_at: new Date().toISOString() })
    })
    run()
  }

  ensureEvaluationsProvenanceColumn(db)
  ensureQuestionSolutionColumn(db)
}

/**
 * Backfill path for DBs that created `evaluations` before provenance existed.
 * Safe on fresh schemas (column already present).
 */
function ensureEvaluationsProvenanceColumn(db: Database.Database): void {
  const columns = db
    .prepare(`PRAGMA table_info(evaluations)`)
    .all() as Array<{ name: string }>
  if (columns.length === 0) return
  const hasProvenance = columns.some((column) => column.name === 'provenance')
  if (!hasProvenance) {
    db.exec(
      `ALTER TABLE evaluations ADD COLUMN provenance TEXT NOT NULL DEFAULT '{"kind":"evidence"}'`
    )
  }
}

/**
 * Backfill path (T09) for DBs that created `questions` (migration 0003) before
 * the standard-solution column existed. Safe on fresh schemas where migration
 * 0004 already added the column. No-op when the questions table is absent.
 */
function ensureQuestionSolutionColumn(db: Database.Database): void {
  const columns = db
    .prepare(`PRAGMA table_info(questions)`)
    .all() as Array<{ name: string }>
  if (columns.length === 0) return
  const hasSolution = columns.some((column) => column.name === 'solution_json')
  if (!hasSolution) {
    db.exec(`ALTER TABLE questions ADD COLUMN solution_json TEXT`)
  }
}
