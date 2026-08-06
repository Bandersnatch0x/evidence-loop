/** Route-level audit interceptor: stamps fields fixed by matched route. */
import type { SessionUser } from '../auth/SessionProvider'
import {
  actorFields,
  type AuditEventInput
} from './AuditStore'

export type RouteAuditTemplate = Pick<
  AuditEventInput,
  'action' | 'resourceType'
>

export type RouteAuditDetails = Omit<
  AuditEventInput,
  'actorRole' | 'actorId' | 'action' | 'resourceType'
>

export interface RouteAuditor {
  record(details: RouteAuditDetails): void
}

/**
 * Bind principal + route intent once. Branches then record only outcome-specific
 * details, preventing actor/action/resource drift between denied and success
 * events for the same matched route.
 */
export function createRouteAuditor(
  audit: Pick<{ enqueue(event: AuditEventInput): void }, 'enqueue'>,
  user: SessionUser,
  template: RouteAuditTemplate
): RouteAuditor {
  return {
    record(details) {
      audit.enqueue({
        ...actorFields(user),
        ...template,
        ...details
      })
    }
  }
}
