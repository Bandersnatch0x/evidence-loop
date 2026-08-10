/**
 * Composition root for EvidenceRing server dependencies.
 *
 * C2 deepening (#39): dependency wiring and resource ownership used to occupy
 * ~287 lines inside createEvidenceRingServer. This module builds ApiContext
 * behind one interface and owns teardown. HTTP listener and Vite middleware
 * remain in index.ts as transport concerns.
 */
import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { AuditStore, resolveAuditHmacSecret } from './audit/AuditStore'
import { AuthService } from './auth/AuthService'
import { AuthStore } from './auth/AuthStore'
import { createSessionProvider } from './auth/createSessionProvider'
import { AdvisoryService } from './advisory/AdvisoryService'
import {
  AssignByWeaknessService,
  EvidenceProjector,
  NextPracticeService,
  SqliteOrgReader
} from './adaptive'
import { createAssignmentRegistry } from './data/assignments'
import { createKnowledgeBase } from './data/knowledge'
import { EvaluationAgent } from './domain/EvaluationAgent'
import { createFeedbackGenerator } from './domain/feedback'
import {
  ImportDraftStore,
  ImportService,
  createOcrProvider,
  createQuestionSplitter
} from './import'
import { QuestionBankService } from './questionbank/QuestionBankService'
import { QuestionStore } from './questionbank/QuestionStore'
import { createQuestionBackedRegistry } from './questionbank/projectQuestionAssignment'
import { seedDemoProduct } from './questionbank/seedDemoProduct'
import {
  AssignmentService,
  StudentImportService,
  SubjectiveGradingService,
  TeacherTipService,
  TeacherTipStore,
  TeachingUnitService
} from './teacher'
import { MistakeBookService, PracticeSessionService } from './student'
import { createTutoringService } from './tutoring'
import { MemoryLayer } from './memory/MemoryLayer'
import { createConfiguredRunner } from './runner/configuredRunner'
import { createRunnerRegistry } from './runner/RunnerRegistry'
import { JsonKnowledgeStore } from './knowledge/KnowledgeStore'
import { InterventionService } from './mastery/InterventionService'
import { createSTTProvider } from './stt/createSTTProvider'
import { JsonAttemptStore } from './store/AttemptStore'
import { FsBlobStore, type BlobStore } from './media/BlobStore'
import { QuotaService } from './media/QuotaService'
import { UploadStore } from './media/UploadStore'
import { createScanner } from './media/Scanner'
import { MediaProcessor } from './media/MediaProcessor'
import { MediaWorkerLoop } from './media/MediaWorkerLoop'
import type { MediaRouteContext } from './media/mediaRoutes'
import { DemonstrationService } from './demonstration/DemonstrationService'
import { ReviewService } from './demonstration/ReviewService'
import { ReportService } from './demonstration/ReportService'
import { AppealService } from './demonstration/AppealService'
import { EvidencePanelService } from './demonstration/EvidencePanelService'
import { NotificationService } from './demonstration/NotificationService'
import { ReferenceService } from './demonstration/ReferenceService'
import { AiQuotaStore } from './demonstration/aiAssistant'
import { createDemoAuditSink } from './demonstration/demoAuditSink'
import { seedPresetDemonstrations } from './demonstration/seedPresets'
import type { ReviewerRouteContext } from './demonstration/reviewerRoutes'
import { MaterialImportService, MaterialImportStore } from './materialImport'
import { createDraftQuestionGenerator } from './materialImport'
import { MockExamPlanStore, MockExamService } from './mockExam'
import { StudyPlanService, StudyPlanSnapshotStore } from './studyPlan'
import { WeeklyReportService, WeeklyReportExportStore } from './reports'
import { AchievementService, AchievementStore } from './achievements'
import { createPersonaDialogueService } from './dialogue'
import {
  createFlashcardDraftGenerator,
  FlashcardDraftService,
  FlashcardDraftStore
} from './flashcardDraft'
import { PortfolioExportService, PortfolioExportStore } from './portfolio'
import type { ApiContext, EvidenceRingServerOptions } from './serverTypes'

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

export interface ComposedServerContext {
  context: ApiContext
  /** Idempotent owner cleanup for all resources composed here. */
  dispose(): Promise<void>
}

export async function createServerContext(
  options: EvidenceRingServerOptions = {}
): Promise<ComposedServerContext> {
  const demoAssignments = createAssignmentRegistry()
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
  const audit =
    options.auditStore ??
    new AuditStore({
      dbPath: options.auditDbPath ?? defaultAuditDbPath,
      hmacSecret
    })
  const memory =
    options.memoryLayer ??
    new MemoryLayer({
      dbPath:
        options.memoryDbPath ??
        options.auditDbPath ??
        (options.auditStore ? ':memory:' : defaultAuditDbPath),
      hmacSecret,
      evaluationStore: store
    })

  const ownsProductDb = options.productDb === undefined
  let productDb: Database.Database | undefined
  let mediaWorker: MediaWorkerLoop | undefined
  let disposed = false
  const dispose = async (): Promise<void> => {
    if (disposed) return
    disposed = true
    mediaWorker?.stop()
    await runners.dispose().catch((error: unknown) => {
      console.error('Failed to dispose runner registry:', error)
    })
    await audit.close().catch((error: unknown) => {
      console.error('Failed to close audit store:', error)
    })
    try {
      memory.close()
    } catch (error: unknown) {
      console.error('Failed to close memory layer:', error)
    }
    if (ownsProductDb && productDb !== undefined) {
      try {
        productDb.close()
      } catch (error: unknown) {
        console.error('Failed to close product database:', error)
      }
    }
  }

  try {
    await runners.warm()
    await knowledge.getGraph()

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
  const auth = new AuthService(new AuthStore(productDb))
  const org = new SqliteOrgReader(productDb)

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
    mediaWorker = new MediaWorkerLoop(uploads, processor)
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
      role: 'student'
    }
  }

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
      role: 'student'
    }
  }

  seedDemoProduct({ questions: questionStore, org })
  try {
    seedPresetDemonstrations(productDb)
  } catch (error) {
    console.error('Seed preset demonstrations failed:', error)
  }

  const assignments = createQuestionBackedRegistry(demoAssignments, (id) =>
    questionBank.peek(id)
  )
  const sessions =
    options.sessionProvider ??
    createSessionProvider({ db: productDb, env: process.env })
  const interventions = new InterventionService({
    knowledge,
    mastery: memory.mastery
  })
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
  const tips = new TeacherTipService({
    store: new TeacherTipStore({ database: productDb }),
    org
  })
  const evidenceProjector = new EvidenceProjector({
    mastery: memory.mastery,
    review: memory.review
  })

  // ---------------------------------------------------------------------------
  // Effort 2 vertical slices (T15-T23). All services are advisory-only:
  // they consume deterministic Runner evidence through read-only ports and
  // never write score / evidence / MasteryProfile (ADR-0001).
  // ---------------------------------------------------------------------------
  const materialImport = new MaterialImportService({
    store: new MaterialImportStore({ database: productDb }),
    questionBank,
    generator: createDraftQuestionGenerator(process.env),
    now: () => new Date()
  })
  const mockExam = new MockExamService({
    org,
    questions: questionStore,
    mastery: memory.mastery,
    plans: new MockExamPlanStore({ database: productDb }),
    attempts: store,
    assign: assignmentService,
    excludeRecentDays: 0
  })
  const studyPlan = new StudyPlanService({
    review: memory.review,
    mastery: memory.mastery,
    org,
    questions: questionStore,
    interventions,
    snapshots: new StudyPlanSnapshotStore({ database: productDb })
  })
  const weeklyReport = new WeeklyReportService({
    attempts: store,
    mastery: memory.mastery,
    mistakes,
    tips,
    org,
    plan: studyPlan
  })
  const weeklyReportExports = new WeeklyReportExportStore({
    database: productDb
  })
  const achievements = new AchievementService({
    attempts: store,
    questions: questionStore,
    mistakes,
    studyPlan,
    awards: new AchievementStore({ database: productDb }),
    org
  })
  const dialogue = createPersonaDialogueService({ database: productDb })
  const flashcardDraft = new FlashcardDraftService({
    store: new FlashcardDraftStore({ database: productDb }),
    questionBank,
    generator: createFlashcardDraftGenerator(process.env),
    now: () => new Date()
  })
  const portfolio = new PortfolioExportService({
    attempts: store,
    questions: questionStore,
    org,
    aliases: {
      getDisplayName: (studentId: string) =>
        auth.getPublicUser(studentId)?.displayName
    }
  })
  const portfolioExports = new PortfolioExportStore({ database: productDb })

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
      advisory: new AdvisoryService()
    }),
    runnerName: runners.displayName(),
    knowledge,
    audit,
    sessions,
    memory,
    interventions,
    stt: options.sttProvider ?? createSTTProvider(),
    media,
    demonstration,
    materialImport,
    mockExam,
    studyPlan,
    weeklyReport,
    weeklyReportExports,
    achievements,
    dialogue,
    flashcardDraft,
    portfolio,
    portfolioExports
  }

    return { context, dispose }
  } catch (error) {
    await dispose()
    throw error
  }
}
