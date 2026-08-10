import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'

export type AuditAction =
  | 'evaluate'
  | 'view'
  | 'export'
  | 'delete'
  | 'publish'
  | 'withdraw'
  | 'approve'
  | 'reject'
  | 'takedown'
  | 'report'
  | 'upgrade_reference'
  | 'appeal'
export type AuditResourceType =
  | 'evaluation'
  | 'cohort'
  | 'assignment'
  | 'audit'
  | 'knowledge'
  | 'system'
  | 'demonstration'
  | 'publication'
  | 'media'
  | 'portfolio'
/**
 * Interaction modality for audit events (ADR-0005 §7).
 * `'canvas'` is reserved for Phase 2 handwriting — do not emit yet.
 */
export type AuditModality = 'text' | 'voice'

export interface AuditEventInput {
  actorRole: string
  actorId?: string
  action: AuditAction
  resourceType: AuditResourceType
  resourceId?: string
  studentId?: string
  containerId?: string
  result?: string
  /** Optional modality; omit for legacy text-path events. */
  modality?: AuditModality
  metadata?: Record<string, string | number | boolean | null>
}

export interface AuditRecord {
  id: string
  sequence: number
  timestamp: string
  actorRole: string
  actorId: string | null
  action: AuditAction
  resourceType: AuditResourceType
  resourceId: string | null
  studentId: string | null
  containerId: string | null
  result: string | null
  modality: AuditModality | null
  metadata: Record<string, string | number | boolean | null> | null
  prevHash: string
  hash: string
  signature: string
}

/** Teacher-view aggregation row: counts only, never content (ADR-0005 §7). */
export interface MultimodalUsageRow {
  studentId: string
  voiceCount: number
  lastVoiceAt: string
}

export interface AuditQuery {
  studentId?: string
  actorRole?: string
  action?: AuditAction
  from?: string
  to?: string
  limit?: number
}

export interface ChainVerificationResult {
  valid: boolean
  checkedCount: number
  brokenAtSequence?: number
  reason?: string
}

export interface AuditStoreOptions {
  dbPath: string
  hmacSecret: string
  flushIntervalMs?: number
  flushBatchSize?: number
}

const GENESIS_HASH = '0'.repeat(64)
const DEFAULT_FLUSH_INTERVAL_MS = 5_000
const DEFAULT_FLUSH_BATCH_SIZE = 100
const DEFAULT_QUERY_LIMIT = 200

interface PendingEvent extends AuditEventInput {
  id: string
  timestamp: string
}

interface StoredRow {
  id: string
  sequence: number
  timestamp: string
  actor_role: string
  actor_id: string | null
  action: string
  resource_type: string
  resource_id: string | null
  student_id: string | null
  container_id: string | null
  result: string | null
  modality: string | null
  metadata_json: string | null
  prev_hash: string
  hash: string
  signature: string
}

export class AuditStore {
  private readonly db: Database.Database
  private readonly hmacSecret: string
  private readonly flushIntervalMs: number
  private readonly flushBatchSize: number
  private readonly queue: PendingEvent[] = []
  private flushTimer: ReturnType<typeof setTimeout> | undefined
  private closed = false
  private lastHash = GENESIS_HASH
  private lastSequence = 0
  private flushChain: Promise<void> = Promise.resolve()
  private readonly isMemory: boolean

  private readonly insertStatement: Database.Statement

  public constructor(options: AuditStoreOptions) {
    if (options.hmacSecret.trim() === '') {
      throw new Error('AUDIT_HMAC_SECRET must be a non-empty string')
    }

    this.hmacSecret = options.hmacSecret
    this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS
    this.flushBatchSize = options.flushBatchSize ?? DEFAULT_FLUSH_BATCH_SIZE
    this.isMemory = options.dbPath === ':memory:'

    if (options.dbPath !== ':memory:') {
      mkdirSync(dirname(options.dbPath), { recursive: true })
    }

    this.db = new Database(options.dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        sequence INTEGER PRIMARY KEY,
        id TEXT NOT NULL UNIQUE,
        timestamp TEXT NOT NULL,
        actor_role TEXT NOT NULL,
        actor_id TEXT,
        action TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT,
        student_id TEXT,
        container_id TEXT,
        result TEXT,
        modality TEXT,
        metadata_json TEXT,
        prev_hash TEXT NOT NULL,
        hash TEXT NOT NULL,
        signature TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_student_time
        ON audit_logs (student_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp
        ON audit_logs (timestamp);
      CREATE INDEX IF NOT EXISTS idx_audit_actor_role
        ON audit_logs (actor_role);
    `)

    // Upgrade pre-021 databases that lack the modality column BEFORE
    // creating the modality index (CREATE TABLE IF NOT EXISTS will not
    // add columns to an existing table).
    ensureModalityColumn(this.db)
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_audit_modality_student
        ON audit_logs (modality, student_id, timestamp);
    `)

    this.insertStatement = this.db.prepare(`
      INSERT INTO audit_logs (
        sequence, id, timestamp, actor_role, actor_id, action, resource_type,
        resource_id, student_id, container_id, result, modality, metadata_json,
        prev_hash, hash, signature
      ) VALUES (
        @sequence, @id, @timestamp, @actor_role, @actor_id, @action, @resource_type,
        @resource_id, @student_id, @container_id, @result, @modality, @metadata_json,
        @prev_hash, @hash, @signature
      )
    `)

    const tip = this.db
      .prepare(
        `SELECT sequence, hash FROM audit_logs ORDER BY sequence DESC LIMIT 1`
      )
      .get() as { sequence: number; hash: string } | undefined
    if (tip) {
      this.lastSequence = tip.sequence
      this.lastHash = tip.hash
    }
  }

  /**
   * Enqueue an audit event. Returns immediately; never blocks the caller
   * on SQLite I/O. Flushes when the batch size is reached or the timer fires.
   */
  public enqueue(event: AuditEventInput): void {
    if (this.closed) {
      throw new Error('AuditStore is closed')
    }

    this.queue.push({
      ...event,
      id: `audit_${randomUUID()}`,
      timestamp: new Date().toISOString()
    })

    if (this.queue.length >= this.flushBatchSize) {
      this.scheduleFlush(0)
      return
    }

    if (this.flushTimer === undefined) {
      this.scheduleFlush(this.flushIntervalMs)
    }
  }

  public async flush(): Promise<void> {
    this.clearFlushTimer()
    const previous = this.flushChain
    let release!: () => void
    this.flushChain = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      this.flushSync()
    } finally {
      release()
    }
  }

  public async query(params: AuditQuery = {}): Promise<AuditRecord[]> {
    await this.flush()

    const clauses: string[] = []
    const bindings: Record<string, string | number> = {}

    if (params.studentId !== undefined) {
      clauses.push('student_id = @studentId')
      bindings.studentId = params.studentId
    }
    if (params.actorRole !== undefined) {
      clauses.push('actor_role = @actorRole')
      bindings.actorRole = params.actorRole
    }
    if (params.action !== undefined) {
      clauses.push('action = @action')
      bindings.action = params.action
    }
    if (params.from !== undefined) {
      clauses.push('timestamp >= @from')
      bindings.from = params.from
    }
    if (params.to !== undefined) {
      clauses.push('timestamp <= @to')
      bindings.to = params.to
    }

    const limit = Math.min(
      Math.max(params.limit ?? DEFAULT_QUERY_LIMIT, 1),
      1_000
    )
    bindings.limit = limit

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
    const rows = this.db
      .prepare(
        `SELECT * FROM audit_logs ${where} ORDER BY sequence DESC LIMIT @limit`
      )
      .all(bindings) as StoredRow[]

    return rows.map(rowToRecord)
  }

  /**
   * Aggregate voice tutoring usage for the teacher cohort panel.
   * Returns counts + last-used timestamps only — never transcript content.
   */
  public async getMultimodalUsage(): Promise<MultimodalUsageRow[]> {
    await this.flush()

    const rows = this.db
      .prepare(
        `SELECT student_id AS studentId,
                COUNT(*) AS voiceCount,
                MAX(timestamp) AS lastVoiceAt
         FROM audit_logs
         WHERE modality = 'voice'
           AND student_id IS NOT NULL
           AND result = 'success'
         GROUP BY student_id
         ORDER BY lastVoiceAt DESC`
      )
      .all() as Array<{
      studentId: string
      voiceCount: number
      lastVoiceAt: string
    }>

    return rows.map((row) => ({
      studentId: row.studentId,
      voiceCount: Number(row.voiceCount),
      lastVoiceAt: row.lastVoiceAt
    }))
  }

  public async verifyIntegrity(): Promise<ChainVerificationResult> {
    await this.flush()
    const rows = this.db
      .prepare(`SELECT * FROM audit_logs ORDER BY sequence ASC`)
      .all() as StoredRow[]

    let expectedPrev = GENESIS_HASH
    let expectedSequence = 1

    for (const row of rows) {
      if (row.sequence !== expectedSequence) {
        return {
          valid: false,
          checkedCount: expectedSequence - 1,
          brokenAtSequence: row.sequence,
          reason: `Unexpected sequence ${String(row.sequence)}, expected ${String(expectedSequence)}`
        }
      }

      if (row.prev_hash !== expectedPrev) {
        return {
          valid: false,
          checkedCount: expectedSequence - 1,
          brokenAtSequence: row.sequence,
          reason: 'Hash chain broken: prev_hash does not match previous record'
        }
      }

      const recomputedHash = computeRecordHash({
        id: row.id,
        sequence: row.sequence,
        timestamp: row.timestamp,
        actorRole: row.actor_role,
        actorId: row.actor_id,
        action: row.action,
        resourceType: row.resource_type,
        resourceId: row.resource_id,
        studentId: row.student_id,
        containerId: row.container_id,
        result: row.result,
        modality: row.modality,
        metadataJson: row.metadata_json,
        prevHash: row.prev_hash
      })

      if (recomputedHash !== row.hash) {
        return {
          valid: false,
          checkedCount: expectedSequence - 1,
          brokenAtSequence: row.sequence,
          reason: 'Record payload hash mismatch'
        }
      }

      const expectedSignature = signHash(recomputedHash, this.hmacSecret)
      if (!signaturesMatch(expectedSignature, row.signature)) {
        return {
          valid: false,
          checkedCount: expectedSequence - 1,
          brokenAtSequence: row.sequence,
          reason: 'HMAC signature verification failed'
        }
      }

      expectedPrev = row.hash
      expectedSequence += 1
    }

    return { valid: true, checkedCount: rows.length }
  }

  /**
   * Test helper: mutate a persisted field without going through the write path.
   * Used to demonstrate chain/signature break detection.
   *
   * Hardened (production tech-debt): this write bypass only runs against an
   * in-memory database outside production. A file-backed store or
   * NODE_ENV=production rejects it, so the tamper path can never exist as a
   * live API against a persisted audit log.
   */
  public async tamperForTest(
    sequence: number,
    field: 'result' | 'hash' | 'signature' | 'prev_hash',
    value: string
  ): Promise<void> {
    if (process.env.NODE_ENV === 'production' || !this.isMemory) {
      throw new Error(
        'tamperForTest is a test-only helper; refused on a persisted or production audit store'
      )
    }
    await this.flush()
    const allowed = new Set(['result', 'hash', 'signature', 'prev_hash'])
    if (!allowed.has(field)) {
      throw new Error(`Unsupported tamper field: ${field}`)
    }
    this.db
      .prepare(`UPDATE audit_logs SET ${field} = @value WHERE sequence = @sequence`)
      .run({ value, sequence })
  }

  public pendingCount(): number {
    return this.queue.length
  }

  public async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.clearFlushTimer()
    await this.flush()
    this.db.close()
  }

  private scheduleFlush(delayMs: number): void {
    this.clearFlushTimer()
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined
      void this.flush().catch((error: unknown) => {
        console.error('AuditStore flush failed:', error)
      })
    }, delayMs)
    // Allow the process to exit even if a flush timer is pending.
    if (typeof this.flushTimer === 'object' && 'unref' in this.flushTimer) {
      this.flushTimer.unref()
    }
  }

  private clearFlushTimer(): void {
    if (this.flushTimer !== undefined) {
      clearTimeout(this.flushTimer)
      this.flushTimer = undefined
    }
  }

  private flushSync(): void {
    if (this.queue.length === 0) return

    const batch = this.queue.splice(0, this.queue.length)
    const insertMany = this.db.transaction((events: PendingEvent[]) => {
      for (const event of events) {
        const sequence = this.lastSequence + 1
        const prevHash = this.lastHash
        const metadataJson =
          event.metadata === undefined ? null : JSON.stringify(event.metadata)
        const modality = event.modality ?? null
        const hash = computeRecordHash({
          id: event.id,
          sequence,
          timestamp: event.timestamp,
          actorRole: event.actorRole,
          actorId: event.actorId ?? null,
          action: event.action,
          resourceType: event.resourceType,
          resourceId: event.resourceId ?? null,
          studentId: event.studentId ?? null,
          containerId: event.containerId ?? null,
          result: event.result ?? null,
          modality,
          metadataJson,
          prevHash
        })
        const signature = signHash(hash, this.hmacSecret)

        this.insertStatement.run({
          sequence,
          id: event.id,
          timestamp: event.timestamp,
          actor_role: event.actorRole,
          actor_id: event.actorId ?? null,
          action: event.action,
          resource_type: event.resourceType,
          resource_id: event.resourceId ?? null,
          student_id: event.studentId ?? null,
          container_id: event.containerId ?? null,
          result: event.result ?? null,
          modality,
          metadata_json: metadataJson,
          prev_hash: prevHash,
          hash,
          signature
        })

        this.lastSequence = sequence
        this.lastHash = hash
      }
    })

    insertMany(batch)
  }
}

function computeRecordHash(input: {
  id: string
  sequence: number
  timestamp: string
  actorRole: string
  actorId: string | null
  action: string
  resourceType: string
  resourceId: string | null
  studentId: string | null
  containerId: string | null
  result: string | null
  modality: string | null
  metadataJson: string | null
  prevHash: string
}): string {
  // Canonical, order-stable payload for hash chaining.
  const payload = [
    input.id,
    String(input.sequence),
    input.timestamp,
    input.actorRole,
    input.actorId ?? '',
    input.action,
    input.resourceType,
    input.resourceId ?? '',
    input.studentId ?? '',
    input.containerId ?? '',
    input.result ?? '',
    input.modality ?? '',
    input.metadataJson ?? '',
    input.prevHash
  ].join('\n')

  return createHash('sha256').update(payload, 'utf8').digest('hex')
}

function signHash(hash: string, secret: string): string {
  return createHmac('sha256', secret).update(hash, 'utf8').digest('hex')
}

function rowToRecord(row: StoredRow): AuditRecord {
  let metadata: Record<string, string | number | boolean | null> | null = null
  if (row.metadata_json !== null) {
    try {
      metadata = JSON.parse(row.metadata_json) as Record<
        string,
        string | number | boolean | null
      >
    } catch {
      metadata = null
    }
  }

  return {
    id: row.id,
    sequence: row.sequence,
    timestamp: row.timestamp,
    actorRole: row.actor_role,
    actorId: row.actor_id,
    action: row.action as AuditAction,
    resourceType: row.resource_type as AuditResourceType,
    resourceId: row.resource_id,
    studentId: row.student_id,
    containerId: row.container_id,
    result: row.result,
    modality: parseModality(row.modality),
    metadata,
    prevHash: row.prev_hash,
    hash: row.hash,
    signature: row.signature
  }
}

function parseModality(value: string | null): AuditModality | null {
  if (value === 'text' || value === 'voice') return value
  return null
}

function ensureModalityColumn(db: Database.Database): void {
  const columns = db
    .prepare(`PRAGMA table_info(audit_logs)`)
    .all() as Array<{ name: string }>
  const hasModality = columns.some((column) => column.name === 'modality')
  if (!hasModality) {
    db.exec(`ALTER TABLE audit_logs ADD COLUMN modality TEXT`)
  }
}

function signaturesMatch(left: string, right: string): boolean {
  try {
    const leftBuf = Buffer.from(left, 'hex')
    const rightBuf = Buffer.from(right, 'hex')
    if (leftBuf.length === 0 || leftBuf.length !== rightBuf.length) {
      return false
    }
    return timingSafeEqual(leftBuf, rightBuf)
  } catch {
    return false
  }
}

export function resolveAuditHmacSecret(
  environment: NodeJS.ProcessEnv = process.env
): string {
  const configured = environment.AUDIT_HMAC_SECRET?.trim()
  if (configured) return configured

  // Production must supply a real secret — a hardcoded fallback would make
  // audit signatures forgeable and defeat the tamper-evidence guarantee.
  if (environment.NODE_ENV === 'production') {
    throw new Error(
      'AUDIT_HMAC_SECRET is required in production. Refusing to start with a '
      + 'hardcoded demo secret because it would make audit signatures forgeable.'
    )
  }

  // Demo/dev fallback only.
  return 'evidence-ring-demo-audit-hmac-secret'
}

/**
 * Stamp the actor fields for an audit event from a session principal. Most
 * route audit calls repeat actorRole/actorId/studentId verbatim; this helper
 * is the single place that maps a SessionUser to those fields (C3 #37).
 *
 * The caller spreads the result into AuditEventInput and adds the action-
 * specific fields (action / resourceType / resourceId / result / metadata).
 */
export function actorFields(user: {
  role: string
  userId: string
  studentId?: string
}): Pick<AuditEventInput, 'actorRole' | 'actorId' | 'studentId'> {
  return {
    actorRole: user.role,
    actorId: user.userId,
    studentId: user.studentId
  }
}
