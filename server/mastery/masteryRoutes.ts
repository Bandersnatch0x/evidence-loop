/**
 * masteryRoutes — mastery profile/timeline + intervention suggestion HTTP surface.
 *
 * Extracted from server/index.ts (architecture deepening C2). Uses guardRoute
 * for the authorize→audit→403 ceremony (deepening C1).
 *
 * Stays free of multimodal / demonstration / memory imports (ADR-0005/0006 / T-A).
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Database } from 'better-sqlite3'
import type { ApiError, InterventionSuggestion } from '../../shared/contracts'
import type { AuditStore } from '../audit/AuditStore'
import type { SessionUser } from '../auth/SessionProvider'
import { guardRoute } from '../http/guardRoute'
import { respondJson } from '../http/httpUtils'
import type { InterventionService } from './InterventionService'
import type { MasteryService } from './MasteryService'

export interface MasteryRouteContext {
  db: Database
  audit: AuditStore
  mastery: Pick<MasteryService, 'getProfile' | 'getTimeline'>
  interventions: Pick<InterventionService, 'suggestNextIntervention'>
  user: SessionUser
}

/**
 * Handle GET /api/mastery/:studentId[/:kpId/timeline]
 * and GET /api/interventions/next.
 * Returns false when the path is not a mastery/intervention route.
 */
export async function handleMasteryApi(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  context: MasteryRouteContext
): Promise<boolean> {
  const { pathname } = requestUrl
  const { db, audit, mastery, interventions, user } = context

  const masteryMatch = pathname.match(
    /^\/api\/mastery\/([^/]+)(?:\/([^/]+)\/timeline)?$/
  )
  if (request.method === 'GET' && masteryMatch?.[1]) {
    const studentId = decodeURIComponent(masteryMatch[1])
    const kpId = masteryMatch[2]
      ? decodeURIComponent(masteryMatch[2])
      : undefined

    const gate = guardRoute({
      db,
      audit,
      user,
      response,
      request: { purpose: 'student-data', studentId },
      action: 'view',
      resourceType: 'knowledge',
      forbidden: 'Forbidden: cannot view mastery for this student',
      studentId,
      deniedMetadata: { resource: 'mastery' },
      stampReviewerReason: false
    })
    if (!gate.allowed) return true

    if (kpId !== undefined) {
      const timeline = mastery.getTimeline(studentId, kpId)
      gate.auditor.record({
        studentId,
        result: 'success',
        metadata: { resource: 'mastery-timeline', kpId, count: timeline.length }
      })
      respondJson(response, 200, timeline)
      return true
    }

    const profile = mastery.getProfile(studentId)
    gate.auditor.record({
      studentId,
      result: 'success',
      metadata: {
        resource: 'mastery-profile',
        count: Object.keys(profile).length
      }
    })
    respondJson(response, 200, profile)
    return true
  }

  if (request.method === 'GET' && pathname === '/api/interventions/next') {
    const studentIdParam = requestUrl.searchParams.get('studentId')
    const kpIdParam = requestUrl.searchParams.get('kpId')
    if (!studentIdParam || studentIdParam.trim() === '') {
      respondJson(response, 400, {
        error: 'studentId query parameter is required'
      })
      return true
    }
    if (!kpIdParam || kpIdParam.trim() === '') {
      respondJson(response, 400, { error: 'kpId query parameter is required' })
      return true
    }
    const studentId = studentIdParam

    const gate = guardRoute({
      db,
      audit,
      user,
      response,
      request: { purpose: 'student-data', studentId },
      action: 'view',
      resourceType: 'knowledge',
      forbidden: 'Forbidden: cannot view interventions for this student',
      studentId,
      deniedMetadata: { resource: 'intervention-next' },
      stampReviewerReason: false
    })
    if (!gate.allowed) return true

    let suggestion: InterventionSuggestion
    try {
      suggestion = await interventions.suggestNextIntervention(
        studentId,
        kpIdParam
      )
    } catch (error) {
      gate.auditor.record({
        studentId,
        result: 'error',
        metadata: { resource: 'intervention-next', kpId: kpIdParam }
      })
      respondJson(response, 500, {
        error: 'Failed to diagnose intervention chain',
        details: [error instanceof Error ? error.message : String(error)]
      } satisfies ApiError)
      return true
    }

    gate.auditor.record({
      studentId,
      result: 'success',
      metadata: {
        resource: 'intervention-next',
        weakKp: suggestion.weakKp,
        targetKp: suggestion.targetKp,
        chainLength: suggestion.chain.length
      }
    })
    respondJson(response, 200, suggestion)
    return true
  }

  return false
}
