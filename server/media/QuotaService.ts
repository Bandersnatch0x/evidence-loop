/**
 * QuotaService — per-teacher upload quota (spec §9: 5 GiB / teacher, v1).
 *
 * Quota is reserved at session creation, inside the same transaction that
 * inserts the session row (spec §5.5: "事务内预留配额"), and released when
 * the session reaches a terminal state (ready / rejected / failed / cancelled).
 *
 * Reservation accounting lives entirely in upload_sessions; there is no
 * separate quota table — SUM over active sessions per owner IS the live usage.
 * This keeps reservation and release atomic with the session state itself.
 */
import type Database from 'better-sqlite3'

export const PER_TEACHER_QUOTA_BYTES = 5 * 1024 ** 3 // 5 GiB (spec §9 table)

/** States whose reservation still counts against the live quota. */
const ACTIVE_STATES = ['uploading', 'quarantined', 'inspecting', 'processing']

export class QuotaService {
  constructor(private readonly db: Database.Database) {}

  /**
   * Live quota usage for an owner: sum of reservations of non-terminal
   * sessions. Terminal states (ready/rejected/failed) no longer count.
   * `excludeId` lets a session be checked without counting itself (used during
   * creation inside the same transaction).
   */
  usageBytes(ownerId: string, excludeId?: string): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(quota_reservation_bytes), 0) AS used
         FROM upload_sessions
         WHERE owner_id = ? AND state IN (${ACTIVE_STATES.map(() => '?').join(',')})
         AND id <> ?`
      )
      .get(ownerId, ...ACTIVE_STATES, excludeId ?? '') as { used: number }
    return row.used
  }

  /**
   * Reserve `bytes` for an owner. Must run inside the caller's transaction —
   * callers call this after INSERTing the session row within a `db.transaction`,
   * passing the session id so the just-inserted row is excluded from the live
   * usage total. Throws when the reservation would exceed the budget.
   */
  reserveWithin(ownerId: string, sessionId: string, bytes: number): void {
    const usage = this.usageBytes(ownerId, sessionId)
    if (usage + bytes > PER_TEACHER_QUOTA_BYTES) {
      throw new Error(
        `Media quota exceeded for ${ownerId}: ${usage + bytes} > ${PER_TEACHER_QUOTA_BYTES}`
      )
    }
    // No extra row to write: usage is derived from session rows. The caller's
    // transaction already holds the INSERT; a failed reservation throws and
    // rolls the INSERT back atomically.
  }
}