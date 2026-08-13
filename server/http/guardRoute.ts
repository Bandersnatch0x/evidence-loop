/**
 * guardRoute — deep module for the authorize → audit-denied → 403 ceremony.
 *
 * Callers learn one interface: pass purpose + resource + forbidden messages,
 * get either `{ allowed: false }` (response already written) or
 * `{ allowed: true, auditor }` to stamp success/error outcomes.
 *
 * Deletion test: without this module the ceremony reappears at every route.
 */
import type { Database } from 'better-sqlite3'
import type { ServerResponse } from 'node:http'
import type { AuditEventInput } from '../audit/AuditStore'
import {
  createRouteAuditor,
  type RouteAuditTemplate,
  type RouteAuditor
} from '../audit/routeAudit'
import {
  authorizeAccess,
  type AuthorityDenialReason,
  type AuthorityRequest
} from '../auth/authorization'
import type { SessionUser } from '../auth/SessionProvider'
import { respondJson } from './httpUtils'

export type ForbiddenMessages =
  | string
  | Partial<Record<AuthorityDenialReason | 'default', string>>

export interface GuardRouteOptions {
  db: Database
  audit: Pick<{ enqueue(event: AuditEventInput): void }, 'enqueue'>
  user: SessionUser
  response: ServerResponse
  /** Authority purpose gate (teaching | student-data). */
  request: AuthorityRequest
  action: RouteAuditTemplate['action']
  resourceType: RouteAuditTemplate['resourceType']
  /**
   * Forbidden error string, or per-reason map.
   * `default` is used when the specific reason has no override.
   */
  forbidden: ForbiddenMessages
  studentId?: string
  resourceId?: string
  /** Extra metadata stamped on denied audit events. */
  deniedMetadata?: Record<string, string | number | boolean | null>
  /**
   * When true (default), stamp `{ reason: 'reviewer-isolated' }` on denied
   * audit metadata if that is the denial reason. Student-data routes that
   * historically omitted the reason pass `false`.
   */
  stampReviewerReason?: boolean
}

export type GuardRouteResult =
  | { allowed: false }
  | { allowed: true; auditor: RouteAuditor }

function resolveForbidden(
  forbidden: ForbiddenMessages,
  reason: AuthorityDenialReason
): string {
  if (typeof forbidden === 'string') return forbidden
  return forbidden[reason] ?? forbidden.default ?? 'Forbidden'
}

/**
 * Authorize the principal, audit denials, and write 403 when blocked.
 * On success returns a bound RouteAuditor for outcome-specific stamps.
 */
export function guardRoute(options: GuardRouteOptions): GuardRouteResult {
  const {
    db,
    audit,
    user,
    response,
    request,
    action,
    resourceType,
    forbidden,
    studentId,
    resourceId,
    deniedMetadata,
    stampReviewerReason = true
  } = options

  const access = authorizeAccess(db, user, request)
  const auditor = createRouteAuditor(audit, user, { action, resourceType })

  if (!access.allowed) {
    const metadata: Record<string, string | number | boolean | null> = {
      ...(deniedMetadata ?? {})
    }
    if (stampReviewerReason && access.reason === 'reviewer-isolated') {
      metadata.reason = 'reviewer-isolated'
    }
    auditor.record({
      studentId,
      resourceId,
      result: 'denied',
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined
    })
    respondJson(response, 403, {
      error: resolveForbidden(forbidden, access.reason)
    })
    return { allowed: false }
  }

  return { allowed: true, auditor }
}
