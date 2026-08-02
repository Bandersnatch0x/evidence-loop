/**
 * DerivationService — derived works (spec §2.1, §5.1, ticket T-D slice 5,
 * decision 08).
 *
 * A derived public work creates a NEW work root + draft, permanently records
 * the source chain (sourceDemoId / sourceVersionId / original author), and
 * enforces license inheritance (shared policy in licenseInheritance.ts).
 */
import type { Database } from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { DemoNotFoundError } from './DemonstrationService'

export { assertLicenseAllowed } from './licenseInheritance'

export class DerivationError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'DerivationError'
  }
}

export interface SourceRef {
  sourceDemoId: string
  sourceVersionId: string
  originalAuthorId: string
}

export interface DerivationServiceOptions {
  db: Database
  audit?: (event: {
    action: string
    actorId: string
    actorRole: string
    resourceType: string
    resourceId: string
    detailJson: string
  }) => void
}

export class DerivationService {
  private readonly db: Database
  private readonly audit: DerivationServiceOptions['audit']

  public constructor(options: DerivationServiceOptions) {
    this.db = options.db
    this.audit = options.audit
  }

  /**
   * Derive a new work from a published source version. Records the source
   * chain permanently; the new work starts with an empty draft the author
   * fills in.
   */
  public deriveFrom(
    actorId: string,
    sourceDemoId: string,
    sourceVersionId: string,
    meta: { title?: string } = {}
  ): { demoId: string; source: SourceRef } {
    // Validate the source version exists and is approved.
    const version = this.db
      .prepare(`SELECT demonstration_id, status FROM demonstration_versions WHERE id = ?`)
      .get(sourceVersionId) as { demonstration_id: string; status: string } | undefined
    if (!version) throw new DerivationError(`unknown source version ${sourceVersionId}`)
    if (version.demonstration_id !== sourceDemoId) {
      throw new DerivationError('source version does not belong to the source demo')
    }
    if (version.status !== 'approved') {
      throw new DerivationError(`source version ${sourceVersionId} is not approved`)
    }
    const source = this.db
      .prepare(`SELECT owner_id, meta_json FROM teaching_demonstrations WHERE id = ?`)
      .get(sourceDemoId) as { owner_id: string; meta_json: string } | undefined
    if (!source) throw new DemoNotFoundError(sourceDemoId)

    // Walk the source chain to the ROOT author (A→B→C attributes C to A, not
    // B's owner — spec §4 归属显示数据 wants the true origin).
    let rootAuthorId = source.owner_id
    try {
      const srcMeta = JSON.parse(source.meta_json) as {
        derivedFrom?: { originalAuthorId?: string }
      }
      if (srcMeta.derivedFrom?.originalAuthorId) {
        rootAuthorId = srcMeta.derivedFrom.originalAuthorId
      }
    } catch {
      // malformed meta — keep direct owner
    }

    const demoId = randomUUID()
    const now = new Date().toISOString()
    const sourceRef: SourceRef = {
      sourceDemoId,
      sourceVersionId,
      originalAuthorId: rootAuthorId
    }
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO teaching_demonstrations (id, owner_id, meta_json) VALUES (?, ?, ?)`
        )
        .run(
          demoId,
          actorId,
          JSON.stringify({ ...meta, derivedFrom: sourceRef })
        )
      this.db
        .prepare(
          `INSERT INTO demonstration_drafts (id, demonstration_id, document_json, updated_at)
           VALUES (?, ?, ?, ?)`
        )
        .run(randomUUID(), demoId, JSON.stringify({ documentMeta: { sceneFormatVersion: '1.0' } }), now)
    })()
    this.audit?.({
      action: 'demo.derive',
      actorId,
      actorRole: 'teacher',
      resourceType: 'demonstration',
      resourceId: demoId,
      detailJson: JSON.stringify(sourceRef)
    })
    return { demoId, source: sourceRef }
  }

  /** Permanent source chain of a work (from meta_json). */
  public sourceChain(demoId: string): SourceRef | null {
    const row = this.db
      .prepare(`SELECT meta_json FROM teaching_demonstrations WHERE id = ?`)
      .get(demoId) as { meta_json: string } | undefined
    if (!row) throw new DemoNotFoundError(demoId)
    const meta = JSON.parse(row.meta_json) as { derivedFrom?: SourceRef }
    return meta.derivedFrom ?? null
  }

  /** Attribution display data (spec §4: 归属显示数据). */
  public attribution(demoId: string): { originalAuthorId: string; sourceDemoId: string; sourceVersionId: string } | null {
    const chain = this.sourceChain(demoId)
    if (!chain) return null
    return {
      originalAuthorId: chain.originalAuthorId,
      sourceDemoId: chain.sourceDemoId,
      sourceVersionId: chain.sourceVersionId
    }
  }
}