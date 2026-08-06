/**
 * Reviewer + publication governance HTTP routes (spec §5.2/§5.3, decision 04,
 * ticket T-F). One more `handle*Api` module router wired into server/index.ts.
 *
 * Endpoints:
 *   GET    /api/reviewer/queue                       reviewer queue (submitted + open reports)
 *   GET    /api/reviewer/versions/:id                evidence panel (no teaching-private data)
 *   POST   /api/reviewer/versions/:id/approve        approve -> approved (current published)
 *   POST   /api/reviewer/versions/:id/reject         reject (reason) -> rejected
 *   POST   /api/reviewer/publications/:id/takedown   forced takedown + notify + replace deadline
 *   GET    /api/reviewer/appeals                     open appeals
 *   POST   /api/reviewer/appeals/:id                 resolve an appeal
 *   POST   /api/publications/:id/reports             any logged-in user reports
 *   POST   /api/publications/:id/appeals             author appeals a decision
 *
 * Authorization: reviewer-only endpoints gate on the `public_library_reviewer`
 * flag (DB column, spec §2.8). Reports are open to any logged-in principal.
 * Appeals-create is owner-only (AppealService enforces).
 *
 * Router conventions match handleQuestionBankApi / handleMediaApi.
 */
import { respondJson } from '../http/httpUtils'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { URL } from 'node:url'
import type { Database } from 'better-sqlite3'
import type { SessionUser } from '../auth/SessionProvider'
import type { DemonstrationService } from './DemonstrationService'
import type { AiQuotaStore } from './aiAssistant'
import type { ReferenceService } from './ReferenceService'
import {
  DemoNotFoundError,
  DemoOwnershipError,
  DemoSubmitError,
  DemoVersionNotFoundError
} from './DemonstrationService'
import type { ReviewService } from './ReviewService'
import {
  ReviewStateError,
  ReviewerNotAuthorizedError
} from './ReviewService'
import {
  REPORT_CATEGORIES
} from './ReportService'
import type { ReportService, ReportCategory } from './ReportService'
import {
  ReportNotFoundError,
  ReportValidationError
} from './ReportService'
import {
  AppealNotFoundError,
  AppealValidationError
} from './AppealService'
import type { AppealService } from './AppealService'
import type { EvidencePanelService } from './EvidencePanelService'
import type { NotificationService } from './NotificationService'
import { isPublicLibraryReviewer } from './reviewerAuth'
import { PIIError } from '../pii/PIIDetector'

const MAX_BODY_BYTES = 64 * 1024

/**
 * Forced-takedown replace window (spec §11 #12 - [待实施期确认]). Configurable
 * via DEMO_FORCED_TAKEDOWN_WINDOW_MS; default 30 days. The flow is implemented
 * here; only the length is deferred.
 */
export function resolveForcedTakedownWindowMs(
  env: NodeJS.ProcessEnv = process.env
): number {
  const raw = env.DEMO_FORCED_TAKEDOWN_WINDOW_MS
  if (raw === undefined || raw.trim() === '') return 30 * 24 * 60 * 60 * 1000
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return 30 * 24 * 60 * 60 * 1000
  return Math.trunc(parsed)
}

export interface ReviewerRouteContext {
  db: Database
  demoService: DemonstrationService
  aiQuota: AiQuotaStore
  references: ReferenceService
  review: ReviewService
  evidence: EvidencePanelService
  notifications: NotificationService
  reports: ReportService
  appeals: AppealService
  user: SessionUser
  forcedTakedownWindowMs?: number
}

/**
 * Route dispatcher. Returns true when the request matched a reviewer /
 * publication governance route (and a response was written), false otherwise.
 */
export async function handleReviewerApi(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  ctx: ReviewerRouteContext
): Promise<boolean> {
  const { pathname } = requestUrl
  if (!pathname.startsWith('/api/reviewer') && !pathname.startsWith('/api/publications')) {
    return false
  }
  const user = ctx.user

  try {
    // -------------------------------------------------------------------------
    // GET /api/reviewer/queue - submitted versions + open reports.
    // -------------------------------------------------------------------------
    if (request.method === 'GET' && pathname === '/api/reviewer/queue') {
      requireReviewer(ctx, user)
      const versions = ctx.review.queue()
      const reports = ctx.reports.listOpen()
      respondJson(response, 200, { versions, reports })
      return true
    }

    // -------------------------------------------------------------------------
    // GET /api/reviewer/appeals - open appeals pending reviewer handling.
    // -------------------------------------------------------------------------
    if (request.method === 'GET' && pathname === '/api/reviewer/appeals') {
      requireReviewer(ctx, user)
      respondJson(response, 200, { appeals: ctx.appeals.listOpen() })
      return true
    }

    // -------------------------------------------------------------------------
    // GET /api/reviewer/versions/:id - evidence panel.
    // -------------------------------------------------------------------------
    const versionMatch = pathname.match(/^\/api\/reviewer\/versions\/([^/]+)$/)
    if (request.method === 'GET' && versionMatch?.[1]) {
      requireReviewer(ctx, user)
      const versionId = decodeURIComponent(versionMatch[1])
      const panel = ctx.evidence.forVersion(versionId)
      respondJson(response, 200, panel)
      return true
    }

    // -------------------------------------------------------------------------
    // POST /api/reviewer/versions/:id/approve - approve (status only).
    // -------------------------------------------------------------------------
    const approveMatch = pathname.match(
      /^\/api\/reviewer\/versions\/([^/]+)\/approve$/
    )
    if (request.method === 'POST' && approveMatch?.[1]) {
      // ReviewService asserts the reviewer flag; no separate gate needed.
      const versionId = decodeURIComponent(approveMatch[1])
      ctx.review.approve(user.userId, versionId)
      respondJson(response, 200, { versionId, status: 'approved' })
      return true
    }

    // -------------------------------------------------------------------------
    // POST /api/reviewer/versions/:id/reject - reject with reason.
    // -------------------------------------------------------------------------
    const rejectMatch = pathname.match(
      /^\/api\/reviewer\/versions\/([^/]+)\/reject$/
    )
    if (request.method === 'POST' && rejectMatch?.[1]) {
      const versionId = decodeURIComponent(rejectMatch[1])
      const body = await readJsonBody(request)
      const reason = asString(body?.reason)
      if (reason === '') {
        respondJson(response, 400, { error: 'reject requires a non-empty reason' })
        return true
      }
      ctx.review.reject(user.userId, versionId, reason)
      // Re-read so the response carries the persisted reviewer note unchanged.
      respondJson(response, 200, { versionId, status: 'rejected', reason })
      return true
    }

    // -------------------------------------------------------------------------
    // POST /api/reviewer/publications/:id/takedown - forced takedown.
    // Hides the demo identity; fixed references keep playing; referencing
    // teachers get a forced-takedown notification with a replace deadline.
    // -------------------------------------------------------------------------
    const takedownMatch = pathname.match(
      /^\/api\/reviewer\/publications\/([^/]+)\/takedown$/
    )
    if (request.method === 'POST' && takedownMatch?.[1]) {
      const demoId = decodeURIComponent(takedownMatch[1])
      const body = await readJsonBody(request)
      const reason = asString(body?.reason)
      if (reason === '') {
        respondJson(response, 400, { error: 'takedown requires a non-empty reason' })
        return true
      }
      ctx.review.takedown(user.userId, demoId, reason)
      const windowMs = ctx.forcedTakedownWindowMs ?? resolveForcedTakedownWindowMs()
      const replaceDeadline = new Date(Date.now() + windowMs).toISOString()
      const notifications = ctx.notifications.onForcedTakedown(
        demoId,
        reason,
        replaceDeadline
      )
      respondJson(response, 200, {
        demonstrationId: demoId,
        takedown: true,
        replaceDeadline,
        notifications
      })
      return true
    }

    // -------------------------------------------------------------------------
    // POST /api/reviewer/appeals/:id - resolve an appeal.
    // -------------------------------------------------------------------------
    const appealResolveMatch = pathname.match(
      /^\/api\/reviewer\/appeals\/([^/]+)$/
    )
    if (request.method === 'POST' && appealResolveMatch?.[1]) {
      const appealId = decodeURIComponent(appealResolveMatch[1])
      const body = await readJsonBody(request)
      const status = body?.status
      const note = asString(body?.note)
      if (status !== 'approved' && status !== 'denied') {
        respondJson(response, 400, { error: "status must be 'approved' or 'denied'" })
        return true
      }
      if (note === '') {
        respondJson(response, 400, { error: 'resolution note is required' })
        return true
      }
      const resolved = ctx.appeals.resolve(user.userId, appealId, {
        status,
        note
      })
      respondJson(response, 200, resolved)
      return true
    }

    // -------------------------------------------------------------------------
    // POST /api/reviewer/reports/:id - resolve or dismiss a report (reviewer).
    // Closes the report state machine: without this the only report mutation
    // is create, so reports stay `open` forever (spec §5.3).
    // -------------------------------------------------------------------------
    const reportResolveMatch = pathname.match(
      /^\/api\/reviewer\/reports\/([^/]+)$/
    )
    if (request.method === 'POST' && reportResolveMatch?.[1]) {
      const reportId = decodeURIComponent(reportResolveMatch[1])
      const body = await readJsonBody(request)
      const status = body?.status
      const note = asString(body?.note)
      if (status !== 'resolved' && status !== 'dismissed') {
        respondJson(response, 400, { error: "status must be 'resolved' or 'dismissed'" })
        return true
      }
      if (note === '') {
        respondJson(response, 400, { error: 'resolution note is required' })
        return true
      }
      const resolved = ctx.reports.resolve(user.userId, reportId, {
        status,
        note
      })
      respondJson(response, 200, resolved)
      return true
    }

    // -------------------------------------------------------------------------
    // POST /api/publications/:id/reports - any logged-in user reports.
    // -------------------------------------------------------------------------
    const reportMatch = pathname.match(/^\/api\/publications\/([^/]+)\/reports$/)
    if (request.method === 'POST' && reportMatch?.[1]) {
      const demoId = decodeURIComponent(reportMatch[1])
      const body = await readJsonBody(request)
      const category = asString(body?.category)
      const reason = asString(body?.reason)
      if (category === '' || reason === '') {
        respondJson(response, 400, { error: 'category and reason are required' })
        return true
      }
      if (!(REPORT_CATEGORIES as readonly string[]).includes(category)) {
        respondJson(response, 400, { error: `category must be one of ${REPORT_CATEGORIES.join('/')}` })
        return true
      }
      const report = ctx.reports.create(user.userId, demoId, {
        category: category as ReportCategory,
        reason
      })
      respondJson(response, 201, report)
      return true
    }

    // -------------------------------------------------------------------------
    // POST /api/publications/:id/appeals - author appeals a decision.
    // -------------------------------------------------------------------------
    const appealCreateMatch = pathname.match(
      /^\/api\/publications\/([^/]+)\/appeals$/
    )
    if (request.method === 'POST' && appealCreateMatch?.[1]) {
      const demoId = decodeURIComponent(appealCreateMatch[1])
      const body = await readJsonBody(request)
      const reason = asString(body?.reason)
      if (reason === '') {
        respondJson(response, 400, { error: 'reason is required' })
        return true
      }
      const rawVersionId = body?.versionId
      const versionId =
        typeof rawVersionId === 'string' && rawVersionId.trim() !== ''
          ? rawVersionId
          : undefined
      const appeal = ctx.appeals.create(user.userId, demoId, { versionId, reason })
      respondJson(response, 201, appeal)
      return true
    }

    respondJson(response, 404, { error: 'Reviewer route not found' })
    return true
  } catch (error) {
    return handleError(response, error)
  }
}

/** Gate reviewer-only endpoints on the public_library_reviewer flag. */
function requireReviewer(ctx: ReviewerRouteContext, user: SessionUser): void {
  if (!isPublicLibraryReviewer(ctx.db, user.userId)) {
    throw new ReviewerNotAuthorizedError()
  }
}

function handleError(response: ServerResponse, error: unknown): boolean {
  if (error instanceof ReviewerNotAuthorizedError) {
    respondJson(response, 403, { error: error.message })
    return true
  }
  if (error instanceof DemoOwnershipError) {
    respondJson(response, 403, { error: error.message })
    return true
  }
  if (
    error instanceof DemoVersionNotFoundError ||
    error instanceof DemoNotFoundError ||
    error instanceof ReportNotFoundError ||
    error instanceof AppealNotFoundError
  ) {
    respondJson(response, 404, { error: error.message })
    return true
  }
  if (
    error instanceof ReportValidationError ||
    error instanceof AppealValidationError
  ) {
    respondJson(response, 400, { error: error.message })
    return true
  }
  if (error instanceof PIIError) {
    respondJson(response, 422, { error: error.message })
    return true
  }
  if (error instanceof ReviewStateError || error instanceof DemoSubmitError) {
    respondJson(response, 409, { error: error.message })
    return true
  }
  if (error instanceof BodyTooLargeError) {
    respondJson(response, 413, { error: error.message })
    return true
  }
  if (error instanceof MalformedJsonError) {
    respondJson(response, 400, { error: error.message })
    return true
  }
  respondJson(response, 500, { error: 'Internal server error' })
  return true
}

class BodyTooLargeError extends Error {}
class MalformedJsonError extends Error {}

async function readJsonBody(
  request: IncomingMessage
): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = []
  let size = 0
  const declaredSize = Number(request.headers['content-length'] ?? 0)
  if (Number.isFinite(declaredSize) && declaredSize > MAX_BODY_BYTES) {
    throw new BodyTooLargeError('Request body is too large')
  }
  for await (const chunk of request) {
    const buffer: Buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += buffer.length
    if (size > MAX_BODY_BYTES) {
      throw new BodyTooLargeError('Request body is too large')
    }
    chunks.push(buffer)
  }
  const body = Buffer.concat(chunks).toString('utf8')
  if (body.length === 0) return null
  try {
    const parsed = JSON.parse(body) as unknown
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    throw new MalformedJsonError('Malformed JSON request body')
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
