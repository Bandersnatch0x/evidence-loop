/**
 * MediaProcessor — upload worker (spec §5.5, research §4.1/§5).
 *
 * Orchestrates the quarantined → ready path without trusting any client
 * claim:
 *   1. Stream the temp file ONCE through a pass that (a) recomputes SHA-256,
 *      (b) snapshots the first 8 KiB for magic-byte sniffing, and (c) feeds
 *      the payload to the antivirus Scanner (single pass — research §5.1).
 *   2. Triangle gate: declared kind/size vs sniffed kind vs actual bytes.
 *   3. Scan result decides: clean → commit; infected → reject; fail_closed →
 *      keep quarantined (retryable, never published).
 *   4. Clean commit: atomic CAS move, then one SQLite transaction writes the
 *      blob row, the asset row (kind mapping: glb→model3d, vtt→subtitle), a
 *      derived-job row, and flips the session to ready — releasing its quota
 *      reservation (QuotaService counts non-terminal sessions only).
 */
import { createHash } from 'node:crypto'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { BlobStore } from './BlobStore'
import type { UploadStore } from './UploadStore'
import { detectExtension, detectKind, verifyTriangle } from './mediaGate'
import { parseMedia } from './MediaParser'
import type { Scanner } from './Scanner'

export interface MediaProcessorOptions {
  db: Database.Database
  blobs: BlobStore
  uploads: UploadStore
  scanner: Scanner
  tempRoot?: string
}

export interface ProcessResult {
  ok: boolean
  reason?: string
  blobHash?: string
}

/** Map gate kind (image/glb/video/vtt) → media_assets.kind (5-value enum). */
const ASSET_KIND: Record<string, string> = {
  image: 'image',
  glb: 'model3d',
  video: 'video',
  vtt: 'subtitle',
  audio: 'audio'
}

const SNIFF_BYTES = 8 * 1024

export class MediaProcessor {
  private readonly db: Database.Database
  private readonly blobs: BlobStore
  private readonly uploads: UploadStore
  private readonly scanner: Scanner

  constructor(options: MediaProcessorOptions) {
    this.db = options.db
    this.blobs = options.blobs
    this.uploads = options.uploads
    this.scanner = options.scanner
  }

  async processUpload(uploadId: string): Promise<ProcessResult> {
    const session = this.uploads.get(uploadId)
    if (!session) return { ok: false, reason: `unknown upload session ${uploadId}` }
    // Worker only consumes fully-received quarantined sessions; uploading is the
    // caller's job to advance (markQuarantined) before processing. This keeps
    // the state machine authoritative.
    if (session.state !== 'quarantined') {
      return { ok: false, reason: `session ${uploadId} not quarantined (state=${session.state})` }
    }
    // A fully-received session waiting quarantine still needs its bytes; guard
    // under-received sessions.
    if (session.receivedBytes < session.declaredBytes) {
      return { ok: false, reason: `session ${uploadId} incomplete (${session.receivedBytes}/${session.declaredBytes})` }
    }

    const tempStream = await this.blobs.openTemp(session.tempKey)

    // Single pass: hash + first-8KiB snapshot + scanner in one pipeline.
    const hashInstance = createHash('sha256')
    let computedHash = ''
    let sniffBytes: Buffer = Buffer.alloc(0)
    const hasher = new Transform({
      transform(chunk, _enc, cb) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        if (sniffBytes.length < SNIFF_BYTES) {
          const need = SNIFF_BYTES - sniffBytes.length
          sniffBytes = Buffer.concat([sniffBytes, buf.subarray(0, need)])
        }
        hashInstance.update(buf)
        cb(null, buf)
      }
    })

    let scan
    try {
      scan = await this.scanner.scan(
        pipelineToStringStream(tempStream, hasher),
        session.declaredBytes
      )
      computedHash = hashInstance.digest('hex')
    } catch (err) {
      scan = { status: 'fail_closed', reason: String(err) }
      // Pipeline failure may leave the temp file in an unknown mid-read state;
      // keep it quarantined for retry.
      return this.failClosed(session.id, `scan error: ${String(err)}`)
    }

    if (scan.status === 'fail_closed') {
      return this.failClosed(session.id, scan.reason ?? 'scan fail-closed')
    }
    if (scan.status === 'infected') {
      return await this.reject(session.id, `infected: ${scan.signature ?? 'signature'}`)
    }
    // Triangle gate over the recomputed facts.
    const sniffedKind = detectKind(sniffBytes)
    const triangle = verifyTriangle({
      declaredKind: session.intendedKind,
      declaredBytes: session.declaredBytes,
      actualBytes: session.receivedBytes,
      sniffedKind
    })
    if (!triangle.ok) {
      return await this.reject(session.id, triangle.reason ?? 'triangle mismatch')
    }

    // v1 real-parse gate (decision A): header/structure validation on the
    // sniff window — image caps (40MP/16,384px) + GLB structural checks.
    const parsed = parseMedia({
      kind: session.intendedKind,
      sniff: sniffBytes,
      declaredBytes: session.declaredBytes
    })
    if (!parsed.ok) {
      return await this.reject(session.id, parsed.reason ?? 'media parse failed')
    }

    const ext = detectExtension(sniffBytes) ?? '.bin'
    const stored = await this.blobs.commitByHash(session.tempKey, computedHash, ext)

    // One transaction: blob + asset + derivative job + session ready.
    const now = new Date().toISOString()
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT OR IGNORE INTO media_blobs
             (hash, canonical_extension, media_type, byte_size, storage_key, scan_status, created_at)
           VALUES (?, ?, ?, ?, ?, 'clean', ?)`
        )
        .run(
          stored.hash,
          ext,
          mediaTypeFor(ext),
          stored.byteSize,
          stored.storageKey,
          now
        )

      const assetId = randomUUID()
      this.db
        .prepare(
          `INSERT INTO media_assets
             (id, owner_id, kind, original_blob_hash, status, display_name, created_at)
           VALUES (?, ?, ?, ?, 'ready', ?, ?)`
        )
        .run(
          assetId,
          session.ownerId,
          ASSET_KIND[session.intendedKind] ?? session.intendedKind,
          stored.hash,
          `${session.intendedKind} asset`,
          now
        )

      // Derived artifacts job queued (thumbnail/display etc. — T-B impl),
      // available immediately for the worker loop.
      this.db
        .prepare(
          `INSERT OR IGNORE INTO media_jobs
             (id, asset_id, job_type, state, attempts, available_at)
           VALUES (?, ?, 'derivative', 'queued', 0, ?)`
        )
        .run(randomUUID(), assetId, now)

      this.uploads.markInspected(session.id)
      this.uploads.markProcessing(session.id)
      this.uploads.markReady(session.id)
    })
    try {
      tx()
    } catch (err) {
      // Worker must never crash the HTTP layer: roll back the CAS file that
      // was committed before the transaction and mark the session failed.
      await this.blobs.delete(stored.hash).catch(() => undefined)
      try {
        this.uploads.markRejected(session.id)
      } catch {
        // fall through
      }
      return {
        ok: false,
        reason: err instanceof Error ? `db commit failed: ${err.message}` : 'db commit failed'
      }
    }

    return { ok: true, blobHash: stored.hash }
  }

  private async reject(uploadId: string, reason: string): Promise<ProcessResult> {
    try {
      this.uploads.markRejected(uploadId)
    } catch {
      // Already terminal — fine.
    }
    await this.blobs.discardTemp(
      this.uploads.get(uploadId)?.tempKey ?? `${uploadId}.part`
    )
    return { ok: false, reason }
  }

  private failClosed(uploadId: string, reason: string): ProcessResult {
    // Keep quarantined — retryable by the worker loop; never reject.
    return { ok: false, reason }
  }
}

function mediaTypeFor(ext: string): string {
  switch (ext) {
    case '.png':
      return 'image/png'
    case '.jpg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    case '.glb':
      return 'model/gltf-binary'
    case '.mp4':
      return 'video/mp4'
    case '.webm':
      return 'video/webm'
    case '.vtt':
      return 'text/vtt'
    default:
      return 'application/octet-stream'
  }
}

/**
 * Pipe the hasher's output into the scanner such that the scanner sees the
 * byte stream. Pipeline errors propagate to the caller's catch.
 */
function pipelineToStringStream(
  source: NodeJS.ReadableStream,
  hasher: Transform
): NodeJS.ReadableStream {
  // scanner.scan accepts a stream; drive it via pipeline into a sink that the
  // scanner's implementation controls (ClamAV writes to its socket, others
  // drain). Simplest contract: pass the transform output as the readable.
  const passthrough = new Transform({ transform(c, _e, cb) { cb(null, c) } })
  void pipeline(source, hasher, passthrough).catch(() => {
    /* surfaced via scan() rejection */
  })
  return passthrough
}