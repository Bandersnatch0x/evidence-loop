/**
 * UploadStore — session lifecycle for media uploads (spec §5.5).
 *
 * State machine:
 *   uploading → quarantined → inspecting → processing → ready
 *                                       ↘ rejected / failed
 *   (any active) → failed         (cancel / expiry)
 *
 * Quota reservation is transactional with session creation (QuotaService +
 * single better-sqlite3 transaction). Terminal states release the reservation
 * implicitly because live usage = SUM over non-terminal sessions.
 */
import type Database from 'better-sqlite3'
import type { QuotaService } from './QuotaService'

export type UploadState =
  | 'uploading'
  | 'quarantined'
  | 'inspecting'
  | 'processing'
  | 'ready'
  | 'rejected'
  | 'failed'

export interface UploadSessionRow {
  id: string
  ownerId: string
  intendedKind: string
  declaredBytes: number
  receivedBytes: number
  tempKey: string
  state: UploadState
  quotaReservationBytes: number
  expiresAt: string
  createdAt: string
}

const TRANSITIONS: Record<UploadState, ReadonlySet<UploadState>> = {
  uploading: new Set(['quarantined', 'failed']),
  quarantined: new Set(['inspecting', 'rejected', 'failed']),
  inspecting: new Set(['processing', 'rejected', 'failed']),
  processing: new Set(['ready', 'failed']),
  ready: new Set(),
  rejected: new Set(),
  failed: new Set()
}

export class UploadStore {
  constructor(
    private readonly db: Database.Database,
    private readonly quotas: QuotaService
  ) {}

  create(input: {
    id: string
    ownerId: string
    kind: string
    declaredBytes: number
  }): UploadSessionRow {
    const now = new Date().toISOString()
    const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString() // tus 24h (spec §5.5)
    const tempKey = `${input.id}.part`

    const insert = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO upload_sessions
             (id, owner_id, intended_kind, declared_bytes, received_bytes,
              temp_key, state, quota_reservation_bytes, expires_at, created_at)
           VALUES (?, ?, ?, ?, 0, ?, 'uploading', ?, ?, ?)`
        )
        .run(
          input.id,
          input.ownerId,
          input.kind,
          input.declaredBytes,
          tempKey,
          input.declaredBytes,
          expiresAt,
          now
        )
      // Reserve in-transaction; throws roll back the INSERT atomically.
      this.quotas.reserveWithin(input.ownerId, input.id, input.declaredBytes)
    })
    insert()

    return this.get(input.id) as UploadSessionRow
  }

  get(id: string): UploadSessionRow | null {
    const row = this.db
      .prepare('SELECT * FROM upload_sessions WHERE id = ?')
      .get(id) as
      | {
          id: string
          owner_id: string
          intended_kind: string
          declared_bytes: number
          received_bytes: number
          temp_key: string
          state: UploadState
          quota_reservation_bytes: number
          expires_at: string
          created_at: string
        }
      | undefined
    if (!row) return null
    return {
      id: row.id,
      ownerId: row.owner_id,
      intendedKind: row.intended_kind,
      declaredBytes: row.declared_bytes,
      receivedBytes: row.received_bytes,
      tempKey: row.temp_key,
      state: row.state,
      quotaReservationBytes: row.quota_reservation_bytes,
      expiresAt: row.expires_at,
      createdAt: row.created_at
    }
  }

  /** Record server-counted bytes received. Rejects when exceeding declared. */
  recordReceived(id: string, additionalBytes: number): void {
    const session = this.get(id)
    if (!session) throw new Error(`Upload session not found: ${id}`)
    if (session.state !== 'uploading') {
      throw new Error(`Upload session ${id} not in uploading state`)
    }
    const next = session.receivedBytes + additionalBytes
    if (next > session.declaredBytes) {
      throw new Error(
        `Upload received ${next} bytes, exceeding declared ${session.declaredBytes}`
      )
    }
    this.db
      .prepare('UPDATE upload_sessions SET received_bytes = ? WHERE id = ?')
      .run(next, id)
  }

  markQuarantined(id: string): void {
    this.transition(id, 'quarantined')
  }
  markInspected(id: string): void {
    this.transition(id, 'inspecting')
  }
  markProcessing(id: string): void {
    this.transition(id, 'processing')
  }
  markReady(id: string): void {
    this.transition(id, 'ready')
  }
  markRejected(id: string): void {
    this.transition(id, 'rejected')
  }
  markFailed(id: string): void {
    this.transition(id, 'failed')
  }

  /** Cancel a session: terminal failed state releases the quota reservation. */
  cancel(id: string): void {
    this.transition(id, 'failed')
  }

  /** Sessions past their 24h window still in an active state. */
  findExpired(now = Date.now()): string[] {
    const rows = this.db
      .prepare(
        `SELECT id FROM upload_sessions
         WHERE expires_at < ? AND state IN (${ACTIVE_SQL})`
      )
      .all(new Date(now).toISOString()) as Array<{ id: string }>
    return rows.map((r) => r.id)
  }

  /**
   * Number of live sessions for an owner (spec §9: 同时 2 个上传).
   * Active = uploading/quarantined/inspecting/processing.
   */
  activeCount(ownerId: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM upload_sessions
         WHERE owner_id = ? AND state IN (${ACTIVE_SQL})`
      )
      .get(ownerId) as { n: number }
    return row.n
  }

  /** Sessions currently in a given non-terminal state (worker polling). */
  listByState(state: UploadState): Array<{ id: string }> {
    return this.db
      .prepare('SELECT id FROM upload_sessions WHERE state = ?')
      .all(state) as Array<{ id: string }>
  }

  private transition(id: string, target: UploadState): void {
    const session = this.get(id)
    if (!session) throw new Error(`Upload session not found: ${id}`)
    if (!TRANSITIONS[session.state].has(target)) {
      throw new Error(
        `Invalid upload session transition: ${session.state} -> ${target}`
      )
    }
    this.db
      .prepare('UPDATE upload_sessions SET state = ? WHERE id = ?')
      .run(target, id)
  }
}

const ACTIVE_SQL = "'uploading','quarantined','inspecting','processing'"