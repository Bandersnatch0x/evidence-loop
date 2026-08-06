import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import type { ViteDevServer } from 'vite'
import { createServerContext } from './serverContext'
import type { ApiContext, EvidenceRingServerOptions } from './serverTypes'
import { HttpError, readJsonBody, respondJson } from './http/httpUtils'
import type { ApiError, InterventionSuggestion } from '../shared/contracts'
import { createRouteAuditor } from './audit/routeAudit'
import { canAccessStudent } from './auth/authorization'
import { tryHandleAuthRoute } from './auth/authRoutes'
import { AuthError, authStatusCode } from './auth/errors'
import { isMultimodalEnabled } from './config/features'
import { handleAdaptiveApi } from './adaptive'
import { createCohortSnapshot } from './data/cohort'
import { handleEvaluationApi } from './domain/evaluationRoutes'
import { tryHandleImportRoute } from './import'
import { projectQuestionToAssignment } from './questionbank/projectQuestionAssignment'
import { handleTeacherApi } from './teacher'
import { handleStudentApi } from './student'
import { handleTutoringApi } from './tutoring'
import { handleQuestionBankApi } from './questionbank/questionRoutes'
import { handleMediaApi } from './media/mediaRoutes'
import { isPublicLibraryReviewer } from './demonstration/reviewerAuth'
import { handleReviewerApi } from './demonstration/reviewerRoutes'
import { handlePlayerApi } from './demonstration/playerRoutes'
import { handleAuthorApi } from './demonstration/authorRoutes'
import { handleAiApi } from './demonstration/aiRoutes'
import { handleReferenceApi } from './demonstration/referenceRoutes'
import { handleLibraryApi } from './demonstration/libraryRoutes'
import { respondMultimodalAsk } from './multimodal/askRoute'
import { respondSTTFinalize, respondSTTStart } from './multimodal/sttRoute'
import { PIIError, findPIIInText } from './pii/PIIDetector'
import type { ReviewRating } from './review/ReviewScheduler'

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const isProduction = process.argv.includes('--production')
const port = Number(process.env.PORT ?? 4180)


const multimodalAskSchema = z.object({
  text: z.string().min(1).max(2000),
  /** Client-reported recording duration in ms (metadata only; never stored as audio). */
  durationMs: z.number().int().nonnegative().max(600_000).optional()
})

const sttStartSchema = z.object({
  sessionId: z.string().min(1).max(128).optional(),
  language: z.string().min(2).max(32).optional()
})

const sttFinalizeSchema = z.object({
  text: z.string().min(1).max(4000),
  sessionId: z.string().min(1).max(128).optional()
})

const reviewCompleteSchema = z.object({
  rating: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4)
  ])
})

export async function createEvidenceRingServer(
  options: EvidenceRingServerOptions = {}
) {
  const composed = await createServerContext(options)
  let vite: ViteDevServer | undefined
  try {
    vite = options.vite ? await createViteMiddleware() : undefined
  } catch (error) {
    await composed.dispose()
    throw error
  }

  const server = createServer((request, response) => {
    void routeRequest(request, response, composed.context, vite)
  })
  server.once('close', () => {
    void composed.dispose()
  })
  return server
}

export { createConfiguredRunner } from './runner/configuredRunner'

async function start(): Promise<void> {
  const server = await createEvidenceRingServer({ vite: !isProduction })

  server.listen(port, '0.0.0.0', () => {
    console.log(`EvidenceRing running at http://localhost:${String(port)}`)
  })
}

async function createViteMiddleware(): Promise<ViteDevServer> {
  const { createServer: createViteServer } = await import('vite')
  // Prefer an explicit free HMR port. The default 24678 collides when another
  // Vite instance is already alive on the machine, which throws a page error
  // and confuses Playwright boot checks.
  const hmrPort = Number(process.env.VITE_HMR_PORT ?? 24679)
  return createViteServer({
    root: projectRoot,
    server: {
      middlewareMode: true,
      hmr: {
        port: hmrPort,
        clientPort: hmrPort
      }
    },
    appType: 'spa'
  })
}

async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  context: ApiContext,
  vite?: ViteDevServer
): Promise<void> {
  try {
    const requestUrl = new URL(
      request.url ?? '/',
      `http://${request.headers.host ?? `localhost:${String(port)}`}`
    )

    if (requestUrl.pathname.startsWith('/api/')) {
      await handleApi(request, response, requestUrl, context)
      return
    }

    if (requestUrl.pathname === '/favicon.ico') {
      response.writeHead(204, { 'cache-control': 'public, max-age=86400' })
      response.end()
      return
    }

    if (vite) {
      vite.middlewares.handle(request, response, () => {
        respondJson(response, 404, { error: 'Not found' })
      })
      return
    }

    await serveProductionAsset(requestUrl.pathname, response)
  } catch (error) {
    if (error instanceof HttpError && !response.headersSent) {
      respondJson(response, error.statusCode, { error: error.message })
      return
    }
    if (error instanceof PIIError && !response.headersSent) {
      respondJson(response, 422, { error: error.message })
      return
    }
    // Real-session provider throws AuthError on unauthenticated requests.
    if (error instanceof AuthError && !response.headersSent) {
      respondJson(response, authStatusCode(error), { error: error.message })
      return
    }
    console.error(error)
    if (!response.headersSent) {
      respondJson(response, 500, { error: 'Internal server error' })
    } else {
      response.end()
    }
  }
}

async function handleApi(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  context: ApiContext
): Promise<void> {
  const {
    assignments,
    store,
    agent,
    runnerName,
    knowledge,
    audit,
    sessions,
    memory,
    interventions,
    stt
  } = context

  // Auth routes (register/login/activate/change-password/logout) do not
  // require a session — they're the entry to obtaining one. Must run BEFORE
  // sessions.resolve, otherwise real-mode unauthenticated callers throw.
  if (
    await tryHandleAuthRoute(request, response, requestUrl, {
      auth: context.auth,
      sessions
    })
  ) {
    return
  }

  // Health is an infrastructure probe — no auth required.
  if (request.method === 'GET' && requestUrl.pathname === '/api/health') {
    respondJson(response, 200, {
      status: 'ok',
      runner: runnerName,
      feedback: process.env.LLM_API_KEY ? 'llm-with-fallback' : 'local-policy'
    })
    return
  }

  const user = sessions.resolve(request)

  if (request.method === 'GET' && requestUrl.pathname === '/api/assignments') {
    respondJson(response, 200, assignments.list())
    return
  }

  const assignmentMatch = requestUrl.pathname.match(/^\/api\/assignments\/([^/]+)$/)
  if (request.method === 'GET' && assignmentMatch?.[1]) {
    const requestedId = decodeURIComponent(assignmentMatch[1])
    // Presentation-only reference lookup. This stays outside AssignmentRegistry
    // so EvaluationAgent/scoring never reads demonstration tables.
    const demonstrations = context.demonstration.references.listStudentReferencesForAssignment(requestedId)
    // Question-backed registry: demo hit or private/seed
    // projection. Presentation fields only — never expose runner/criteria.
    const assignment = assignments.get(requestedId)
    if (!assignment) {
      // Scoring projection may fail on bad payload; still serve presentation shell.
      const bankQuestion = context.questionBank.peek(requestedId)
      if (!bankQuestion) {
        respondJson(response, 404, { error: 'Assignment not found' })
        return
      }
      const projected = projectQuestionToAssignment(bankQuestion)
      if (demonstrations.length > 0) projected.demonstrations = demonstrations
      respondJson(response, 200, projected)
      return
    }

    const publicAssignment = {
      id: assignment.id,
      title: assignment.title,
      module: assignment.module,
      language: assignment.language,
      questionType: assignment.questionType,
      estimatedMinutes: assignment.estimatedMinutes,
      status: assignment.status,
      objective: assignment.objective,
      scenario: assignment.scenario,
      requirements: assignment.requirements,
      constraints: assignment.constraints,
      functionSignature: assignment.functionSignature,
      rubric: assignment.rubric,
      demoVariants: assignment.demoVariants,
      ...(demonstrations.length > 0 ? { demonstrations } : {})
    }
    respondJson(response, 200, publicAssignment)
    return
  }

  // Evaluation lifecycle (GET list / POST submit / DELETE erase) is delegated
  // to the domain handler behind the same seam as the other module routers
  // (C1 deepening #36).
  if (
    await handleEvaluationApi(request, response, requestUrl, {
      store,
      agent,
      runnerName,
      audit,
      mastery: memory.mastery,
      review: memory.review,
      evidenceProjector: context.evidenceProjector,
      user
    })
  ) {
    return
  }


  if (request.method === 'GET' && requestUrl.pathname === '/api/cohort') {
    if (user.role !== 'teacher' && user.role !== 'admin') {
      createRouteAuditor(audit, user, {
        action: 'view',
        resourceType: 'cohort'
      }).record({
        result: 'denied'
      })
      respondJson(response, 403, {
        error: 'Forbidden: cohort view requires teacher or admin role'
      })
      return
    }
    // Spec §2.8: a public-library reviewer principal is never granted
    // teaching / grade / audit view authority, even when their role is
    // teacher|admin (the reviewer flag is additive, not a role expansion).
    if (isPublicLibraryReviewer(context.productDb, user.userId)) {
      createRouteAuditor(audit, user, {
        action: 'view',
        resourceType: 'cohort'
      }).record({
        result: 'denied',
        metadata: { reason: 'reviewer-isolated' }
      })
      respondJson(response, 403, {
        error: 'Forbidden: public-library reviewers may not view cohort data'
      })
      return
    }

    createRouteAuditor(audit, user, {
      action: 'view',
      resourceType: 'cohort'
    }).record({
      result: 'success'
    })
    // Pass full results so T11 P4 can gate formal metrics on teacherAnnotation.
    const [history, results] = await Promise.all([
      store.list(),
      store.listResults()
    ])
    respondJson(response, 200, createCohortSnapshot(history, results))
    return
  }

  if (
    request.method === 'GET'
    && requestUrl.pathname === '/api/cohort/multimodal-usage'
  ) {
    if (user.role !== 'teacher' && user.role !== 'admin') {
      createRouteAuditor(audit, user, {
        action: 'view',
        resourceType: 'cohort'
      }).record({
        result: 'denied',
        metadata: { resource: 'multimodal-usage' }
      })
      respondJson(response, 403, {
        error: 'Forbidden: multimodal usage requires teacher or admin role'
      })
      return
    }

    const classId = requestUrl.searchParams.get('classId')
    if (classId === null || classId.trim() === '') {
      respondJson(response, 400, {
        error: 'classId query parameter is required'
      })
      return
    }

    // Demo is a single cohort; accept any non-empty classId and return
    // aggregate counts only (no transcript content).
    const usage = await audit.getMultimodalUsage()
    createRouteAuditor(audit, user, {
      action: 'view',
      resourceType: 'cohort'
    }).record({
      result: 'success',
      metadata: {
        resource: 'multimodal-usage',
        classId,
        count: usage.length
      }
    })
    respondJson(response, 200, usage)
    return
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/knowledge-points') {
    respondJson(response, 200, await knowledge.getGraph())
    return
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/audit') {
    if (user.role !== 'teacher' && user.role !== 'admin') {
      createRouteAuditor(audit, user, {
        action: 'view',
        resourceType: 'audit'
      }).record({
        result: 'denied'
      })
      respondJson(response, 403, {
        error: 'Forbidden: audit log requires teacher or admin role'
      })
      return
    }
    // Spec §2.8: reviewers never get audit view authority (see /api/cohort).
    if (isPublicLibraryReviewer(context.productDb, user.userId)) {
      createRouteAuditor(audit, user, {
        action: 'view',
        resourceType: 'audit'
      }).record({
        result: 'denied',
        metadata: { reason: 'reviewer-isolated' }
      })
      respondJson(response, 403, {
        error: 'Forbidden: public-library reviewers may not view audit data'
      })
      return
    }

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

    createRouteAuditor(audit, user, {
      action: 'view',
      resourceType: 'audit'
    }).record({
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
    return
  }

  if (request.method === 'POST' && requestUrl.pathname === '/api/multimodal/ask') {
    const parsed = multimodalAskSchema.safeParse(await readJsonBody(request))
    if (!parsed.success) {
      respondJson(response, 400, {
        error: 'Invalid multimodal ask request'
      })
      return
    }

    const featureEnabled = isMultimodalEnabled()
    const transcript = parsed.data.text
    const piiHits = findPIIInText('voice_transcript', transcript)
    const studentId = user.studentId ?? user.userId

    // ADR-0005 §7: audit metadata only — duration, char count, PII hit count.
    // Never persist the transcript body or raw audio bytes.
    if (featureEnabled) {
      createRouteAuditor(audit, user, {
        action: 'view',
        resourceType: 'system'
      }).record({
        resourceId: 'multimodal-ask',
        studentId,
        result: 'success',
        modality: 'voice',
        metadata: {
          durationMs: parsed.data.durationMs ?? null,
          transcriptChars: transcript.length,
          piiHitCount: piiHits.length
        }
      })
    }

    respondMultimodalAsk(response, featureEnabled)
    return
  }

  if (
    request.method === 'POST'
    && requestUrl.pathname === '/api/multimodal/stt/start'
  ) {
    const parsed = sttStartSchema.safeParse(await readJsonBody(request))
    if (!parsed.success) {
      respondJson(response, 400, {
        error: 'Invalid STT start request'
      })
      return
    }
    await respondSTTStart(
      response,
      isMultimodalEnabled(),
      stt,
      parsed.data
    )
    return
  }

  if (
    request.method === 'POST'
    && requestUrl.pathname === '/api/multimodal/stt/finalize'
  ) {
    const parsed = sttFinalizeSchema.safeParse(await readJsonBody(request))
    if (!parsed.success) {
      respondJson(response, 400, {
        error: 'Invalid STT finalize request'
      })
      return
    }
    await respondSTTFinalize(
      response,
      isMultimodalEnabled(),
      stt,
      parsed.data
    )
    return
  }

  const masteryMatch = requestUrl.pathname.match(
    /^\/api\/mastery\/([^/]+)(?:\/([^/]+)\/timeline)?$/
  )
  if (request.method === 'GET' && masteryMatch?.[1]) {
    const studentId = decodeURIComponent(masteryMatch[1])
    const kpId = masteryMatch[2]
      ? decodeURIComponent(masteryMatch[2])
      : undefined

    if (!canAccessStudent(user, studentId)) {
      createRouteAuditor(audit, user, {
        action: 'view',
        resourceType: 'knowledge'
      }).record({
        studentId,
        result: 'denied',
        metadata: { resource: 'mastery' }
      })
      respondJson(response, 403, {
        error: 'Forbidden: cannot view mastery for this student'
      })
      return
    }

    if (kpId !== undefined) {
      const timeline = memory.mastery.getTimeline(studentId, kpId)
      createRouteAuditor(audit, user, {
        action: 'view',
        resourceType: 'knowledge'
      }).record({
        studentId,
        result: 'success',
        metadata: { resource: 'mastery-timeline', kpId, count: timeline.length }
      })
      respondJson(response, 200, timeline)
      return
    }

    const profile = memory.mastery.getProfile(studentId)
    createRouteAuditor(audit, user, {
      action: 'view',
      resourceType: 'knowledge'
    }).record({
      studentId,
      result: 'success',
      metadata: {
        resource: 'mastery-profile',
        count: Object.keys(profile).length
      }
    })
    respondJson(response, 200, profile)
    return
  }

  if (
    request.method === 'GET' &&
    requestUrl.pathname === '/api/interventions/next'
  ) {
    const studentIdParam = requestUrl.searchParams.get('studentId')
    const kpIdParam = requestUrl.searchParams.get('kpId')
    if (!studentIdParam || studentIdParam.trim() === '') {
      respondJson(response, 400, { error: 'studentId query parameter is required' })
      return
    }
    if (!kpIdParam || kpIdParam.trim() === '') {
      respondJson(response, 400, { error: 'kpId query parameter is required' })
      return
    }
    const studentId = studentIdParam

    if (!canAccessStudent(user, studentId)) {
      createRouteAuditor(audit, user, {
        action: 'view',
        resourceType: 'knowledge'
      }).record({
        studentId,
        result: 'denied',
        metadata: { resource: 'intervention-next' }
      })
      respondJson(response, 403, {
        error: 'Forbidden: cannot view interventions for this student'
      })
      return
    }

    let suggestion: InterventionSuggestion
    try {
      suggestion = await interventions.suggestNextIntervention(
        studentId,
        kpIdParam
      )
    } catch (error) {
      createRouteAuditor(audit, user, {
        action: 'view',
        resourceType: 'knowledge'
      }).record({
        studentId,
        result: 'error',
        metadata: { resource: 'intervention-next', kpId: kpIdParam }
      })
      respondJson(response, 500, {
        error: 'Failed to diagnose intervention chain',
        details: [error instanceof Error ? error.message : String(error)]
      } satisfies ApiError)
      return
    }

    createRouteAuditor(audit, user, {
      action: 'view',
      resourceType: 'knowledge'
    }).record({
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
    return
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/review/next') {
    const studentIdParam = requestUrl.searchParams.get('studentId')
    if (!studentIdParam || studentIdParam.trim() === '') {
      respondJson(response, 400, { error: 'studentId query parameter is required' })
      return
    }
    const studentId = studentIdParam

    if (!canAccessStudent(user, studentId)) {
      createRouteAuditor(audit, user, {
        action: 'view',
        resourceType: 'knowledge'
      }).record({
        studentId,
        result: 'denied',
        metadata: { resource: 'review-next' }
      })
      respondJson(response, 403, {
        error: 'Forbidden: cannot view review queue for this student'
      })
      return
    }

    const cards = memory.review.listDue(studentId)
    createRouteAuditor(audit, user, {
      action: 'view',
      resourceType: 'knowledge'
    }).record({
      studentId,
      result: 'success',
      metadata: { resource: 'review-next', count: cards.length }
    })
    respondJson(response, 200, cards)
    return
  }

  const reviewCompleteMatch = requestUrl.pathname.match(
    /^\/api\/review\/([^/]+)\/complete$/
  )
  if (request.method === 'POST' && reviewCompleteMatch?.[1]) {
    const cardId = decodeURIComponent(reviewCompleteMatch[1])
    const parsed = reviewCompleteSchema.safeParse(await readJsonBody(request))
    if (!parsed.success) {
      respondJson(response, 400, {
        error: 'Invalid review complete request',
        details: parsed.error.issues.map((issue) => issue.message)
      } satisfies ApiError)
      return
    }

    const existing = memory.review.getById(cardId)
    if (!existing) {
      respondJson(response, 404, { error: 'Review card not found' })
      return
    }

    if (!canAccessStudent(user, existing.studentId)) {
      createRouteAuditor(audit, user, {
        action: 'evaluate',
        resourceType: 'knowledge'
      }).record({
        studentId: existing.studentId,
        resourceId: cardId,
        result: 'denied',
        metadata: { resource: 'review-complete' }
      })
      respondJson(response, 403, {
        error: 'Forbidden: cannot complete review for this student'
      })
      return
    }

    const rating: ReviewRating = parsed.data.rating
    const updated = memory.review.complete(cardId, rating)
    if (!updated) {
      respondJson(response, 404, { error: 'Review card not found' })
      return
    }

    createRouteAuditor(audit, user, {
      action: 'evaluate',
      resourceType: 'knowledge'
    }).record({
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
    return
  }

  // ---------------------------------------------------------------------------
  // Delegated module routers (T02-T08). Each returns true when it consumed the
  // request. Kept after the core evaluation/mastery routes so those stay hot.
  // (Auth routes are handled above, before sessions.resolve.)
  // ---------------------------------------------------------------------------
  if (
    await handleQuestionBankApi(request, response, requestUrl, {
      questionBank: context.questionBank,
      db: context.productDb,
      questionStore: context.questionStore,
      user
    })
  ) {
    return
  }
  if (
    await handleTutoringApi(request, response, requestUrl, {
      tutoring: context.tutoring,
      user
    })
  ) {
    return
  }
  if (
    await tryHandleImportRoute(request, response, requestUrl, {
      importService: context.importService,
      user
    })
  ) {
    return
  }
  if (
    await handleAdaptiveApi(request, response, requestUrl, {
      nextPractice: context.nextPractice,
      assignByWeakness: context.assignByWeakness,
      user
    })
  ) {
    return
  }
  if (
    await handleStudentApi(request, response, requestUrl, {
      sessions: context.practiceSessions,
      mistakes: context.mistakes,
      tips: context.tips,
      user
    })
  ) {
    return
  }
  if (
    await handleTeacherApi(request, response, requestUrl, {
      teachingUnits: context.teachingUnits,
      roster: context.roster,
      assignments: context.assignmentService,
      grading: context.grading,
      tips: context.tips,
      user
    })
  ) {
    return
  }
  if (
    await handleMediaApi(request, response, requestUrl, {
      db: context.media.db,
      blobs: context.media.blobs,
      uploads: context.media.uploads,
      processor: context.media.processor,
      scanner: context.media.scanner,
      user
    })
  ) {
    return
  }
  if (
    await handleReviewerApi(request, response, requestUrl, {
      db: context.demonstration.db,
      demoService: context.demonstration.demoService,
      aiQuota: context.demonstration.aiQuota,
      references: context.demonstration.references,
      review: context.demonstration.review,
      evidence: context.demonstration.evidence,
      notifications: context.demonstration.notifications,
      reports: context.demonstration.reports,
      appeals: context.demonstration.appeals,
      user
    })
  ) {
    return
  }
  if (
    handlePlayerApi(request, response, requestUrl.pathname, {
      db: context.demonstration.db,
      references: context.demonstration.references,
      getRole: () => user.role
    })
  ) {
    return
  }
  if (
    await handleAuthorApi(request, response, requestUrl.pathname, {
      db: context.demonstration.db,
      service: context.demonstration.demoService,
      getUserId: () => user.userId
    })
  ) {
    return
  }
  if (
    await handleAiApi(request, response, requestUrl.pathname, {
      db: context.demonstration.db,
      service: context.demonstration.demoService,
      quota: context.demonstration.aiQuota,
      getUserId: () => user.userId
    })
  ) {
    return
  }
  if (
    await handleReferenceApi(request, response, requestUrl.pathname, requestUrl, {
      db: context.demonstration.db,
      references: context.demonstration.references,
      notifications: context.demonstration.notifications,
      getUserId: () => user.userId,
      getRole: () => user.role
    })
  ) {
    return
  }
  if (
    handleLibraryApi(request, response, requestUrl.pathname, requestUrl, {
      db: context.demonstration.db,
      getUserId: () => user.userId
    })
  ) {
    return
  }

  respondJson(response, 404, { error: 'API route not found' })
}

/**
 * Strip any accidental free-text keys from audit metadata before API exposure.
 * Voice events must only ever carry counts / durations (ADR-0005 §7).
 */
function sanitizeAuditMetadata(
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

async function serveProductionAsset(
  pathname: string,
  response: ServerResponse
): Promise<void> {
  const distRoot = join(projectRoot, 'dist')
  const requestedPath = pathname === '/' ? 'index.html' : pathname.slice(1)
  const normalizedPath = normalize(requestedPath)
  let filePath = resolve(distRoot, normalizedPath)

  if (!isPathInside(distRoot, filePath)) {
    respondJson(response, 403, { error: 'Forbidden' })
    return
  }

  try {
    const fileStats = await stat(filePath)
    if (fileStats.isDirectory()) filePath = join(filePath, 'index.html')
  } catch {
    filePath = join(distRoot, 'index.html')
  }

  try {
    const fileStats = await stat(filePath)
    response.writeHead(200, {
      'content-type': contentType(extname(filePath)),
      'content-length': fileStats.size,
      'cache-control': filePath.endsWith('index.html')
        ? 'no-cache'
        : 'public, max-age=31536000, immutable'
    })
    createReadStream(filePath).pipe(response)
  } catch {
    const html = await readFile(join(distRoot, 'index.html'), 'utf8')
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(html)
  }
}

function contentType(extension: string): string {
  const types: Record<string, string> = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2'
  }
  return types[extension] ?? 'application/octet-stream'
}

function isPathInside(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate)
  return relativePath === '' || (
    !isAbsolute(relativePath)
    && relativePath !== '..'
    && !relativePath.startsWith(`..${sep}`)
  )
}

const entryPath = process.argv[1] ? normalize(resolve(process.argv[1])) : ''
const modulePath = normalize(fileURLToPath(import.meta.url))
if (entryPath.toLowerCase() === modulePath.toLowerCase()) {
  void start()
}
