/**
 * ReportService - reader reports against published demonstrations (spec §5.3,
 * decision 04, ticket T-F).
 *
 * Any logged-in user may report a published demonstration; reports enter the
 * reviewer queue (`GET /api/reviewer/queue`). A reviewer resolves or dismisses
 * a report. Reports are governance events: create + resolve are audited.
 *
 * Reports reference a demonstration (the published work), never student /
 * grade / teaching-org data (spec §3.4 iron law).
 */
import type { Database } from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { DemoNotFoundError } from './DemonstrationService'
import { ReviewerNotAuthorizedError } from './ReviewService'
import { isPublicLibraryReviewer } from './reviewerAuth'
import { assertNoPII } from '../pii/PIIDetector'

export class ReportValidationError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'ReportValidationError'
  }
}

export class ReportNotFoundError extends Error {
  public constructor(id: string) {
    super(`Report not found: ${id}`)
    this.name = 'ReportNotFoundError'
  }
}

// `ReviewerNotAuthorizedError` is re-exported from ReviewService (the T-D
// canonical class) so the route layer matches a single error identity across
// all governance services.
export { ReviewerNotAuthorizedError }

export const REPORT_CATEGORIES = [
  'copyright',
  'illegal',
  'inappropriate',
  'spam',
  'other'
] as const
export type ReportCategory = (typeof REPORT_CATEGORIES)[number]

export type ReportStatus = 'open' | 'resolved' | 'dismissed'

export interface CreateReportInput {
  category: ReportCategory
  reason: string
}

export interface ReportRow {
  id: string
  demonstrationId: string
  reporterId: string
  category: ReportCategory
  reason: string
  status: ReportStatus
  createdAt: string
  resolvedAt: string | null
  resolvedBy: string | null
  resolutionNote: string | null
}

export interface ReportServiceOptions {
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

export class ReportService {
  private readonly db: Database
  private readonly audit: ReportServiceOptions['audit']

  public constructor(options: ReportServiceOptions) {
    this.db = options.db
    this.audit = options.audit
  }

  /**
   * File a report against a published demonstration. Any logged-in user may
   * report; the demonstration must exist and not be soft-deleted (a deleted
   * identity is hidden - reporting it is a no-op).
   */
  public create(
    reporterId: string,
    demonstrationId: string,
    input: CreateReportInput
  ): ReportRow {
    if (!(REPORT_CATEGORIES as readonly string[]).includes(input.category)) {
      throw new ReportValidationError(`invalid category: ${input.category}`)
    }
    if (input.reason.trim() === '') {
      throw new ReportValidationError('reason is required')
    }
    const demo = this.db
      .prepare(`SELECT id FROM teaching_demonstrations WHERE id = ? AND deleted_at IS NULL`)
      .get(demonstrationId) as { id: string } | undefined
    if (!demo) throw new DemoNotFoundError(demonstrationId)

    // Dedupe: one OPEN report per (demonstration, reporter). A reporter with
    // an open report on a work must wait for it to be resolved/dismissed first
    // (no unlimited spam of the reviewer queue).
    const openReport = this.db
      .prepare(
        `SELECT id FROM publication_reports
         WHERE demonstration_id = ? AND reporter_id = ? AND status = 'open'`
      )
      .get(demonstrationId, reporterId) as { id: string } | undefined
    if (openReport) {
      throw new ReportValidationError(
        'you already have an open report for this demonstration'
      )
    }

    // PII: scan the free-text reason before persist. Report reasons are
    // surfaced to reviewers via the queue / evidence panel, so they get the
    // same reject-store guard as evaluation free-text (ADR-0003 §3).
    assertNoPII('reason', input.reason)

    const id = randomUUID()
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO publication_reports
           (id, demonstration_id, reporter_id, category, reason, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'open', ?)`
      )
      .run(id, demonstrationId, reporterId, input.category, input.reason, now)
    const row = this.get(id)
    this.audit?.({
      action: 'demo.report.create',
      actorId: reporterId,
      actorRole: 'user',
      resourceType: 'publication',
      resourceId: demonstrationId,
      detailJson: JSON.stringify({ reportId: id, category: input.category })
    })
    return row
  }

  /** Read a single report. */
  public get(id: string): ReportRow {
    const row = this.db
      .prepare(
        `SELECT id, demonstration_id AS demonstrationId, reporter_id AS reporterId,
                category, reason, status, created_at AS createdAt,
                resolved_at AS resolvedAt, resolved_by AS resolvedBy,
                resolution_note AS resolutionNote
         FROM publication_reports WHERE id = ?`
      )
      .get(id) as ReportRow | undefined
    if (!row) throw new ReportNotFoundError(id)
    return row
  }

  /** Open reports (pending reviewer handling) - feeds the reviewer queue. */
  public listOpen(): ReportRow[] {
    return this.db
      .prepare(
        `SELECT id, demonstration_id AS demonstrationId, reporter_id AS reporterId,
                category, reason, status, created_at AS createdAt,
                resolved_at AS resolvedAt, resolved_by AS resolvedBy,
                resolution_note AS resolutionNote
         FROM publication_reports WHERE status = 'open'
         ORDER BY created_at ASC`
      )
      .all() as ReportRow[]
  }

  /** All reports against a demonstration (evidence-panel history). */
  public listForDemonstration(demonstrationId: string): ReportRow[] {
    return this.db
      .prepare(
        `SELECT id, demonstration_id AS demonstrationId, reporter_id AS reporterId,
                category, reason, status, created_at AS createdAt,
                resolved_at AS resolvedAt, resolved_by AS resolvedBy,
                resolution_note AS resolutionNote
         FROM publication_reports WHERE demonstration_id = ?
         ORDER BY created_at ASC`
      )
      .all(demonstrationId) as ReportRow[]
  }

  /**
   * Resolve or dismiss a report (reviewer-only). A resolution that confirms a
   * violation is the trigger for the reviewer's forced-takedown flow
   * (`POST /api/reviewer/publications/:id/takedown`); this method only records
   * the report outcome + audit.
   */
  public resolve(
    reviewerId: string,
    reportId: string,
    resolution: { status: 'resolved' | 'dismissed'; note: string }
  ): ReportRow {
    if (!isPublicLibraryReviewer(this.db, reviewerId)) {
      throw new ReviewerNotAuthorizedError()
    }
    if (resolution.note.trim() === '') {
      throw new ReportValidationError('resolution note is required')
    }
    const existing = this.db
      .prepare(`SELECT id, status, demonstration_id FROM publication_reports WHERE id = ?`)
      .get(reportId) as
      | { id: string; status: string; demonstration_id: string }
      | undefined
    if (!existing) throw new ReportNotFoundError(reportId)
    if (existing.status !== 'open') {
      throw new ReportValidationError(`report already ${existing.status}`)
    }
    const now = new Date().toISOString()
    this.db
      .prepare(
        `UPDATE publication_reports
         SET status = ?, resolution_note = ?, resolved_at = ?, resolved_by = ?
         WHERE id = ?`
      )
      .run(resolution.status, resolution.note, now, reviewerId, reportId)
    this.audit?.({
      action: 'demo.report.resolve',
      actorId: reviewerId,
      actorRole: 'reviewer',
      resourceType: 'publication',
      resourceId: existing.demonstration_id,
      detailJson: JSON.stringify({ reportId, status: resolution.status })
    })
    return this.get(reportId)
  }
}
