/**
 * AppealService - author appeals against a rejection or takedown (spec §5.2,
 * decision 04, ticket T-F).
 *
 * An author appeals a decision on THEIR OWN demonstration; a reviewer resolves
 * the appeal (approve -> e.g. restore / re-review, deny -> uphold). Create +
 * resolve are audited governance events. Appeals reference a demonstration
 * (and optionally the version being appealed), never student/grade/teaching
 * data (spec §3.4 iron law).
 */
import type { Database } from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { DemoNotFoundError, DemoOwnershipError } from './DemonstrationService'
import { ReviewerNotAuthorizedError } from './ReviewService'
import { isPublicLibraryReviewer } from './reviewerAuth'
import { assertNoPII } from '../pii/PIIDetector'

export class AppealValidationError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'AppealValidationError'
  }
}

export class AppealNotFoundError extends Error {
  public constructor(id: string) {
    super(`Appeal not found: ${id}`)
    this.name = 'AppealNotFoundError'
  }
}

export type AppealStatus = 'open' | 'approved' | 'denied'

export interface CreateAppealInput {
  /** Version being appealed (rejection); omit when appealing a takedown. */
  versionId?: string
  reason: string
}

export interface AppealRow {
  id: string
  demonstrationId: string
  versionId: string | null
  appellantId: string
  reason: string
  status: AppealStatus
  createdAt: string
  resolvedAt: string | null
  resolvedBy: string | null
  resolutionNote: string | null
}

export interface AppealServiceOptions {
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

export class AppealService {
  private readonly db: Database
  private readonly audit: AppealServiceOptions['audit']

  public constructor(options: AppealServiceOptions) {
    this.db = options.db
    this.audit = options.audit
  }

  /**
   * File an appeal. Only the demonstration owner may appeal; the demo must
   * exist (even if soft-deleted by a takedown - the author can still appeal
   * the takedown, spec §2.9: identity hidden but content retained).
   */
  public create(
    appellantId: string,
    demonstrationId: string,
    input: CreateAppealInput
  ): AppealRow {
    if (input.reason.trim() === '') {
      throw new AppealValidationError('reason is required')
    }
    const demo = this.db
      .prepare(`SELECT id, owner_id, deleted_at FROM teaching_demonstrations WHERE id = ?`)
      .get(demonstrationId) as
      | { id: string; owner_id: string; deleted_at: string | null }
      | undefined
    if (!demo) throw new DemoNotFoundError(demonstrationId)
    if (demo.owner_id !== appellantId) {
      throw new DemoOwnershipError('only the owner may appeal a decision on their demonstration')
    }
    // Appealable-state precondition (spec §5.2): an appeal targets an ADVERSE
    // decision - a rejected version (named via versionId) or a forced takedown
    // (soft-deleted identity). A published / untouched demo is not appealable.
    if (input.versionId !== undefined) {
      const version = this.db
        .prepare(
          `SELECT id, status FROM demonstration_versions WHERE id = ? AND demonstration_id = ?`
        )
        .get(input.versionId, demonstrationId) as
        | { id: string; status: string }
        | undefined
      if (!version) {
        throw new AppealValidationError(`version ${input.versionId} does not belong to this demonstration`)
      }
      if (version.status !== 'rejected') {
        throw new AppealValidationError(
          `can only appeal a rejected version (status=${version.status})`
        )
      }
    } else if (demo.deleted_at === null) {
      throw new AppealValidationError(
        'can only appeal a takedown when the demonstration has been taken down'
      )
    }
    // Dedupe: one OPEN appeal per (demonstration, appellant).
    const openAppeal = this.db
      .prepare(
        `SELECT id FROM publication_appeals
         WHERE demonstration_id = ? AND appellant_id = ? AND status = 'open'`
      )
      .get(demonstrationId, appellantId) as { id: string } | undefined
    if (openAppeal) {
      throw new AppealValidationError('you already have an open appeal for this demonstration')
    }
    // PII: scan the free-text reason before persist. Appeal reasons are
    // surfaced to reviewers, so they get the same reject-store guard as
    // evaluation free-text (ADR-0003 §3).
    assertNoPII('reason', input.reason)

    const id = randomUUID()
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO publication_appeals
           (id, demonstration_id, version_id, appellant_id, reason, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'open', ?)`
      )
      .run(
        id,
        demonstrationId,
        input.versionId ?? null,
        appellantId,
        input.reason,
        now
      )
    const row = this.get(id)
    this.audit?.({
      action: 'demo.appeal.create',
      actorId: appellantId,
      actorRole: 'teacher',
      resourceType: 'publication',
      resourceId: demonstrationId,
      detailJson: JSON.stringify({ appealId: id, versionId: input.versionId ?? null })
    })
    return row
  }

  /** Read a single appeal. */
  public get(id: string): AppealRow {
    const row = this.db
      .prepare(
        `SELECT id, demonstration_id AS demonstrationId, version_id AS versionId,
                appellant_id AS appellantId, reason, status, created_at AS createdAt,
                resolved_at AS resolvedAt, resolved_by AS resolvedBy,
                resolution_note AS resolutionNote
         FROM publication_appeals WHERE id = ?`
      )
      .get(id) as AppealRow | undefined
    if (!row) throw new AppealNotFoundError(id)
    return row
  }

  /** Open appeals (pending reviewer handling). */
  public listOpen(): AppealRow[] {
    return this.db
      .prepare(
        `SELECT id, demonstration_id AS demonstrationId, version_id AS versionId,
                appellant_id AS appellantId, reason, status, created_at AS createdAt,
                resolved_at AS resolvedAt, resolved_by AS resolvedBy,
                resolution_note AS resolutionNote
         FROM publication_appeals WHERE status = 'open'
         ORDER BY created_at ASC`
      )
      .all() as AppealRow[]
  }

  /** Resolve an appeal (reviewer-only). */
  public resolve(
    reviewerId: string,
    appealId: string,
    resolution: { status: 'approved' | 'denied'; note: string }
  ): AppealRow {
    if (!isPublicLibraryReviewer(this.db, reviewerId)) {
      throw new ReviewerNotAuthorizedError()
    }
    if (resolution.note.trim() === '') {
      throw new AppealValidationError('resolution note is required')
    }
    const existing = this.db
      .prepare(
        `SELECT id, status, demonstration_id, version_id FROM publication_appeals WHERE id = ?`
      )
      .get(appealId) as
      | {
        id: string
        status: string
        demonstration_id: string
        version_id: string | null
      }
      | undefined
    if (!existing) throw new AppealNotFoundError(appealId)
    if (existing.status !== 'open') {
      throw new AppealValidationError(`appeal already ${existing.status}`)
    }
    const now = new Date().toISOString()
    // An approved appeal overturns the adverse decision (spec §5.2: approve ->
    // restore / re-review). A takedown appeal (no version) restores the demo
    // identity; a rejection appeal (named version) returns the version to
    // 'submitted' so it re-enters the review queue - but only when no other
    // version is already pending (the at-most-one-pending rule, spec §2.3).
    const restored = this.db.transaction((): boolean => {
      this.db
        .prepare(
          `UPDATE publication_appeals
           SET status = ?, resolution_note = ?, resolved_at = ?, resolved_by = ?
           WHERE id = ?`
        )
        .run(resolution.status, resolution.note, now, reviewerId, appealId)
      if (resolution.status !== 'approved') return false
      if (existing.version_id !== null) {
        // Rejection appeal -> re-review: return the version to the queue, but
        // only when no other version is already pending (spec §2.3).
        const pending = this.db
          .prepare(
            `SELECT id FROM demonstration_versions
             WHERE demonstration_id = ? AND status = 'submitted'`
          )
          .get(existing.demonstration_id) as { id: string } | undefined
        if (pending) return false
        this.db
          .prepare(`UPDATE demonstration_versions SET status = 'submitted' WHERE id = ?`)
          .run(existing.version_id)
        return true
      }
      // Takedown appeal -> restore the demo identity.
      this.db
        .prepare(`UPDATE teaching_demonstrations SET deleted_at = NULL WHERE id = ?`)
        .run(existing.demonstration_id)
      return true
    })()
    this.audit?.({
      action: 'demo.appeal.resolve',
      actorId: reviewerId,
      actorRole: 'reviewer',
      resourceType: 'publication',
      resourceId: existing.demonstration_id,
      detailJson: JSON.stringify({ appealId, status: resolution.status, restored })
    })
    return this.get(appealId)
  }
}
