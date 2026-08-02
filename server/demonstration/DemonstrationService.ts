/**
 * DemonstrationService — work/draft/version lifecycle (spec §2.1–§2.4, ticket
 * T-D slice 1). Enforces the domain invariants at the service layer:
 *
 *  - Small root: teaching_demonstrations holds identity + meta only; drafts
 *    and versions are separate aggregates (spec §2.1).
 *  - Draft is 1:1 with the demonstration and independently editable (spec §2.2);
 *    submitting freezes a snapshot into demonstration_versions.
 *  - At most ONE pending-approval version per demonstration; re-submit must
 *    wait for approval/rejection or withdraw first (spec §2.3).
 *  - Approval/rejection/withdrawal only change version status, NEVER content
 *    (spec §2.4).
 *  - Soft delete hides identity only; retained content survives (spec §2.9).
 *
 * All mutating operations emit audit events (spec §5.7).
 */
import type { Database } from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { parseSceneDocument, type SceneDocument } from './sceneDocumentSchema'
import { runSecurityGuards } from './sceneSecurity'
import { assertLicenseAllowed } from './licenseInheritance'

export class DemoNotFoundError extends Error {
  public constructor(id: string) {
    super(`Demonstration not found: ${id}`)
    this.name = 'DemoNotFoundError'
  }
}

export class DemoOwnershipError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'DemoOwnershipError'
  }
}

export class DemoVersionNotFoundError extends Error {
  public constructor(id: string) {
    super(`Demonstration version not found: ${id}`)
    this.name = 'DemoVersionNotFoundError'
  }
}

export class DemoSubmitError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'DemoSubmitError'
  }
}

export interface DemoMeta {
  title?: string
  description?: string
  subject?: string
  level?: string
  [key: string]: unknown
}

export interface SubmitOptions {
  classification: string
  license: string
  aiDisclosure: string
  reviewerNote?: string
}

export interface DemoVersionRow {
  id: string
  demonstrationId: string
  status: 'submitted' | 'approved' | 'rejected' | 'withdrawn'
  snapshotDocumentJson: string
  classification: string
  license: string
  aiDisclosure: string
  sourceChainJson: string | null
  mediaManifestJson: string
  reviewerNote: string | null
  frozenAt: string
}

/** Audit hook — the caller wires this to the existing AuditStore (T-D wiring). */
export type AuditWriter = (event: {
  action: string
  actorId: string
  actorRole: string
  resourceType: string
  resourceId: string
  detailJson: string
}) => void

export interface DemonstrationServiceOptions {
  db: Database
  audit?: AuditWriter
}

export class DemonstrationService {
  private readonly db: Database
  private readonly audit: AuditWriter | undefined

  public constructor(options: DemonstrationServiceOptions) {
    this.db = options.db
    this.audit = options.audit
  }

  /** Create a work root + its 1:1 empty draft. */
  public createDemonstration(ownerId: string, meta: DemoMeta = {}): string {
    const id = randomUUID()
    const now = new Date().toISOString()
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO teaching_demonstrations (id, owner_id, meta_json) VALUES (?, ?, ?)`
        )
        .run(id, ownerId, JSON.stringify(meta))
      this.db
        .prepare(
          `INSERT INTO demonstration_drafts (id, demonstration_id, document_json, updated_at)
           VALUES (?, ?, ?, ?)`
        )
        .run(randomUUID(), id, JSON.stringify({ documentMeta: { sceneFormatVersion: '1.0' } }), now)
    })()
    this.emitAudit('demo.create', ownerId, 'demonstration', id, JSON.stringify(meta))
    return id
  }

  /** Read the current draft document (already parsed + validated). */
  public getDraft(demoId: string): { document: SceneDocument; updatedAt: string } {
    const draft = this.db
      .prepare(
        `SELECT document_json, updated_at FROM demonstration_drafts WHERE demonstration_id = ?`
      )
      .get(demoId) as { document_json: string; updated_at: string } | undefined
    if (!draft) throw new DemoNotFoundError(demoId)
    return { document: parseSceneDocument(JSON.parse(draft.document_json)), updatedAt: draft.updated_at }
  }

  /**
   * High-frequency draft save. Hard validation rejects (zod + security
   * guards); the draft aggregate is the only mutable content store.
   */
  public saveDraft(demoId: string, ownerId: string, document: SceneDocument): void {
    this.assertOwner(demoId, ownerId)
    // Trust gate: parse + security guards before any write.
    parseSceneDocument(document)
    const issues = runSecurityGuards(document)
    if (issues.length > 0) {
      throw new DemoSubmitError(`security guard failed: ${issues[0]?.message ?? 'unknown'}`)
    }
    const now = new Date().toISOString()
    this.db
      .prepare(
        `UPDATE demonstration_drafts
         SET document_json = ?, updated_at = ?
         WHERE demonstration_id = ?`
      )
      .run(JSON.stringify(document), now, demoId)
    this.emitAudit('demo.draft.save', ownerId, 'demonstration', demoId, '')
  }

  /**
   * Freeze a snapshot from the draft → demonstration_versions (status
   * submitted). Preflight: at most one pending version; media all ready;
   * license + ai disclosure required.
   */
  public submit(
    demoId: string,
    ownerId: string,
    options: SubmitOptions
  ): string {
    this.assertOwner(demoId, ownerId)
    if (!options.classification.trim()) throw new DemoSubmitError('classification is required')
    if (!options.license.trim()) throw new DemoSubmitError('license is required')
    if (!options.aiDisclosure.trim()) throw new DemoSubmitError('aiDisclosure is required')

    const draft = this.db
      .prepare(
        `SELECT document_json FROM demonstration_drafts WHERE demonstration_id = ?`
      )
      .get(demoId) as { document_json: string } | undefined
    if (!draft) throw new DemoNotFoundError(demoId)

    const document = parseSceneDocument(JSON.parse(draft.document_json))
    const issues = runSecurityGuards(document)
    if (issues.length > 0) {
      throw new DemoSubmitError(`security guard failed: ${issues[0]?.message ?? 'unknown'}`)
    }

    // At most one pending-approval version.
    const pending = this.db
      .prepare(
        `SELECT id FROM demonstration_versions
         WHERE demonstration_id = ? AND status = 'submitted'`
      )
      .get(demoId) as { id: string } | undefined
    if (pending) {
      throw new DemoSubmitError('a version is already pending approval; wait or withdraw first')
    }

    // Spec §2.3: a candidate with non-ready media must not be submitted.
    const mediaRefs = document.mediaRefs ?? []
    if (mediaRefs.length > 0) {
      for (const ref of mediaRefs) {
        const asset = this.db
          .prepare(`SELECT status FROM media_assets WHERE id = ?`)
          .get(ref.id) as { status: string } | undefined
        if (!asset || asset.status !== 'ready') {
          throw new DemoSubmitError(`mediaReference ${ref.id} is not ready`)
        }
      }
    }

    const versionId = randomUUID()
    const now = new Date().toISOString()
    const manifest = mediaRefs.map((r) => ({ id: r.id, blobHash: r.blobHash, purpose: r.purpose }))
    // Source chain freeze (spec §2.1/§5.1): if this work is derived, record the
    // source permanently on the version AND enforce license inheritance — the
    // chosen license must be no stricter than the source unless all source
    // content was removed.
    const meta = this.db
      .prepare(`SELECT meta_json FROM teaching_demonstrations WHERE id = ?`)
      .get(demoId) as { meta_json: string }
    const parsedMeta = JSON.parse(meta.meta_json) as {
      derivedFrom?: { sourceDemoId: string; sourceVersionId: string; originalAuthorId: string }
    }
    const sourceChain = parsedMeta.derivedFrom
    if (sourceChain) {
      const sourceVersion = this.db
        .prepare(`SELECT license FROM demonstration_versions WHERE id = ?`)
        .get(sourceChain.sourceVersionId) as { license: string } | undefined
      if (sourceVersion) {
        // Determine whether the derived doc still contains source content: any
        // mediaRef or geometry referencing the source's asset hashes counts.
        const sourceDoc = this.db
          .prepare(`SELECT snapshot_document_json FROM demonstration_versions WHERE id = ?`)
          .get(sourceChain.sourceVersionId) as { snapshot_document_json: string }
        const sourceRefs = new Set<string>()
        const src = JSON.parse(sourceDoc.snapshot_document_json) as {
          mediaRefs?: Array<{ blobHash?: string }>
        }
        for (const r of src.mediaRefs ?? []) if (r.blobHash) sourceRefs.add(r.blobHash)
        const ownRefs = new Set(mediaRefs.map((r) => r.blobHash))
        const sourceContentRemoved = [...sourceRefs].every((h) => !ownRefs.has(h))
        assertLicenseAllowed(sourceVersion.license, options.license, sourceContentRemoved)
      }
    }
    this.db
      .prepare(
        `INSERT INTO demonstration_versions
           (id, demonstration_id, status, snapshot_document_json, classification, license,
            ai_disclosure, source_chain_json, media_manifest_json, frozen_at)
         VALUES (?, ?, 'submitted', ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        versionId,
        demoId,
        JSON.stringify(document),
        options.classification,
        options.license,
        options.aiDisclosure,
        sourceChain ? JSON.stringify(sourceChain) : null,
        JSON.stringify(manifest),
        now
      )
    this.emitAudit(
      'demo.submit',
      ownerId,
      'demonstration',
      demoId,
      JSON.stringify({ versionId, classification: options.classification })
    )
    return versionId
  }

  /** Withdraw a pending version (submitted → withdrawn). */
  public withdraw(demoId: string, ownerId: string, versionId: string): void {
    this.assertOwner(demoId, ownerId)
    const version = this.db
      .prepare(
        `SELECT id, status FROM demonstration_versions
         WHERE id = ? AND demonstration_id = ?`
      )
      .get(versionId, demoId) as { id: string; status: string } | undefined
    if (!version) throw new DemoVersionNotFoundError(versionId)
    // Only a submitted (pending) version can be withdrawn — an approved version
    // keeps playing for existing fixed references (spec §2.3), never vanish.
    if (version.status !== 'submitted') {
      throw new DemoSubmitError(`only submitted versions can be withdrawn (status=${version.status})`)
    }
    this.db
      .prepare(
        `UPDATE demonstration_versions SET status = 'withdrawn' WHERE id = ?`
      )
      .run(versionId)
    this.emitAudit('demo.withdraw', ownerId, 'demonstration', demoId, JSON.stringify({ versionId }))
  }

  /** Soft delete: hide the identity only; content + blob retention is separate. */
  public softDelete(demoId: string, ownerId: string): void {
    this.assertOwner(demoId, ownerId)
    const now = new Date().toISOString()
    this.db
      .prepare(
        `UPDATE teaching_demonstrations SET deleted_at = ? WHERE id = ?`
      )
      .run(now, demoId)
    this.emitAudit('demo.delete', ownerId, 'demonstration', demoId, '')
  }

  /**
   * Author takedown of a published work (spec §5.1): hides the demo identity
   * BUT published fixed references keep playing (spec §2.9). distinct from
   * softDelete only in audit semantics; both hide identity + retain content.
   */
  public takedown(demoId: string, ownerId: string): void {
    this.assertOwner(demoId, ownerId)
    const now = new Date().toISOString()
    this.db
      .prepare(`UPDATE teaching_demonstrations SET deleted_at = ? WHERE id = ?`)
      .run(now, demoId)
    this.emitAudit('demo.takedown', ownerId, 'demonstration', demoId, '')
  }

  /** List versions for a demo (for review queue / evidence panel). */
  public listVersions(demoId: string): DemoVersionRow[] {
    const rows = this.db
      .prepare(
        `SELECT id, demonstration_id, status, snapshot_document_json, classification,
                license, ai_disclosure, source_chain_json, media_manifest_json,
                reviewer_note, frozen_at
         FROM demonstration_versions WHERE demonstration_id = ? ORDER BY frozen_at DESC`
      )
      .all(demoId) as DemoVersionRow[]
    return rows
  }

  private assertOwner(demoId: string, ownerId: string): void {
    const demo = this.db
      .prepare(`SELECT owner_id FROM teaching_demonstrations WHERE id = ?`)
      .get(demoId) as { owner_id: string } | undefined
    if (!demo) throw new DemoNotFoundError(demoId)
    if (demo.owner_id !== ownerId) throw new DemoOwnershipError('not your demonstration')
  }

  private emitAudit(
    action: string,
    actorId: string,
    resourceType: string,
    resourceId: string,
    detailJson: string
  ): void {
    this.audit?.({
      action,
      actorId,
      actorRole: 'teacher',
      resourceType,
      resourceId,
      detailJson
    })
  }
}