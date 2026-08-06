import { createReadStream } from 'node:fs'
import { mkdirSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname, extname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
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
  SECURITY_WARNING_HEADER,
  SECURITY_WARNING_VALUE
} from './auth/MockSessionProvider'
import type { SessionProvider, SessionUser } from './auth/SessionProvider'
import { AuthService } from './auth/AuthService'
import { AuthStore } from './auth/AuthStore'
import { tryHandleAuthRoute } from './auth/authRoutes'
import { createSessionProvider } from './auth/createSessionProvider'
import { AuthError, authStatusCode } from './auth/errors'
import { isMultimodalEnabled } from './config/features'
import { AdvisoryService } from './advisory/AdvisoryService'
import {
  AssignByWeaknessService,
  EvidenceProjector,
  NextPracticeService,
  SqliteOrgReader,
  handleAdaptiveApi
} from './adaptive'
import {
  createAssignmentRegistry,
  type AssignmentRegistry
} from './data/assignments'
import { createCohortSnapshot } from './data/cohort'
import { createKnowledgeBase } from './data/knowledge'
import { EvaluationAgent } from './domain/EvaluationAgent'
import { createFeedbackGenerator } from './domain/feedback'
import {
  ImportDraftStore,
  ImportService,
  createOcrProvider,
  createQuestionSplitter,
  tryHandleImportRoute
} from './import'
import { QuestionBankService } from './questionbank/QuestionBankService'
import { QuestionStore } from './questionbank/QuestionStore'
import {
  createQuestionBackedRegistry,
  projectQuestionToAssignment
} from './questionbank/projectQuestionAssignment'
import { seedDemoProduct } from './questionbank/seedDemoProduct'
import {
  AssignmentService,
  SubjectiveGradingService,
  StudentImportService,
  TeacherTipService,
  TeacherTipStore,
  TeachingUnitService,
  handleTeacherApi
} from './teacher'
import {
  MistakeBookService,
  PracticeSessionService,
  handleStudentApi
} from './student'
import { createTutoringService, handleTutoringApi } from './tutoring'
import { handleQuestionBankApi } from './questionbank/questionRoutes'
import {
  FsBlobStore,
  type BlobStore
} from './media/BlobStore'
import { QuotaService } from './media/QuotaService'
import { UploadStore } from './media/UploadStore'
import { MediaProcessor } from './media/MediaProcessor'
import { createScanner } from './media/Scanner'
import { MediaWorkerLoop } from './media/MediaWorkerLoop'
import { handleMediaApi, type MediaRouteContext } from './media/mediaRoutes'
import { ReviewService } from './demonstration/ReviewService'
import { EvidencePanelService } from './demonstration/EvidencePanelService'
import { NotificationService } from './demonstration/NotificationService'
import { ReferenceService } from './demonstration/ReferenceService'
import { ReportService } from './demonstration/ReportService'
import { AppealService } from './demonstration/AppealService'
import { DemonstrationService } from './demonstration/DemonstrationService'
import { createDemoAuditSink } from './demonstration/demoAuditSink'
import { isPublicLibraryReviewer } from './demonstration/reviewerAuth'
import {
  handleReviewerApi,
  type ReviewerRouteContext
} from './demonstration/reviewerRoutes'
import { handlePlayerApi } from './demonstration/playerRoutes'
import { handleAuthorApi } from './demonstration/authorRoutes'
import { handleAiApi } from './demonstration/aiRoutes'
import { AiQuotaStore } from './demonstration/aiAssistant'
import { handleReferenceApi } from './demonstration/referenceRoutes'
import { handleLibraryApi } from './demonstration/libraryRoutes'
import { JsonAttemptStore } from './store/AttemptStore'
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
import type { EvaluationStore } from './store/EvaluationStore'

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const isProduction = process.argv.includes('--production')
const port = Number(process.env.PORT ?? 4180)
const maxRequestBodyBytes = 256 * 1024

const evaluateRequestSchema = z.object({
  assignmentId: z.string().min(1),
  code: z.string().min(1).max(20_000),
  previousEvaluationId: z.string().min(1).optional(),
  attemptId: z.string().min(1).optional()
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
  assignments: AssignmentRegistry
  store: JsonAttemptStore
  agent: EvaluationAgent
  runnerName: string
  knowledge: KnowledgeStore
  audit: AuditStore
  sessions: SessionProvider
  memory: MemoryLayer
  interventions: InterventionService
  stt: STTProvider
  /** Product database shared by question bank / auth / org (T02-T08). */
  productDb: Database.Database
  auth: AuthService
  questionBank: QuestionBankService
  /** T-K/T-L Phase E/C migration store (write-path switch). */
  questionStore: QuestionStore
  tutoring: ReturnType<typeof createTutoringService>
  importService: ImportService
  nextPractice: NextPracticeService
  assignByWeakness: AssignByWeaknessService
  org: SqliteOrgReader
  practiceSessions: PracticeSessionService
  mistakes: MistakeBookService
  teachingUnits: TeachingUnitService
  roster: StudentImportService
  assignmentService: AssignmentService
  grading: SubjectiveGradingService
  tips: TeacherTipService
  evidenceProjector: EvidenceProjector
  /** T-B media pipeline services (blob store / upload sessions / worker). */
  media: MediaRouteContext
  /** T-F reviewer / publication governance services (per-request user below). */
  demonstration: ReviewerRouteContext
}

interface EvidenceRingServerOptions {
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
  /**
   * Product database path (questions / auth / teaching units / enrollments).
   * Defaults to `.data/product.sqlite`; in-memory when an auditStore is injected
   * (test mode) so unit suites never touch disk.
   */
  productDbPath?: string
  /**
   * Media data root for the T-B blob store (uploads + CAS media dir). Tests
   * inject a temp dir; production defaults to the project data dir.
   */
  mediaDataRoot?: string
  /**
   * Product database handle to reuse (tests seed reviewer users / demo data
   * on a shared in-memory DB). When omitted the server opens its own
   * connection from productDbPath and owns its lifecycle.
   */
  productDb?: Database.Database
}

class HttpError extends Error {
  public constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message)
  }
}

export async function createEvidenceRingServer(
  options: EvidenceRingServerOptions = {}
) {
  const demoAssignments = createAssignmentRegistry()
  // T01 expand-contract: the main store is now an Attempt-aware store so the
  // product services (student / teacher / adaptive) and the legacy
  // /api/evaluations demo path share one source of truth.
  const store = new JsonAttemptStore(
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

  // ---------------------------------------------------------------------------
  // Product database (T02-T08): questions / auth / teaching units / enrollments.
  // Separate connection from audit + memory so WAL locking stays isolated.
  // In-memory when an auditStore is injected (test mode) - no disk touch.
  // Tests may inject their own connection (productDb) to seed reviewer/demo data
  // on a shared in-memory DB; the server then does not own its lifecycle.
  // ---------------------------------------------------------------------------
  const ownsProductDb = options.productDb === undefined
  let productDb: Database.Database
  if (options.productDb !== undefined) {
    productDb = options.productDb
  } else {
    const defaultProductDbPath = join(projectRoot, '.data', 'product.sqlite')
    const productDbPath =
      options.productDbPath ??
      (options.auditStore ? ':memory:' : defaultProductDbPath)
    if (productDbPath !== ':memory:') {
      mkdirSync(dirname(productDbPath), { recursive: true })
    }
    productDb = new Database(productDbPath)
    productDb.pragma('journal_mode = WAL')
  }

  const questionStore = new QuestionStore({ database: productDb })
  const questionBank = new QuestionBankService({ store: questionStore })
  const authStore = new AuthStore(productDb)
  const auth = new AuthService(authStore)
  const org = new SqliteOrgReader(productDb)
  // T-B media pipeline: blob store under the media data root, upload sessions
  // on the product db (migration 0008), worker with the configured scanner
  // (prod fail-closed without clamd; dev pass-through under MEDIA_DISABLE_SCAN).
  const mediaDataRoot = options.mediaDataRoot ?? join(projectRoot, 'data')
  const blobs: BlobStore = new FsBlobStore({ dataRoot: mediaDataRoot })
  const quotas = new QuotaService(productDb)
  const uploads = new UploadStore(productDb, quotas)
  const scanner = createScanner(process.env)
  const processor = new MediaProcessor({
    db: productDb,
    blobs,
    uploads,
    scanner
  })
  const mediaWorker = new MediaWorkerLoop(uploads, processor)
  // Start the background worker (unref'd timer — won't keep the process alive).
  mediaWorker.start()
  const media: MediaRouteContext = {
    db: productDb,
    blobs,
    uploads,
    processor,
    scanner,
    user: {
      userId: '',
      displayName: 'media',
      role: 'student' // placeholder; overwritten per-request by handleApi
    }
  }
  // T-F reviewer / publication governance services (spec §5.2/§5.3). The audit
  // hook bridges the demo.* domain events onto the existing audit HMAC chain
  // (mandatory governance actions only, spec §5.7).
  const demoAudit = createDemoAuditSink(audit)
  const demonstrationService = new DemonstrationService({ db: productDb, audit: demoAudit })
  const reviewService = new ReviewService({ db: productDb, audit: demoAudit })
  const reportService = new ReportService({ db: productDb, audit: demoAudit })
  const appealService = new AppealService({ db: productDb, audit: demoAudit })
  const evidencePanel = new EvidencePanelService({ db: productDb })
  const demoNotifications = new NotificationService({ db: productDb })
  const referenceService = new ReferenceService({ db: productDb, audit: demoAudit })
  const demonstration: ReviewerRouteContext = {
    db: productDb,
    demoService: demonstrationService,
    aiQuota: new AiQuotaStore(),
    references: referenceService,
    review: reviewService,
    evidence: evidencePanel,
    notifications: demoNotifications,
    reports: reportService,
    appeals: appealService,
    user: {
      userId: '',
      displayName: 'reviewer',
      role: 'student' // placeholder; overwritten per-request by handleApi
    }
  }
  // T03 tail + T07 demo: seed built-in bank + tu-demo unit so "今日该练"
  // and mistake repractice have real question/KP rows on cold start.
  seedDemoProduct({ questions: questionStore, org })
  // T-M Phase C (#30): legacy visualization column deleted — no migration runs.
  // ADR-0015 Phase 6: EvaluationAgent resolves private/seed question ids via
  // payload→ExecutableAssignment projection when the demo registry misses.
  const assignments = createQuestionBackedRegistry(demoAssignments, (id) =>
    questionBank.peek(id)
  )
  // Session provider: real (cookie→auth_sessions) in production, mock
  // (X-Demo-Role header) in dev/test. AUTH_MODE / DEMO_AUTH override.
  // ponytail: default shifts to real under NODE_ENV=production (authMode.ts),
  // so the X-Demo-Role backdoor is closed on `--production` servers unless
  // DEMO_AUTH is explicitly set.
  const sessions =
    options.sessionProvider ??
    createSessionProvider({ db: productDb, env: process.env })

  const tutoring = createTutoringService(store)
  const importService = new ImportService({
    store: new ImportDraftStore({ database: productDb }),
    questionBank,
    ocr: createOcrProvider(),
    splitter: createQuestionSplitter()
  })
  const nextPractice = new NextPracticeService({
    review: memory.review,
    interventions,
    org,
    questions: questionStore,
    mastery: memory.mastery
  })
  const assignByWeakness = new AssignByWeaknessService({
    org,
    mastery: memory.mastery,
    questionBank,
    attempts: store
  })
  const practiceSessions = new PracticeSessionService({ attempts: store })
  const mistakes = new MistakeBookService({
    attempts: store,
    questions: questionStore
  })
  const teachingUnits = new TeachingUnitService({ org })
  const roster = new StudentImportService({ auth, org })
  const assignmentService = new AssignmentService({
    questionBank,
    weakness: assignByWeakness,
    attempts: store,
    org
  })
  const grading = new SubjectiveGradingService({
    attempts: store,
    questions: questionStore,
    org,
    hmacSecret
  })
  // T14: in-app teacher tips (站内消息). Shares productDb; never scores.
  const tips = new TeacherTipService({
    store: new TeacherTipStore({ database: productDb }),
    org
  })
  // D1 dual-mode projector: practice feeds FSRS only; assessment also
  // recomputes formal MasteryProfile. Used by the evaluate path when an
  // attemptId is supplied (T07 product flow).
  const evidenceProjector = new EvidenceProjector({
    mastery: memory.mastery,
    review: memory.review
  })

  const context: ApiContext = {
    assignments,
    store,
    productDb,
    auth,
    questionBank,
    questionStore,
    tutoring,
    importService,
    nextPractice,
    assignByWeakness,
    org,
    practiceSessions,
    mistakes,
    teachingUnits,
    roster,
    assignmentService,
    grading,
    tips,
    evidenceProjector,
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
    stt,
    media,
    demonstration
  }
  const server = createServer((request, response) => {
    void routeRequest(request, response, context, vite)
  })
  server.once('close', () => {
    mediaWorker.stop()
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
    if (ownsProductDb) {
      try {
        productDb.close()
      } catch (error: unknown) {
        console.error('Failed to close product database:', error)
      }
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
        return
      }
      const owner = user.studentId ?? user.userId
      if (
        user.role === 'student' &&
        existing.studentId !== owner
      ) {
        respondJson(response, 403, {
          error: 'Forbidden: cannot evaluate an attempt you do not own'
        })
        return
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
        await context.evidenceProjector.projectAttempt(updatedAttempt)
      }
      const containerId = resolveContainerId(resultForAttempt, runnerName)
      audit.enqueue({
        actorRole: user.role,
        actorId: user.userId,
        action: 'evaluate',
        resourceType: 'evaluation',
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
      return
    }

    await store.save(owned)
    // Legacy demo path: assessment-default, both mastery + FSRS.
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
        piiDetected: false,
        mode: 'assessment',
        attemptId: null
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
    // Spec §2.8: a public-library reviewer principal is never granted
    // teaching / grade / audit view authority, even when their role is
    // teacher|admin (the reviewer flag is additive, not a role expansion).
    if (isPublicLibraryReviewer(context.productDb, user.userId)) {
      audit.enqueue({
        actorRole: user.role,
        actorId: user.userId,
        action: 'view',
        resourceType: 'cohort',
        result: 'denied',
        metadata: { reason: 'reviewer-isolated' }
      })
      respondJson(response, 403, {
        error: 'Forbidden: public-library reviewers may not view cohort data'
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
    // Spec §2.8: reviewers never get audit view authority (see /api/cohort).
    if (isPublicLibraryReviewer(context.productDb, user.userId)) {
      audit.enqueue({
        actorRole: user.role,
        actorId: user.userId,
        action: 'view',
        resourceType: 'audit',
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
  store: EvaluationStore,
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
  store: EvaluationStore,
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
