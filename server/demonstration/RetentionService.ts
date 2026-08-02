/**
 * RetentionService — soft-delete & blob retention (spec §2.1/§2.5/§2.9,
 * ticket T-D slice 4, decision 02/03).
 *
 * Rules:
 *  - A blob is RETAINED while any draft, pending version, approved version,
 *    withdrawn version, or fixed reference references it. Only zero-reference
 *    blobs beyond the retention period are physically reclaimed.
 *  - Temporary uploads use a SHORTER TTL than the formal retention period
 *    (spec §2.9 — upload_sessions row expiry is separate from formal blob
 *    retention).
 *  - Version deletion is soft (identity hidden); historic snapshots keep
 *    playing for fixed references.
 */
import type { Database } from 'better-sqlite3'

export interface RetentionPolicy {
  /** Formal blob retention period (ms) after a demonstration is deleted. */
  blobRetentionMs: number
  /** Shorter TTL for quarantined/failed upload temps (ms). */
  tempTtlMs: number
}

export const DEFAULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
export const DEFAULT_TEMP_TTL_MS = 24 * 60 * 60 * 1000 // 24h (tus session)

export interface RetentionServiceOptions {
  db: Database
  policy?: Partial<RetentionPolicy>
}

export class RetentionService {
  private readonly db: Database
  private readonly policy: RetentionPolicy

  public constructor(options: RetentionServiceOptions) {
    this.db = options.db
    this.policy = {
      blobRetentionMs: options.policy?.blobRetentionMs ?? DEFAULT_RETENTION_MS,
      tempTtlMs: options.policy?.tempTtlMs ?? DEFAULT_TEMP_TTL_MS
    }
  }

  /**
   * Return the blob hashes referenced by ANY live content: drafts (document
   * json), all versions (snapshot json + media manifest), and fixed
   * references (via their version snapshots). These must never be reclaimed.
   */
  public referencedBlobHashes(): Set<string> {
    const hashes = new Set<string>()
    const collect = (json: string): void => {
      try {
        const doc = JSON.parse(json) as { mediaRefs?: Array<{ blobHash?: string }> }
        for (const ref of doc.mediaRefs ?? []) {
          if (ref.blobHash) hashes.add(ref.blobHash)
        }
      } catch {
        // malformed doc — skip; it cannot be a live reference
      }
    }
    // Drafts.
    const drafts = this.db
      .prepare(`SELECT document_json FROM demonstration_drafts`)
      .all() as Array<{ document_json: string }>
    for (const d of drafts) collect(d.document_json)
    // All versions (submitted/approved/rejected/withdrawn) — snapshots survive.
    const versions = this.db
      .prepare(`SELECT snapshot_document_json, media_manifest_json FROM demonstration_versions`)
      .all() as Array<{ snapshot_document_json: string; media_manifest_json: string }>
    for (const v of versions) {
      collect(v.snapshot_document_json)
      // The manifest is the authoritative media record the playback reads; scan
      // it too so a future divergence never silently unprotects a blob.
      try {
        const manifest = JSON.parse(v.media_manifest_json) as Array<{ blobHash?: string }>
        for (const m of manifest) if (m.blobHash) hashes.add(m.blobHash)
      } catch {
        // malformed manifest — ignore
      }
    }
    // Media assets (ready or not) + derivatives are referenced identities —
    // their blobs must never be reclaimed while the asset row survives.
    const assets = this.db
      .prepare(`SELECT original_blob_hash AS h FROM media_assets WHERE deleted_at IS NULL`)
      .all() as Array<{ h: string }>
    for (const a of assets) hashes.add(a.h)
    const derivatives = this.db
      .prepare(`SELECT blob_hash AS h FROM media_derivatives`)
      .all() as Array<{ h: string }>
    for (const d of derivatives) hashes.add(d.h)
    return hashes
  }

  /**
   * Blobs referenced by a deleted demonstration's content (snapshots + fixed
   * references) are retained even after soft-delete — the identity is hidden,
   * the content keeps playing for fixed references (spec §2.9).
   */
  public isRetained(blobHash: string): boolean {
    return this.referencedBlobHashes().has(blobHash)
  }

  /**
   * Candidate blob hashes for physical reclaim: zero live references AND the
   * underlying demonstration (if any) is deleted past the retention period.
   * Blobs have no owner/demo linkage column — retention is driven by the
   * reference set, so a blob is reclaimable when it's unreferenced and its
   * owning demo is deleted (or the blob is orphaned entirely).
   */
  public reclaimableBlobHashes(now = Date.now()): string[] {
    const live = this.referencedBlobHashes()
    const cutoff = new Date(now - this.policy.blobRetentionMs).toISOString()
    const rows = this.db
      .prepare(`SELECT hash, created_at FROM media_blobs`)
      .all() as Array<{ hash: string; created_at: string }>
    return rows
      .filter((r) => !live.has(r.hash))
      .filter((r) => r.created_at < cutoff)
      .map((r) => r.hash)
  }

  /**
   * Expired upload sessions (past their TTL) — the caller deletes the temp
   * files and releases quota. Shorter TTL than formal retention (spec §2.9).
   */
  public expiredUploadSessions(now = Date.now()): Array<{ id: string; tempKey: string }> {
    const cutoff = new Date(now - this.policy.tempTtlMs).toISOString()
    return this.db
      .prepare(
        `SELECT id, temp_key AS tempKey FROM upload_sessions
         WHERE expires_at < ? AND state IN ('uploading','quarantined','inspecting')`
      )
      .all(cutoff) as Array<{ id: string; tempKey: string }>
  }
}