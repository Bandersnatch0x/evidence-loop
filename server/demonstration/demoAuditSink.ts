/**
 * Audit sink adapter (spec §5.7, decision 14) - bridges the demonstration
 * domain services' lightweight audit hook to the existing audit HMAC chain
 * (AuditStore).
 *
 * The domain services (DemonstrationService / ReviewService / ReferenceService
 * / DerivationService / ReportService / AppealService) emit a uniform event:
 *   { action, actorId, actorRole, resourceType, resourceId, detailJson }
 * where `action` is a `demo.*` string. Only the MANDATORY governance events
 * (spec §5.7: publish submit / withdraw / approve / reject / takedown / report
 * / upgrade_reference / appeal) are mapped onto the AuditAction enum and
 * enqueued to the tamper-evident chain. High-frequency non-governance events
 * (draft save, meta update, create, derive, reference set/remove) are dropped
 * here - they are not mandated and would flood the chain.
 *
 * The original `demo.*` action is preserved in `metadata.demoAction` so the
 * governance trail stays traceable without widening the AuditAction enum.
 */
import type {
  AuditAction,
  AuditResourceType,
  AuditStore
} from '../audit/AuditStore'

export interface DemoAuditEvent {
  action: string
  actorId: string
  actorRole: string
  resourceType: string
  resourceId: string
  detailJson: string
}

export const ACTION_MAP: Record<
  string,
  { action: AuditAction; resourceType: AuditResourceType }
> = {
  'demo.submit': { action: 'publish', resourceType: 'demonstration' },
  'demo.withdraw': { action: 'withdraw', resourceType: 'demonstration' },
  'demo.approve': { action: 'approve', resourceType: 'demonstration' },
  'demo.reject': { action: 'reject', resourceType: 'demonstration' },
  'demo.takedown': { action: 'takedown', resourceType: 'demonstration' },
  'demo.takedown.forced': { action: 'takedown', resourceType: 'demonstration' },
  'demo.delete': { action: 'delete', resourceType: 'demonstration' },
  'demo.report.create': { action: 'report', resourceType: 'publication' },
  'demo.report.resolve': { action: 'report', resourceType: 'publication' },
  'demo.appeal.create': { action: 'appeal', resourceType: 'publication' },
  'demo.appeal.resolve': { action: 'appeal', resourceType: 'publication' },
  'demo.upgrade_reference': { action: 'upgrade_reference', resourceType: 'demonstration' }
}

/** Build a governance-only audit hook backed by the HMAC chain. */
export function createDemoAuditSink(
  auditStore: AuditStore
): (event: DemoAuditEvent) => void {
  return (event: DemoAuditEvent): void => {
    const mapped = ACTION_MAP[event.action]
    // Non-mandatory events are not recorded to the HMAC chain (spec §5.7 lists
    // only the governance actions). Dropping them keeps the chain focused and
    // avoids flooding it with high-frequency draft saves.
    if (mapped === undefined) return

    const metadata: Record<string, string | number | boolean | null> = {
      demoAction: event.action
    }
    if (event.action === 'demo.takedown.forced') metadata.forced = true
    // Flatten scalar detail fields for the chain record; nested objects are
    // dropped (audit metadata is flat scalars by AuditEventInput contract).
    if (event.detailJson !== '') {
      try {
        const detail = JSON.parse(event.detailJson) as Record<string, unknown>
        for (const [key, value] of Object.entries(detail)) {
          if (
            typeof value === 'string' ||
            typeof value === 'number' ||
            typeof value === 'boolean' ||
            value === null
          ) {
            metadata[key] = value
          }
        }
      } catch {
        // detailJson was not a JSON object - keep demoAction only.
      }
    }

    auditStore.enqueue({
      actorRole: event.actorRole,
      actorId: event.actorId,
      action: mapped.action,
      resourceType: mapped.resourceType,
      resourceId: event.resourceId,
      metadata
    })
  }
}
