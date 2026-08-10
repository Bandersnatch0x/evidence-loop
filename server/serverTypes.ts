import type Database from 'better-sqlite3'
import type { AuditStore } from './audit/AuditStore'
import type { SessionProvider } from './auth/SessionProvider'
import type { AuthService } from './auth/AuthService'
import type { AssignByWeaknessService, EvidenceProjector, NextPracticeService, SqliteOrgReader } from './adaptive'
import type { AssignmentRegistry } from './data/assignments'
import type { EvaluationAgent } from './domain/EvaluationAgent'
import type { ImportService } from './import'
import type { QuestionBankService } from './questionbank/QuestionBankService'
import type { QuestionStore } from './questionbank/QuestionStore'
import type { AssignmentService, StudentImportService, SubjectiveGradingService, TeacherTipService, TeachingUnitService } from './teacher'
import type { MistakeBookService, PracticeSessionService } from './student'
import type { createTutoringService } from './tutoring'
import type { MediaRouteContext } from './media/mediaRoutes'
import type { ReviewerRouteContext } from './demonstration/reviewerRoutes'
import type { AttemptStore } from './store/AttemptStore'
import type { KnowledgeStore } from './knowledge/KnowledgeStore'
import type { InterventionService } from './mastery/InterventionService'
import type { MemoryLayer } from './memory/MemoryLayer'
import type { STTProvider } from './stt/STTProvider'
import type { RunnerRegistry } from './runner/RunnerRegistry'
import type { CodeRunner } from './runner/types'
import type { MaterialImportService } from './materialImport'
import type { MockExamService } from './mockExam'
import type { StudyPlanService } from './studyPlan'
import type { WeeklyReportService, WeeklyReportExportStore } from './reports'
import type { AchievementService } from './achievements'
import type { PersonaDialogueService } from './dialogue'
import type { FlashcardDraftService } from './flashcardDraft'
import type { PortfolioExportService, PortfolioExportStore } from './portfolio'
import type { TaskTemplateService } from './taskTemplate'

/** Runtime dependencies consumed by the HTTP router. */
export interface ApiContext {
  assignments: AssignmentRegistry
  store: AttemptStore
  agent: EvaluationAgent
  runnerName: string
  knowledge: KnowledgeStore
  audit: AuditStore
  sessions: SessionProvider
  memory: MemoryLayer
  interventions: InterventionService
  stt: STTProvider
  productDb: Database.Database
  auth: AuthService
  questionBank: QuestionBankService
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
  media: MediaRouteContext
  demonstration: ReviewerRouteContext
  // ---- Effort 2 (T15-T23) ----
  materialImport: MaterialImportService
  mockExam: MockExamService
  studyPlan: StudyPlanService
  weeklyReport: WeeklyReportService
  weeklyReportExports: WeeklyReportExportStore
  achievements: AchievementService
  dialogue: PersonaDialogueService
  flashcardDraft: FlashcardDraftService
  portfolio: PortfolioExportService
  portfolioExports: PortfolioExportStore
  taskTemplates: TaskTemplateService
}

/** Dependency overrides and storage options for server composition. */
export interface EvidenceRingServerOptions {
  /** Legacy JSON-file attempt store. When set, overrides the default SQLite store. */
  dataFile?: string
  /** Explicit attempt store. Highest precedence over dataFile / default SQLite. */
  attemptStore?: AttemptStore
  vite?: boolean
  runner?: CodeRunner
  runners?: RunnerRegistry
  knowledgeStore?: KnowledgeStore
  knowledgeSeedPath?: string
  auditStore?: AuditStore
  auditDbPath?: string
  auditHmacSecret?: string
  sessionProvider?: SessionProvider
  memoryDbPath?: string
  memoryLayer?: MemoryLayer
  sttProvider?: STTProvider
  productDbPath?: string
  mediaDataRoot?: string
  productDb?: Database.Database
}
