/**
 * auditRoutes — teacher/admin audit log query surface.
 *
 * Extracted from server/index.ts (architecture deepening C2). Uses guardRoute
 * for the authorize→audit→403 ceremony (deepening C1).
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Database } from 'better-sqlite3'
import type { AuditStore } from './AuditStore'
import type { SessionUser } from '../auth/SessionProvider'
import { guardRoute } from '../http/guardRoute'
import { respondJson } from '../http/httpUtils'

export interface AuditRouteContext {
  db: Database
  audit: AuditStore
  user: SessionUser
}

/**
 * Strip any accidental free-text keys from audit metadata before API exposure.
 * Voice events must only ever carry counts / durations (ADR-0005 §7).
 */
export function sanitizeAuditMetadata(
  metadata: Record<string, string | number | boolean | null> | null
): Record<string, string | number | boolean | null> | null {
  if (metadata === null) return null
  const blocked = new Set([
    'text',
    'transcript',
    'content',
    'audio',
    'audioPath',
    'rawAudio',
    'utterance'
  ])
  const sanitized: Record<string, string | number | boolean | null> = {}
  for (const [key, value] of Object.entries(metadata)) {
    if (blocked.has(key)) continue
    sanitized[key] = value
  }
  return sanitized
}

/**
 * Handle GET /api/audit. Returns false when the path is not the audit route.
 */
export async function handleAuditApi(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  context: AuditRouteContext
): Promise<boolean> {
  if (request.method !== 'GET' || requestUrl.pathname !== '/api/audit') {
    return false
  }

  const { db, audit, user } = context
  const gate = guardRoute({
    db,
    audit,
    user,
    response,
    request: { purpose: 'teaching' },
    action: 'view',
    resourceType: 'audit',
    forbidden: {
      default: 'Forbidden: audit log requires teacher or admin role',
      'reviewer-isolated':
        'Forbidden: public-library reviewers may not view audit data'
    }
  })
  if (!gate.allowed) return true

  const studentId = requestUrl.searchParams.get('studentId') ?? undefined
  const from = requestUrl.searchParams.get('from') ?? undefined
  const to = requestUrl.searchParams.get('to') ?? undefined
  const limitRaw = requestUrl.searchParams.get('limit')
  const limit =
    limitRaw !== null && limitRaw.trim() !== ''
      ? Number(limitRaw)
      : undefined

  const records = await audit.query({
    studentId,
    from,
    to,
    limit:
      limit !== undefined && Number.isFinite(limit) ? Math.trunc(limit) : undefined
  })

  gate.auditor.record({
    studentId,
    result: 'success',
    metadata: { count: records.length }
  })

  respondJson(
    response,
    200,
    records.map((record) => ({
      id: record.id,
      sequence: record.sequence,
      timestamp: record.timestamp,
      actorRole: record.actorRole,
      actorId: record.actorId,
      action: record.action,
      resourceType: record.resourceType,
      resourceId: record.resourceId,
      studentId: record.studentId,
      containerId: record.containerId,
      result: record.result,
      modality: record.modality,
      // Metadata is counts-only for voice events; still omit free-text fields
      // from the public audit API surface.
      metadata: sanitizeAuditMetadata(record.metadata)
    }))
  )
  return true
}
