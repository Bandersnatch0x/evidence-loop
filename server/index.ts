import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import type { ViteDevServer } from 'vite'
import type {
  ApiError,
  EvaluationHistoryItem,
  EvaluationResult,
  InterventionSuggestion
} from '../shared/contracts'
import {
  AuditStore,
  resolveAuditHmacSecret
} from './audit/AuditStore'
import {
  MockSessionProvider,
  SECURITY_WARNING_HEADER,
  SECURITY_WARNING_VALUE
} from './auth/MockSessionProvider'
import type { SessionProvider, SessionUser } from './auth/SessionProvider'
import { isMultimodalEnabled } from './config/features'
import { AdvisoryService } from './advisory/AdvisoryService'
import { createAssignmentRegistry } from './data/assignments'
import { createCohortSnapshot } from './data/cohort'
import { createKnowledgeBase } from './data/knowledge'
import { EvaluationAgent } from './domain/EvaluationAgent'
import { createFeedbackGenerator } from './domain/feedback'
import {
  JsonKnowledgeStore,
  type KnowledgeStore
} from './knowledge/KnowledgeStore'
import { InterventionService } from './mastery/InterventionService'
import { MemoryLayer } from './memory/MemoryLayer'
import { respondMultimodalAsk } from './multimodal/askRoute'
import {
  respondSTTFinalize,
  respondSTTStart
} from './multimodal/sttRoute'
import { detectEvaluationPII, findPIIInText, PIIError } from './pii/PIIDetector'
import type { ReviewRating } from './review/ReviewScheduler'
import { createSTTProvider } from './stt/createSTTProvider'
import type { STTProvider } from './stt/STTProvider'
import {
  DockerPythonRunner,
  type DockerPythonRunnerOptions
} from './runner/DockerPythonRunner'
import { PythonSubprocessRunner } from './runner/PythonSubprocessRunner'
import {
  createRunnerRegistry,
  type RunnerRegistry
} from './runner/RunnerRegistry'
import type { CodeRunner } from './runner/types'
import { JsonEvaluationStore } from './store/EvaluationStore'

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const isProduction = process.argv.includes('--production')
const port = Number(process.env.PORT ?? 4173)
const maxRequestBodyBytes = 256 * 1024

const evaluateRequestSchema = z.object({
  assignmentId: z.string().min(1),
  code: z.string().min(1).max(20_000),
  previousEvaluationId: z.string().min(1).optional()
})

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

interface ApiContext {
  assignments: ReturnType<typeof createAssignmentRegistry>
  store: JsonEvaluationStore
  agent: EvaluationAgent
  runnerName: string
  knowledge: KnowledgeStore
  audit: AuditStore
  sessions: SessionProvider
  memory: MemoryLayer
  interventions: InterventionService
  stt: STTProvider
}

interface EvidenceLoopServerOptions {
  dataFile?: string
  vite?: boolean
  /**
   * Code-question runner. Wrapped into a RunnerRegistry when `runners` is omitted.
   * Tests may inject a stub CodeRunner; production uses createConfiguredRunner().
   */
  runner?: CodeRunner
  /** Full multi-type registry. When set, takes precedence over `runner`. */
  runners?: RunnerRegistry
  knowledgeStore?: KnowledgeStore
  knowledgeSeedPath?: string
  auditStore?: AuditStore
  auditDbPath?: string
  auditHmacSecret?: string
  sessionProvider?: SessionProvider
  /** Shared memory-layer path; defaults to the audit DB path (ADR-0007). */
  memoryDbPath?: string
  memoryLayer?: MemoryLayer
  sttProvider?: STTProvider
}

class HttpError extends Error {
  public constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message)
  }
}

export async function createEvidenceLoopServer(
  options: EvidenceLoopServerOptions = {}
) {
  const assignments = createAssignmentRegistry()
  const store = new JsonEvaluationStore(
    options.dataFile ?? join(projectRoot, '.data', 'evaluations.json')
  )
  const runners =
    options.runners ??
    createRunnerRegistry(options.runner ?? createConfiguredRunner())
  const knowledge =
    options.knowledgeStore ??
    new JsonKnowledgeStore({ seedPath: options.knowledgeSeedPath })
  const defaultAuditDbPath = join(projectRoot, '.data', 'audit.sqlite')
  const hmacSecret = options.auditHmacSecret ?? resolveAuditHmacSecret()
  const auditDbPath = options.auditDbPath ?? defaultAuditDbPath
  const audit =
    options.auditStore ??
    new AuditStore({
      dbPath: auditDbPath,
      hmacSecret
    })
  const sessions = options.sessionProvider ?? new MockSessionProvider()
  // Mastery + review share the audit SQLite file (same DB, different tables).
  // When tests inject an in-memory AuditStore without a path, keep memory
  // in-memory too so unit suites never touch disk.
  const memoryDbPath =
    options.memoryDbPath ??
    options.auditDbPath ??
    (options.auditStore ? ':memory:' : defaultAuditDbPath)
  const memory =
    options.memoryLayer ??
    new MemoryLayer({
      dbPath: memoryDbPath,
      hmacSecret,
      evaluationStore: store
    })

  let vite: ViteDevServer | undefined
  try {
    await runners.warm()
    // Warm the knowledge cache so misconfigured seeds fail fast at startup
    // rather than on the first API hit.
    await knowledge.getGraph()
    vite = options.vite ? await createViteMiddleware() : undefined
  } catch (error) {
    await runners.dispose()
    await audit.close().catch(() => undefined)
    memory.close()
    throw error
  }

  const stt = options.sttProvider ?? createSTTProvider()
  const interventions = new InterventionService({
    knowledge,
    mastery: memory.mastery
  })

  const context: ApiContext = {
    assignments,
    store,
    agent: new EvaluationAgent({
      assignments,
      knowledge: createKnowledgeBase(),
      runners,
      feedback: createFeedbackGenerator(),
      // Essay subjective coaching only — never folds into score (ADR-0008).
      advisory: new AdvisoryService()
    }),
    runnerName: runners.displayName(),
    knowledge,
    audit,
    sessions,
    memory,
    interventions,
    stt
  }
  const server = createServer((request, response) => {
    void routeRequest(request, response, context, vite)
  })
  server.once('close', () => {
    void runners.dispose().catch((error: unknown) => {
      console.error('Failed to dispose runner registry:', error)
    })
    void audit.close().catch((error: unknown) => {
      console.error('Failed to close audit store:', error)
    })
    try {
      memory.close()
    } catch (error: unknown) {
      console.error('Failed to close memory layer:', error)
    }
  })

  return server
}

export function createConfiguredRunner(
  environment: NodeJS.ProcessEnv = process.env
): CodeRunner {
  const mode = (environment.PYTHON_RUNNER ?? 'subprocess').trim().toLowerCase()

  if (mode === 'subprocess') {
    return new PythonSubprocessRunner({
      pythonBin: environment.PYTHON_BIN,
      timeoutMs: optionalPositiveInteger(environment.PYTHON_RUNNER_TIMEOUT_MS)
    })
  }

  if (mode === 'docker') {
    const options: DockerPythonRunnerOptions = {
      dockerBin: environment.DOCKER_BIN,
      image: environment.DOCKER_RUNNER_IMAGE,
      poolSize: optionalPositiveInteger(environment.DOCKER_RUNNER_POOL_SIZE),
      timeoutMs: optionalPositiveInteger(environment.DOCKER_RUNNER_TIMEOUT_MS),
      startupTimeoutMs: optionalPositiveInteger(
        environment.DOCKER_RUNNER_STARTUP_TIMEOUT_MS
      ),
      memory: environment.DOCKER_RUNNER_MEMORY,
      memorySwap: environment.DOCKER_RUNNER_MEMORY_SWAP,
      cpus: environment.DOCKER_RUNNER_CPUS,
      tmpfs: environment.DOCKER_RUNNER_TMPFS,
      user: environment.DOCKER_RUNNER_USER,
      pidsLimit: optionalPositiveInteger(environment.DOCKER_RUNNER_PIDS_LIMIT)
    }
    return new DockerPythonRunner(options)
  }

  throw new Error(
    `Unsupported PYTHON_RUNNER value "${mode}". Use "subprocess" or "docker".`
  )
}

async function start(): Promise<void> {
  const server = await createEvidenceLoopServer({ vite: !isProduction })

  server.listen(port, '0.0.0.0', () => {
    console.log(`EvidenceLoop running at http://localhost:${String(port)}`)
  })
}

async function createViteMiddleware(): Promise<ViteDevServer> {
  const { createServer: createViteServer } = await import('vite')
  return createViteServer({
    root: projectRoot,
    server: { middlewareMode: true },
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
  const user = sessions.resolve(request)

  if (request.method === 'GET' && requestUrl.pathname === '/api/health') {
    respondJson(response, 200, {
      status: 'ok',
      runner: runnerName,
      feedback: process.env.LLM_API_KEY ? 'llm-with-fallback' : 'local-policy'
    })
    return
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/assignments') {
    respondJson(response, 200, assignments.list())
    return
  }

  const assignmentMatch = requestUrl.pathname.match(/^\/api\/assignments\/([^/]+)$/)
  if (request.method === 'GET' && assignmentMatch?.[1]) {
    const assignment = assignments.get(decodeURIComponent(assignmentMatch[1]))
    if (!assignment) {
      respondJson(response, 404, { error: 'Assignment not found' })
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
      demoVariants: assignment.demoVariants
    }
    respondJson(response, 200, publicAssignment)
    return
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/evaluations') {
    const assignmentId =
      requestUrl.searchParams.get('assignmentId') ?? undefined
    const history = await listEvaluationsForUser(store, user, assignmentId)
    audit.enqueue({
      actorRole: user.role,
      actorId: user.userId,
      action: 'view',
      resourceType: 'evaluation',
      studentId: user.studentId,
      result: 'success',
      metadata: {
        count: history.length,
        assignmentId: assignmentId ?? null
      }
    })
    respondJson(response, 200, history)
    return
  }

  if (request.method === 'POST' && requestUrl.pathname === '/api/evaluations') {
    const parsed = evaluateRequestSchema.safeParse(await readJsonBody(request))
    if (!parsed.success) {
      respondJson(response, 400, {
        error: 'Invalid evaluation request',
        details: parsed.error.issues.map((issue) => issue.message)
      } satisfies ApiError)
      return
    }

    const previous = await resolvePreviousEvaluation(
      store,
      user,
      parsed.data.assignmentId,
      parsed.data.previousEvaluationId
    )
    const evaluation = await agent.evaluate(parsed.data, previous)
    const owned: EvaluationResult = {
      ...evaluation,
      studentId: user.studentId ?? user.userId,
      provenance: evaluation.provenance ?? {
        kind: 'evidence',
        evidenceIds: evaluation.evidence.map((item) => item.id),
        algorithm: 'simple.v1'
      }
    }

    // ADR-0003 §3: scan free-form fields before persistence; reject on hit.
    try {
      detectEvaluationPII(owned)
    } catch (error) {
      if (error instanceof PIIError) {
        audit.enqueue({
          actorRole: user.role,
          actorId: user.userId,
          action: 'evaluate',
          resourceType: 'evaluation',
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

    await store.save(owned)

    // Triggered mastery recompute + FSRS review update (issues 012 / 014).
    if (owned.status === 'completed') {
      await memory.mastery.recomputeFromEvaluation(owned)
      memory.review.applyFromEvaluation(owned)
    }

    const containerId = resolveContainerId(owned, runnerName)
    audit.enqueue({
      actorRole: user.role,
      actorId: user.userId,
      action: 'evaluate',
      resourceType: 'evaluation',
      resourceId: owned.id,
      studentId: owned.studentId,
      containerId,
      result: owned.status === 'completed' ? 'success' : owned.status,
      metadata: {
        assignmentId: owned.assignmentId,
        score: owned.score,
        attempt: owned.attempt,
        piiDetected: false
      }
    })

    respondJson(response, 201, owned)
    return
  }

  // Right to erasure (GDPR-style): delete a single evaluation record.
  // Students may erase only their own; teachers/admins may erase any.
  const evaluationDeleteMatch = requestUrl.pathname.match(
    /^\/api\/evaluations\/([^/]+)$/
  )
  if (request.method === 'DELETE' && evaluationDeleteMatch?.[1]) {
    const evaluationId = decodeURIComponent(evaluationDeleteMatch[1])
    const existing = await store.get(evaluationId)

    if (!existing) {
      respondJson(response, 404, { error: 'Evaluation not found' })
      return
    }

    const isOwner =
      existing.studentId === (user.studentId ?? user.userId)
    const isPrivileged = user.role === 'teacher' || user.role === 'admin'
    if (!isOwner && !isPrivileged) {
      audit.enqueue({
        actorRole: user.role,
        actorId: user.userId,
        action: 'delete',
        resourceType: 'evaluation',
        resourceId: evaluationId,
        studentId: existing.studentId,
        result: 'denied'
      })
      respondJson(response, 403, {
        error: 'Forbidden: cannot erase an evaluation you do not own'
      })
      return
    }

    const deleted = await store.delete(evaluationId)
    audit.enqueue({
      actorRole: user.role,
      actorId: user.userId,
      action: 'delete',
      resourceType: 'evaluation',
      resourceId: evaluationId,
      studentId: existing.studentId,
      result: deleted ? 'success' : 'not_found'
    })
    respondJson(response, deleted ? 200 : 404, { id: evaluationId, deleted })
    return
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/cohort') {
    if (user.role !== 'teacher' && user.role !== 'admin') {
      audit.enqueue({
        actorRole: user.role,
        actorId: user.userId,
        action: 'view',
        resourceType: 'cohort',
        result: 'denied'
      })
      respondJson(response, 403, {
        error: 'Forbidden: cohort view requires teacher or admin role'
      })
      return
    }

    audit.enqueue({
      actorRole: user.role,
      actorId: user.userId,
      action: 'view',
      resourceType: 'cohort',
      result: 'success'
    })
    respondJson(response, 200, createCohortSnapshot(await store.list()))
    return
  }

  if (
    request.method === 'GET'
    && requestUrl.pathname === '/api/cohort/multimodal-usage'
  ) {
    if (user.role !== 'teacher' && user.role !== 'admin') {
      audit.enqueue({
        actorRole: user.role,
        actorId: user.userId,
        action: 'view',
        resourceType: 'cohort',
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
    audit.enqueue({
      actorRole: user.role,
      actorId: user.userId,
      action: 'view',
      resourceType: 'cohort',
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
      audit.enqueue({
        actorRole: user.role,
        actorId: user.userId,
        action: 'view',
        resourceType: 'audit',
        result: 'denied'
      })
      respondJson(response, 403, {
        error: 'Forbidden: audit log requires teacher or admin role'
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

    audit.enqueue({
      actorRole: user.role,
      actorId: user.userId,
      action: 'view',
      resourceType: 'audit',
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
      audit.enqueue({
        actorRole: user.role,
        actorId: user.userId,
        action: 'view',
        resourceType: 'system',
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
      audit.enqueue({
        actorRole: user.role,
        actorId: user.userId,
        action: 'view',
        resourceType: 'knowledge',
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
      audit.enqueue({
        actorRole: user.role,
        actorId: user.userId,
        action: 'view',
        resourceType: 'knowledge',
        studentId,
        result: 'success',
        metadata: { resource: 'mastery-timeline', kpId, count: timeline.length }
      })
      respondJson(response, 200, timeline)
      return
    }

    const profile = memory.mastery.getProfile(studentId)
    audit.enqueue({
      actorRole: user.role,
      actorId: user.userId,
      action: 'view',
      resourceType: 'knowledge',
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
      audit.enqueue({
        actorRole: user.role,
        actorId: user.userId,
        action: 'view',
        resourceType: 'knowledge',
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
      audit.enqueue({
        actorRole: user.role,
        actorId: user.userId,
        action: 'view',
        resourceType: 'knowledge',
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

    audit.enqueue({
      actorRole: user.role,
      actorId: user.userId,
      action: 'view',
      resourceType: 'knowledge',
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
      audit.enqueue({
        actorRole: user.role,
        actorId: user.userId,
        action: 'view',
        resourceType: 'knowledge',
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
    audit.enqueue({
      actorRole: user.role,
      actorId: user.userId,
      action: 'view',
      resourceType: 'knowledge',
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
      audit.enqueue({
        actorRole: user.role,
        actorId: user.userId,
        action: 'evaluate',
        resourceType: 'knowledge',
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

    audit.enqueue({
      actorRole: user.role,
      actorId: user.userId,
      action: 'evaluate',
      resourceType: 'knowledge',
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

  respondJson(response, 404, { error: 'API route not found' })
}

function canAccessStudent(user: SessionUser, studentId: string): boolean {
  if (user.role === 'teacher' || user.role === 'admin') return true
  const owner = user.studentId ?? user.userId
  return owner === studentId
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

async function listEvaluationsForUser(
  store: JsonEvaluationStore,
  user: SessionUser,
  assignmentId?: string
): Promise<EvaluationHistoryItem[]> {
  if (user.role === 'admin' || user.role === 'teacher') {
    return store.list({ assignmentId })
  }

  const studentId = user.studentId ?? user.userId
  return store.list({ assignmentId, studentId })
}

async function resolvePreviousEvaluation(
  store: JsonEvaluationStore,
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
    const history = await store.list({
      assignmentId,
      studentId: user.studentId ?? user.userId
    })
    const latestId = history[0]?.id
    return latestId ? store.get(latestId) : undefined
  }

  return store.latest(assignmentId)
}

function resolveContainerId(
  evaluation: EvaluationResult,
  runnerName: string
): string {
  // Prefer an explicit container id from the runner when present; fall back to
  // the runner name so subprocess demos still produce a stable audit field.
  const fromTrace = evaluation.trace.find((step) => step.tool === 'python.safe-runner')
  if (fromTrace?.summary.includes('container:')) {
    const match = /container:([^\s]+)/u.exec(fromTrace.summary)
    if (match?.[1]) return match[1]
  }
  return runnerName
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Uint8Array[] = []
  let size = 0
  const declaredSize = Number(request.headers['content-length'] ?? 0)

  if (Number.isFinite(declaredSize) && declaredSize > maxRequestBodyBytes) {
    throw new HttpError(413, 'Request body is too large')
  }

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maxRequestBodyBytes) {
      throw new HttpError(413, 'Request body is too large')
    }
    chunks.push(buffer)
  }

  const body = Buffer.concat(chunks).toString('utf8')
  if (body.length === 0) return {}

  try {
    return JSON.parse(body) as unknown
  } catch {
    throw new HttpError(400, 'Malformed JSON request body')
  }
}

function respondJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown
): void {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    [SECURITY_WARNING_HEADER]: SECURITY_WARNING_VALUE
  })
  response.end(JSON.stringify(payload))
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

function optionalPositiveInteger(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received "${value}".`)
  }
  return parsed
}

const entryPath = process.argv[1] ? normalize(resolve(process.argv[1])) : ''
const modulePath = normalize(fileURLToPath(import.meta.url))
if (entryPath.toLowerCase() === modulePath.toLowerCase()) {
  void start()
}
