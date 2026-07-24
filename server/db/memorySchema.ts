import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { applyProductMigrations } from './migrate'

/**
 * Shared SQLite schema for the memory layer (mastery + review) and product
 * org tables (T01). Lives in the same .db file as audit logs (ADR-0007).
 * Schema is defined TS-first in schema.ts; SQL migrations live under
 * server/db/migrations/ (0001 memory, 0002 product org).
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
 * Idempotent migrations for mastery_scores, review_cards, evaluations, and
 * product tables (attempts / terms / classes / teaching_units / enrollments / users).
 */
export function migrateMemorySchema(db: Database.Database): void {
  applyProductMigrations(db)
}
