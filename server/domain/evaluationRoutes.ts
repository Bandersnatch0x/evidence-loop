/**
 * evaluationRoutes — HTTP surface for the evaluation lifecycle.
 *
 * C1 deepening (#36): the POST /api/evaluations orchestration (validate →
 * resolve previous → agent.evaluate → PII scan → attempt/memory projection →
 * audit) was inlined in server/index.ts's handleApi mega-router. Extracted
 * here behind the same delegated-handler seam as the 13 module routers
 * (handleTeacherApi / handleAdaptiveApi / ...): `handleEvaluationApi` returns
 * false when the path is not an evaluation route, letting the dispatcher
 * fall through to the next handler.
 *
 * This moves the evaluation helpers (listEvaluationsForUser,
 * resolvePreviousEvaluation, resolveContainerId) and the request schema out
 * of index.ts with the handler — the domain resolution logic now lives with
 * the orchestration it serves.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import type {
  ApiError,
  EvaluationHistoryItem,
  EvaluationResult,
  TraceStep
} from '../../shared/contracts'
import type { AuditStore } from '../audit/AuditStore'
import { createRouteAuditor } from '../audit/routeAudit'
import type { SessionUser } from '../auth/SessionProvider'
import type { EvaluationAgent } from './EvaluationAgent'
import type { EvidenceProjector } from '../adaptive/EvidenceProjector'
import type { MasteryService } from '../mastery/MasteryService'
import type { ReviewScheduler } from '../review/ReviewScheduler'
import type { AttemptStore } from '../store/AttemptStore'
import { readJsonBody, respondJson } from '../http/httpUtils'
import { PIIError, detectEvaluationPII } from '../pii/PIIDetector'

/** Request shape for POST /api/evaluations (mirrors the pre-extraction schema). */
export const evaluateRequestSchema = z.object({
  assignmentId: z.string().min(1),
  code: z.string().min(1).max(20_000),
  previousEvaluationId: z.string().min(1).optional(),
  attemptId: z.string().min(1).optional(),
  scaffoldUsed: z.boolean().optional(),
  scaffoldDurationMs: z.number().int().min(0).optional()
})

export interface EvaluationRouteContext {
  store: AttemptStore
  agent: Pick<EvaluationAgent, 'evaluate'>
  runnerName: string
  audit: AuditStore
  mastery: Pick<MasteryService, 'recomputeFromEvaluation'>
  review: Pick<ReviewScheduler, 'applyFromEvaluation'>
  evidenceProjector: Pick<EvidenceProjector, 'projectAttempt'>
  user: SessionUser
  /**
   * T20: after a successful evaluation, recompute evidence achievements.
   * Best-effort / never blocks scoring (errors swallowed).
   */
  achievements?: {
    sync: (
      studentId: string,
      options?: { teachingUnitId?: string }
    ) => Promise<unknown>
  }
}

/** Students see only their own history; teachers/admins see all. */
export async function listEvaluationsForUser(
  store: AttemptStore,
  user: SessionUser,
  assignmentId?: string
): Promise<EvaluationHistoryItem[]> {
  if (user.role === 'admin' || user.role === 'teacher') {
    return store.list({ assignmentId })
  }

  const studentId = user.studentId ?? user.userId
  return store.list({ assignmentId, studentId })
}

/**
 * Resolve the previous evaluation for a new evaluation: explicit id (owner-
 * checked for students), latest own history for students, or latest overall.
 */
export async function resolvePreviousEvaluation(
  store: AttemptStore,
  user: SessionUser,
  assignmentId: string,
  previousEvaluationId?: string
): Promise<EvaluationResult | undefined> {
  if (previousEvaluationId) {
    const previous = await store.get(previousEvaluationId)
    if (!previous) return undefined
    if (user.role === 'student') {
      const owner = user.studentId ?? user.userId
      if (previous.studentId !== undefined && previous.studentId !== owner) {
        return undefined
      }
    }
    return previous
  }

  if (user.role === 'student') {
    const owner = user.studentId ?? user.userId
    if (store.latestForStudent !== undefined) {
      return store.latestForStudent(assignmentId, owner)
    }
    const history = await store.list({ assignmentId, studentId: owner })
    const latestId = history[0]?.id
    return latestId ? store.get(latestId) : undefined
  }

  return store.latest(assignmentId)
}

/**
 * Prefer an explicit container id from the runner when present; fall back to
 * the runner name so subprocess demos still produce a stable audit field.
 */
export function resolveContainerId(
  evaluation: EvaluationResult,
  runnerName: string
): string {
  const fromTrace = evaluation.trace.find((step: TraceStep) => step.tool === 'python.safe-runner')
  if (fromTrace?.summary.includes('container:')) {
    const match = /container:([^\s]+)/u.exec(fromTrace.summary)
    if (match?.[1]) return match[1]
  }
  return runnerName
}

/**
 * Handle GET /api/evaluations, POST /api/evaluations, DELETE
 * /api/evaluations/:id. Returns false for non-evaluation paths so the
 * dispatcher can fall through.
 */
export async function handleEvaluationApi(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  context: EvaluationRouteContext
): Promise<boolean> {
  const { pathname } = requestUrl
  if (!pathname.startsWith('/api/evaluations')) return false
  const { store, agent, runnerName, audit, mastery, review, evidenceProjector } = context

  if (request.method === 'GET' && pathname === '/api/evaluations') {
    const assignmentId =
      requestUrl.searchParams.get('assignmentId') ?? undefined
    const history = await listEvaluationsForUser(store, context.user, assignmentId)
    createRouteAuditor(audit, context.user, {
      action: 'view',
      resourceType: 'evaluation'
    }).record({
      studentId: context.user.studentId,
      result: 'success',
      metadata: {
        count: history.length,
        assignmentId: assignmentId ?? null
      }
    })
    respondJson(response, 200, history)
    return true
  }

  if (request.method === 'POST' && pathname === '/api/evaluations') {
    const parsed = evaluateRequestSchema.safeParse(await readJsonBody(request))
    if (!parsed.success) {
      respondJson(response, 400, {
        error: 'Invalid evaluation request',
        details: parsed.error.issues.map((issue) => issue.message)
      } satisfies ApiError)
      return true
    }

    const previous = await resolvePreviousEvaluation(
      store,
      context.user,
      parsed.data.assignmentId,
      parsed.data.previousEvaluationId
    )
    const evaluation = await agent.evaluate(parsed.data, previous)
    const owned: EvaluationResult = {
      ...evaluation,
      studentId: context.user.studentId ?? context.user.userId,
      provenance: evaluation.provenance ?? {
        kind: 'evidence',
        evidenceIds: evaluation.evidence.map((item) => item.id),
        algorithm: 'simple.v1'
      },
      // P2-1 支架留痕：呈现层元数据，永不入分（红线）。
      scaffoldUsed: parsed.data.scaffoldUsed,
      scaffoldDurationMs: parsed.data.scaffoldDurationMs
    }

    // ADR-0003 §3: scan free-form fields before persistence; reject on hit.
    try {
      detectEvaluationPII(owned)
    } catch (error) {
      if (error instanceof PIIError) {
        createRouteAuditor(audit, context.user, {
          action: 'evaluate',
          resourceType: 'evaluation'
        }).record({
          resourceId: owned.id,
          studentId: owned.studentId,
          containerId: runnerName,
          result: 'pii_rejected',
          metadata: {
            assignmentId: owned.assignmentId,
            score: owned.score,
            attempt: owned.attempt,
            piiDetected: true,
            piiField: error.matches[0]?.field ?? null,
            piiKind: error.matches[0]?.kind ?? null
          }
        })
        throw error
      }
      throw error
    }

    // Product Attempt path (T07): when the client supplies attemptId, update
    // that Attempt in place and preserve mode/paperId/teachingUnitId/termId so
    // D1 dual-mode mastery projection and T07 session grouping stay honest.
    // Legacy demo callers omit attemptId and still get assessment-default
    // Attempts via store.save → evaluationToLegacyAttempt.
    const attemptId = parsed.data.attemptId
    let projectedMode: 'practice' | 'assessment' = 'assessment'
    if (attemptId !== undefined) {
      const existing = await store.getAttempt(attemptId)
      if (!existing) {
        respondJson(response, 404, { error: 'Attempt not found' })
        return true
      }
      const owner = context.user.studentId ?? context.user.userId
      if (
        context.user.role === 'student' &&
        existing.studentId !== owner
      ) {
        respondJson(response, 403, {
          error: 'Forbidden: cannot evaluate an attempt you do not own'
        })
        return true
      }
      // Keep the original evaluation id on the Attempt aggregate so tutoring
      // and mistake-book references remain stable after submit.
      const resultForAttempt = {
        ...owned,
        id: existing.id,
        studentId: existing.studentId
      }
      const updatedAttempt = {
        ...existing,
        result: resultForAttempt
      }
      await store.saveAttempt(updatedAttempt)
      projectedMode = existing.mode
      if (resultForAttempt.status === 'completed') {
        await evidenceProjector.projectAttempt(updatedAttempt)
        // Best-effort badge sync: never blocks the response (T20 contract).
        void syncAchievementsSafe(context, existing.studentId, existing.teachingUnitId)
      }
      const containerId = resolveContainerId(resultForAttempt, runnerName)
      createRouteAuditor(audit, context.user, {
        action: 'evaluate',
        resourceType: 'evaluation'
      }).record({
        resourceId: existing.id,
        studentId: existing.studentId,
        containerId,
        result:
          resultForAttempt.status === 'completed'
            ? 'success'
            : resultForAttempt.status,
        metadata: {
          assignmentId: resultForAttempt.assignmentId,
          score: resultForAttempt.score,
          attempt: resultForAttempt.attempt,
          piiDetected: false,
          mode: projectedMode,
          attemptId: existing.id
        }
      })
      respondJson(response, 201, resultForAttempt)
      return true
    }

    await store.save(owned)
    // Legacy demo path: assessment-default, both mastery + FSRS.
    if (owned.status === 'completed') {
      await mastery.recomputeFromEvaluation(owned)
      review.applyFromEvaluation(owned)
      if (owned.studentId) {
        // Best-effort badge sync: never blocks the response (T20 contract).
        void syncAchievementsSafe(context, owned.studentId)
      }
    }

    const containerId = resolveContainerId(owned, runnerName)
    createRouteAuditor(audit, context.user, {
      action: 'evaluate',
      resourceType: 'evaluation'
    }).record({
      resourceId: owned.id,
      studentId: owned.studentId,
      containerId,
      result: owned.status === 'completed' ? 'success' : owned.status,
      metadata: {
        assignmentId: owned.assignmentId,
        score: owned.score,
        attempt: owned.attempt,
        piiDetected: false,
        mode: 'assessment',
        attemptId: null
      }
    })

    respondJson(response, 201, owned)
    return true
  }

  const evaluationGetMatch = pathname.match(/^\/api\/evaluations\/([^/]+)$/)
  if (request.method === 'GET' && evaluationGetMatch?.[1]) {
    const evaluationId = decodeURIComponent(evaluationGetMatch[1])
    const existing = await store.get(evaluationId)
    if (!existing) {
      respondJson(response, 404, { error: 'Evaluation not found' })
      return true
    }
    const isOwner =
      existing.studentId === (context.user.studentId ?? context.user.userId)
    const isPrivileged =
      context.user.role === 'teacher' || context.user.role === 'admin'
    if (!isOwner && !isPrivileged) {
      respondJson(response, 403, {
        error: 'Forbidden: cannot view an evaluation you do not own'
      })
      return true
    }
    respondJson(response, 200, existing)
    return true
  }

  const evaluationDeleteMatch = pathname.match(/^\/api\/evaluations\/([^/]+)$/)
  if (request.method === 'DELETE' && evaluationDeleteMatch?.[1]) {
    const evaluationId = decodeURIComponent(evaluationDeleteMatch[1])
    const existing = await store.get(evaluationId)
    if (!existing) {
      respondJson(response, 404, { error: 'Evaluation not found' })
      return true
    }

    const isOwner =
      existing.studentId === (context.user.studentId ?? context.user.userId)
    const isPrivileged =
      context.user.role === 'teacher' || context.user.role === 'admin'
    if (!isOwner && !isPrivileged) {
      createRouteAuditor(audit, context.user, {
        action: 'delete',
        resourceType: 'evaluation'
      }).record({
        resourceId: evaluationId,
        studentId: existing.studentId,
        result: 'denied'
      })
      respondJson(response, 403, {
        error: 'Forbidden: cannot erase an evaluation you do not own'
      })
      return true
    }

    const deleted = await store.delete(evaluationId)
    createRouteAuditor(audit, context.user, {
      action: 'delete',
      resourceType: 'evaluation'
    }).record({
      resourceId: evaluationId,
      studentId: existing.studentId,
      result: deleted ? 'success' : 'not_found'
    })
    respondJson(response, deleted ? 200 : 404, { id: evaluationId, deleted })
    return true
  }

  return false
}

/** T20: never fail evaluation because badge recompute threw. */
async function syncAchievementsSafe(
  context: EvaluationRouteContext,
  studentId: string,
  teachingUnitId?: string
): Promise<void> {
  if (!context.achievements) return
  try {
    await context.achievements.sync(
      studentId,
      teachingUnitId ? { teachingUnitId } : {}
    )
  } catch (error) {
    console.error('Achievement sync failed:', error)
  }
}
