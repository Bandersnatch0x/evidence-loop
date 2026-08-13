/**
 * reviewRoutes — FSRS due-queue + complete HTTP surface.
 *
 * Extracted from server/index.ts (architecture deepening C2). Uses guardRoute
 * for the authorize→audit→403 ceremony (deepening C1).
 *
 * Stays free of multimodal / demonstration / memory imports (ADR-0005/0006 / T-A).
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Database } from 'better-sqlite3'
import { z } from 'zod'
import type { ApiError } from '../../shared/contracts'
import type { AuditStore } from '../audit/AuditStore'
import type { SessionUser } from '../auth/SessionProvider'
import { guardRoute } from '../http/guardRoute'
import { readJsonBody, respondJson } from '../http/httpUtils'
import type { ReviewRating, ReviewScheduler } from './ReviewScheduler'

const reviewCompleteSchema = z.object({
  rating: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4)
  ])
})

export interface ReviewRouteContext {
  db: Database
  audit: AuditStore
  review: Pick<ReviewScheduler, 'listDue' | 'getById' | 'complete'>
  user: SessionUser
}

/**
 * Handle GET /api/review/next and POST /api/review/:id/complete.
 * Returns false when the path is not a review route.
 */
export async function handleReviewApi(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  context: ReviewRouteContext
): Promise<boolean> {
  const { pathname } = requestUrl
  if (!pathname.startsWith('/api/review')) return false

  const { db, audit, review, user } = context

  if (request.method === 'GET' && pathname === '/api/review/next') {
    const studentIdParam = requestUrl.searchParams.get('studentId')
    if (!studentIdParam || studentIdParam.trim() === '') {
      respondJson(response, 400, {
        error: 'studentId query parameter is required'
      })
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
      forbidden: 'Forbidden: cannot view review queue for this student',
      studentId,
      deniedMetadata: { resource: 'review-next' },
      stampReviewerReason: false
    })
    if (!gate.allowed) return true

    const cards = review.listDue(studentId)
    gate.auditor.record({
      studentId,
      result: 'success',
      metadata: { resource: 'review-next', count: cards.length }
    })
    respondJson(response, 200, cards)
    return true
  }

  const reviewCompleteMatch = pathname.match(/^\/api\/review\/([^/]+)\/complete$/)
  if (request.method === 'POST' && reviewCompleteMatch?.[1]) {
    const cardId = decodeURIComponent(reviewCompleteMatch[1])
    const parsed = reviewCompleteSchema.safeParse(await readJsonBody(request))
    if (!parsed.success) {
      respondJson(response, 400, {
        error: 'Invalid review complete request',
        details: parsed.error.issues.map((issue) => issue.message)
      } satisfies ApiError)
      return true
    }

    const existing = review.getById(cardId)
    if (!existing) {
      respondJson(response, 404, { error: 'Review card not found' })
      return true
    }

    const gate = guardRoute({
      db,
      audit,
      user,
      response,
      request: { purpose: 'student-data', studentId: existing.studentId },
      action: 'evaluate',
      resourceType: 'knowledge',
      forbidden: 'Forbidden: cannot complete review for this student',
      studentId: existing.studentId,
      resourceId: cardId,
      deniedMetadata: { resource: 'review-complete' },
      stampReviewerReason: false
    })
    if (!gate.allowed) return true

    const rating: ReviewRating = parsed.data.rating
    const updated = review.complete(cardId, rating)
    if (!updated) {
      respondJson(response, 404, { error: 'Review card not found' })
      return true
    }

    gate.auditor.record({
      studentId: updated.studentId,
      resourceId: updated.id,
      result: 'success',
      metadata: {
        resource: 'review-complete',
        kpId: updated.kpId,
        rating,
        dueAt: updated.scheduling.dueAt
      }
    })
    respondJson(response, 200, updated)
    return true
  }

  return false
}
