import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'

/**
 * Shared SQLite schema for the memory layer (mastery + review).
 * Lives in the same .db file as audit logs (ADR-0007: same DB, separate tables).
 * Does not open or modify AuditStore internals.
 */
export function openMemoryDatabase(dbPath: string): Database.Database {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true })
  }

  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  migrateMemorySchema(db)
  return db
}

/**
 * Idempotent migrations for mastery_scores, review_cards, and evaluations.provenance.
 */
export function migrateMemorySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mastery_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id TEXT NOT NULL,
      kp_id TEXT NOT NULL,
      score REAL NOT NULL,
      evidence_ids TEXT NOT NULL,
      computed_at TEXT NOT NULL,
      algorithm_version TEXT NOT NULL,
      prev_hash TEXT NOT NULL,
      hmac TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mastery_student_kp
      ON mastery_scores (student_id, kp_id, computed_at DESC);

    CREATE TABLE IF NOT EXISTS review_cards (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      kp_id TEXT NOT NULL,
      stability REAL NOT NULL,
      difficulty REAL NOT NULL,
      due_at TEXT NOT NULL,
      state TEXT NOT NULL,
      reps INTEGER NOT NULL DEFAULT 0,
      lapses INTEGER NOT NULL DEFAULT 0,
      last_review_at TEXT,
      elapsed_days REAL NOT NULL DEFAULT 0,
      scheduled_days REAL NOT NULL DEFAULT 0,
      learning_steps INTEGER NOT NULL DEFAULT 0,
      prev_hash TEXT NOT NULL,
      hmac TEXT NOT NULL,
      UNIQUE (student_id, kp_id)
    );
    CREATE INDEX IF NOT EXISTS idx_review_due
      ON review_cards (student_id, due_at ASC);

    CREATE TABLE IF NOT EXISTS evaluations (
      id TEXT PRIMARY KEY,
      student_id TEXT,
      assignment_id TEXT,
      created_at TEXT,
      score REAL,
      status TEXT,
      provenance TEXT NOT NULL DEFAULT '{"kind":"evidence"}'
    );
  `)

  // Backfill / alter path for older evaluations tables missing provenance.
  const columns = db
    .prepare(`PRAGMA table_info(evaluations)`)
    .all() as Array<{ name: string }>
  const hasProvenance = columns.some((column) => column.name === 'provenance')
  if (!hasProvenance && columns.length > 0) {
    db.exec(
      `ALTER TABLE evaluations ADD COLUMN provenance TEXT NOT NULL DEFAULT '{"kind":"evidence"}'`
    )
  }
}
