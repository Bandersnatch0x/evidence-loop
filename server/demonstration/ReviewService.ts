/**
 * ReviewService — public-library review state machine (spec §2.3–§2.4, §5.2,
 * ticket T-D slice 2). Reviewer (public_library_reviewer flag) approves or
 * rejects submitted versions.
 *
 * Invariants enforced:
 *  - approval/rejection change STATUS ONLY, never snapshot content (§2.4).
 *  - approving a candidate makes it the current published version; older
 *    approved versions stop accepting NEW references but keep playing for
 *    existing fixed references (§2.3).
 *  - rejection carries a reason; the draft stays editable and a new round is
 *    a NEW version (§2.4).
 *  - reviewer-gated: only holders of the public_library_reviewer flag act.
 */
import type { Database } from 'better-sqlite3'
import { DemoVersionNotFoundError } from './DemonstrationService'

export class ReviewerNotAuthorizedError extends Error {
  public constructor() {
    super('not a public library reviewer')
    this.name = 'ReviewerNotAuthorizedError'
  }
}

export class ReviewStateError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'ReviewStateError'
  }
}

export interface ReviewServiceOptions {
  db: Database
  /** Audit hook — same channel as DemonstrationService. */
  audit?: (event: {
    action: string
    actorId: string
    actorRole: string
    resourceType: string
    resourceId: string
    detailJson: string
  }) => void
}

export class ReviewService {
  private readonly db: Database
  private readonly audit: ReviewServiceOptions['audit']

  public constructor(options: ReviewServiceOptions) {
    this.db = options.db
    this.audit = options.audit
  }

  private assertReviewer(userId: string): void {
    const user = this.db
      .prepare(`SELECT public_library_reviewer FROM users WHERE id = ?`)
      .get(userId) as { public_library_reviewer: number } | undefined
    if (!user || user.public_library_reviewer === 0) {
      throw new ReviewerNotAuthorizedError()
    }
  }

  /** Review queue: submitted versions (pending) + reported handling is T-F. */
  public queue(): Array<{ id: string; demonstrationId: string; frozenAt: string; classification: string }> {
    return this.db
      .prepare(
        `SELECT v.id, v.demonstration_id AS demonstrationId, v.frozen_at AS frozenAt, v.classification
         FROM demonstration_versions v
         JOIN teaching_demonstrations d ON d.id = v.demonstration_id
         WHERE v.status = 'submitted' AND d.deleted_at IS NULL
         ORDER BY v.frozen_at ASC`
      )
      .all() as Array<{ id: string; demonstrationId: string; frozenAt: string; classification: string }>
  }

  /** Approve a submitted version → approved; becomes the current published version. */
  public approve(reviewerId: string, versionId: string): void {
    this.assertReviewer(reviewerId)
    const version = this.db
      .prepare(
        `SELECT v.id, v.demonstration_id, v.status, d.owner_id AS ownerId
         FROM demonstration_versions v
         JOIN teaching_demonstrations d ON d.id = v.demonstration_id
         WHERE v.id = ?`
      )
      .get(versionId) as { id: string; demonstration_id: string; status: string; ownerId: string } | undefined
    if (!version) throw new DemoVersionNotFoundError(versionId)
    if (version.status !== 'submitted') {
      throw new ReviewStateError(`only submitted versions can be approved (status=${version.status})`)
    }
    if (version.ownerId === reviewerId) {
      throw new ReviewStateError('a reviewer cannot approve their own work')
    }
    this.db.transaction(() => {
      this.db
        .prepare(`UPDATE demonstration_versions SET status = 'approved' WHERE id = ?`)
        .run(versionId)
      // Retire older approved versions: they stop accepting NEW references but
      // existing fixed references keep playing (spec §2.3). We keep status
      // 'approved' — the "current published" notion is derived by latest
      // approval, not a separate column.
    })()
    this.audit?.({
      action: 'demo.approve',
      actorId: reviewerId,
      actorRole: 'reviewer',
      resourceType: 'demonstration',
      resourceId: version.demonstration_id,
      detailJson: JSON.stringify({ versionId })
    })
  }

  /** Reject a submitted version with a reason → rejected (draft stays editable). */
  public reject(reviewerId: string, versionId: string, reason: string): void {
    this.assertReviewer(reviewerId)
    if (!reason.trim()) throw new ReviewStateError('rejection reason is required')
    const version = this.db
      .prepare(
        `SELECT v.id, v.demonstration_id, v.status, d.owner_id AS ownerId
         FROM demonstration_versions v
         JOIN teaching_demonstrations d ON d.id = v.demonstration_id
         WHERE v.id = ?`
      )
      .get(versionId) as { id: string; demonstration_id: string; status: string; ownerId: string } | undefined
    if (!version) throw new DemoVersionNotFoundError(versionId)
    if (version.status !== 'submitted') {
      throw new ReviewStateError(`only submitted versions can be rejected (status=${version.status})`)
    }
    if (version.ownerId === reviewerId) {
      throw new ReviewStateError('a reviewer cannot reject their own work')
    }
    this.db
      .prepare(`UPDATE demonstration_versions SET status = 'rejected', reviewer_note = ? WHERE id = ?`)
      .run(reason, versionId)
    this.audit?.({
      action: 'demo.reject',
      actorId: reviewerId,
      actorRole: 'reviewer',
      resourceType: 'demonstration',
      resourceId: version.demonstration_id,
      detailJson: JSON.stringify({ versionId, reason })
    })
  }

  /**
   * Current published version of a demonstration (latest approved). The
   * library only surfaces this one; older approved versions keep serving
   * existing fixed references.
   */
  public currentPublishedVersion(demoId: string): { id: string; frozenAt: string } | undefined {
    return this.db
      .prepare(
        `SELECT id, frozen_at AS frozenAt FROM demonstration_versions
         WHERE demonstration_id = ? AND status = 'approved'
         ORDER BY frozen_at DESC LIMIT 1`
      )
      .get(demoId) as { id: string; frozenAt: string } | undefined
  }

  /**
   * Reviewer forced takedown (spec §5.2): violation ruling → hide the demo
   * identity; fixed references keep playing but surface the forced-takedown
   * notification to referencing teachers (T-J wires the channel).
   */
  public takedown(reviewerId: string, demoId: string, reason: string): void {
    this.assertReviewer(reviewerId)
    if (!reason.trim()) throw new ReviewStateError('takedown reason is required')
    const demo = this.db
      .prepare(`SELECT id FROM teaching_demonstrations WHERE id = ?`)
      .get(demoId) as { id: string } | undefined
    if (!demo) throw new DemoVersionNotFoundError(demoId)
    const now = new Date().toISOString()
    this.db
      .prepare(`UPDATE teaching_demonstrations SET deleted_at = ? WHERE id = ?`)
      .run(now, demoId)
    this.audit?.({
      action: 'demo.takedown.forced',
      actorId: reviewerId,
      actorRole: 'reviewer',
      resourceType: 'demonstration',
      resourceId: demoId,
      detailJson: JSON.stringify({ reason })
    })
  }
}