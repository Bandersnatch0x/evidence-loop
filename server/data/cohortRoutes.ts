/**
 * cohortRoutes — teacher cohort snapshot + multimodal usage counts.
 *
 * Extracted from server/index.ts (architecture deepening C2). Uses guardRoute
 * for the authorize→audit→403 ceremony (deepening C1).
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Database } from 'better-sqlite3'
import type { AuditStore } from '../audit/AuditStore'
import type { SessionUser } from '../auth/SessionProvider'
import type { AttemptStore } from '../store/AttemptStore'
import { guardRoute } from '../http/guardRoute'
import { respondJson } from '../http/httpUtils'
import { createCohortSnapshot } from './cohort'

export interface CohortRouteContext {
  db: Database
  store: AttemptStore
  audit: AuditStore
  user: SessionUser
}

/**
 * Handle GET /api/cohort and GET /api/cohort/multimodal-usage.
 * Returns false when the path is not a cohort route.
 */
export async function handleCohortApi(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  context: CohortRouteContext
): Promise<boolean> {
  const { pathname } = requestUrl
  const { db, store, audit, user } = context

  if (request.method === 'GET' && pathname === '/api/cohort') {
    const gate = guardRoute({
      db,
      audit,
      user,
      response,
      request: { purpose: 'teaching' },
      action: 'view',
      resourceType: 'cohort',
      forbidden: {
        default: 'Forbidden: cohort view requires teacher or admin role',
        'reviewer-isolated':
          'Forbidden: public-library reviewers may not view cohort data'
      }
    })
    if (!gate.allowed) return true

    gate.auditor.record({ result: 'success' })
    // Pass full results so T11 P4 can gate formal metrics on teacherAnnotation.
    const [history, results] = await Promise.all([
      store.list(),
      store.listResults()
    ])
    respondJson(response, 200, createCohortSnapshot(history, results))
    return true
  }

  if (request.method === 'GET' && pathname === '/api/cohort/multimodal-usage') {
    const gate = guardRoute({
      db,
      audit,
      user,
      response,
      request: { purpose: 'teaching' },
      action: 'view',
      resourceType: 'cohort',
      forbidden: {
        default: 'Forbidden: multimodal usage requires teacher or admin role',
        'reviewer-isolated':
          'Forbidden: public-library reviewers may not view cohort data'
      },
      deniedMetadata: { resource: 'multimodal-usage' }
    })
    if (!gate.allowed) return true

    const classId = requestUrl.searchParams.get('classId')
    if (classId === null || classId.trim() === '') {
      respondJson(response, 400, {
        error: 'classId query parameter is required'
      })
      return true
    }

    // Demo is a single cohort; accept any non-empty classId and return
    // aggregate counts only (no transcript content).
    const usage = await audit.getMultimodalUsage()
    gate.auditor.record({
      result: 'success',
      metadata: {
        resource: 'multimodal-usage',
        classId,
        count: usage.length
      }
    })
    respondJson(response, 200, usage)
    return true
  }

  return false
}
