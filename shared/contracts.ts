export type EvaluationStatus = 'completed' | 'rejected' | 'failed'

/**
 * Evidence atom kinds (ADR-0004 / ADR-0008).
 * Objective question types may produce cas_check / answer_match / etc.;
 * code remains test | static. structural_metric covers essay objective dims.
 */
export type EvidenceKind =
  | 'test'
  | 'static'
  | 'cas_check'
  | 'answer_match'
  | 'lint_result'
  | 'structural_metric'

export type EvidenceVisibility = 'public' | 'hidden'

export type ResultState = 'passed' | 'failed' | 'blocked'

/**
 * Subject / knowledge-graph ownership dimension (ADR-0008).
 * Does not determine scoring logic — QuestionType does.
 */
export type SubjectLanguage =
  | 'python'
  | 'math'
  | 'physics'
  | 'chemistry'
  | 'chinese'
  | 'english'
  | 'biology'
  | 'politics'
  | 'history'
  | 'geography'

/**
 * Scoring is split by question type, not by subject (ADR-0008).
 * Each type maps to a validator/runner; subjects share validators.
 */
export type QuestionType =
  | 'choice'
  | 'fill_blank'
  | 'numeric'
  | 'expression'
  | 'chem_equation'
  | 'code'
  | 'essay'

export interface RubricDimension {
  id: string
  label: string
  description: string
  maxScore: number
}

export interface DemoVariant {
  id: string
  label: string
  description: string
  code: string
}

export interface AssignmentSummary {
  id: string
  title: string
  module: string
  language: SubjectLanguage
  questionType: QuestionType
  estimatedMinutes: number
  status: 'ready' | 'coming-soon'
}

export interface Assignment extends AssignmentSummary {
  objective: string
  scenario: string
  requirements: string[]
  constraints: string[]
  functionSignature: string
  rubric: RubricDimension[]
  demoVariants: DemoVariant[]
}

export interface EvidenceItem {
  id: string
  kind: EvidenceKind
  label: string
  dimensionId: string
  visibility: EvidenceVisibility
  state: ResultState
  weight: number
  expected?: string
  actual?: string
  message: string
  conceptId?: string
}

export interface DimensionResult extends RubricDimension {
  earnedScore: number
  state: ResultState
  evidenceIds: string[]
}

export interface Diagnosis {
  conceptId: string
  title: string
  explanation: string
  severity: 'high' | 'medium' | 'low'
  evidenceIds: string[]
}

export interface Intervention {
  conceptId: string
  title: string
  rationale: string
  instruction: string
  successCriteria: string[]
  hints: string[]
}

export interface TraceStep {
  id: string
  label: string
  tool: string
  status: 'completed' | 'skipped' | 'failed'
  summary: string
  durationMs: number
}

export interface MasterySignal {
  conceptId: string
  label: string
  level: 'needs-work' | 'developing' | 'demonstrated'
  evidenceCount: number
}

/**
 * Provenance of a learner fact (ADR-0006). Required — never optional.
 * Evidence-backed facts must carry evidenceIds + algorithm for reproducibility.
 */
export type Provenance =
  | { kind: 'evidence'; evidenceIds: string[]; algorithm: string }
  | {
      kind: 'llm_inference'
      sourceMessages: string[]
      model: string
      extractedAt: string
      confidence?: number
    }
  | { kind: 'learner_self_report'; sessionId: string }
  | { kind: 'teacher_annotation'; teacherId: string; note: string }

export const DEFAULT_EVIDENCE_PROVENANCE: Provenance = {
  kind: 'evidence',
  evidenceIds: [],
  algorithm: 'simple.v1'
}

export interface EvaluationResult {
  id: string
  assignmentId: string
  attempt: number
  createdAt: string
  status: EvaluationStatus
  score: number
  previousScore?: number
  scoreDelta?: number
  summary: string
  evidence: EvidenceItem[]
  dimensions: DimensionResult[]
  diagnoses: Diagnosis[]
  intervention?: Intervention
  /**
   * Essay / subjective coaching only (ADR-0008). Never enters the score;
   * each item is llm_inference-provenanced and teacher-gated.
   */
  advisory?: AdvisorySuggestion[]
  trace: TraceStep[]
  mastery: MasterySignal[]
  feedbackSource: 'local-policy' | 'llm'
  rejectionReason?: string
  /** Demo ownership stamp from the mock session (not real auth). */
  studentId?: string
  /** Required provenance tag (ADR-0006). Migrated rows default to evidence. */
  provenance: Provenance
}

/** Weighted evidence atom consumed by MasteryProfile pure functions. */
export interface MasteryEvidence {
  id: string
  score: number
  weight: number
  kpId: string
  createdAt: string
}

export interface MasterySnapshot {
  score: number
  evidenceIds: string[]
  computedAt: string
  algorithmVersion: string
}

export type MasteryProfileMap = Record<string, MasterySnapshot>

/**
 * Next-intervention suggestion (ADR-0007 §4 dependency-chain diagnosis).
 *
 * Given a knowledge point the learner is stuck on (`weakKp`), the service
 * walks the prerequisite chain and points at the earliest unmastered
 * prerequisite (`targetKp`). `chain` is the topological prerequisite path
 * that was inspected, most foundational first.
 */
export interface InterventionSuggestion {
  studentId: string
  weakKp: string
  targetKp: string
  chain: string[]
}

export interface MasteryTimelineEntry {
  id: number
  studentId: string
  kpId: string
  score: number
  evidenceIds: string[]
  computedAt: string
  algorithmVersion: string
}

/**
 * FSRS-derived scheduling parameters. Named SchedulingState (not MasteryLevel)
 * so it cannot be confused with MasteryProfile.masteryLevel (ADR-0007).
 */
export interface SchedulingState {
  stability: number
  difficulty: number
  dueAt: string
  state: 'new' | 'learning' | 'review' | 'relearning'
  reps: number
  lapses: number
  lastReviewAt?: string
}

export interface ReviewCard {
  id: string
  studentId: string
  kpId: string
  scheduling: SchedulingState
}

export interface EvaluateRequest {
  assignmentId: string
  code: string
  previousEvaluationId?: string
}

export interface EvaluationHistoryItem {
  id: string
  assignmentId: string
  attempt: number
  createdAt: string
  score: number
  scoreDelta?: number
  status: EvaluationStatus
  studentId?: string
}

/** Demo role used by the mock multi-tenant access control layer. */
export type DemoRole = 'student' | 'teacher' | 'admin'

export interface AuditLogItem {
  id: string
  sequence: number
  timestamp: string
  actorRole: string
  actorId: string | null
  action: string
  resourceType: string
  resourceId: string | null
  studentId: string | null
  containerId: string | null
  result: string | null
  /** Interaction modality when present (ADR-0005 §7). */
  modality?: 'text' | 'voice' | null
  metadata?: Record<string, string | number | boolean | null> | null
}

export interface CohortLearner {
  id: string
  displayName: string
  assignmentTitle: string
  attempts: number
  latestScore: number
  delta: number
  focusConcept: string
  state: 'on-track' | 'needs-attention' | 'not-started'
  lastActiveAt: string
}

export interface CohortSnapshot {
  cohortName: string
  generatedAt: string
  completionRate: number
  medianScore: number
  needsAttention: number
  learners: CohortLearner[]
}

export interface ApiError {
  error: string
  details?: string[]
}

export interface KnowledgePoint {
  id: string
  name: string
  parentId?: string
  weight: number
}

export interface KpPrerequisite {
  kpId: string
  prereqId: string
  strength: number
}

export interface KnowledgeGraph {
  points: KnowledgePoint[]
  edges: KpPrerequisite[]
}

/**
 * Subjective advisory suggestion (ADR-0008 §2).
 *
 * Produced by the AdvisoryLayer for essay / subjective dimensions that have
 * **no reproducible evidence** (立意、洞察、论证质量、语言表达). These are
 * deliberately NOT scores: the type carries no numeric `score`/`weight`/`earned`
 * field, so it can never be folded into a Rubric total. Every suggestion is
 * `llm_inference`-provenanced, requires teacher confirmation before it can
 * influence any Cohort metric, and honours ADR-0001's evidence-first rule by
 * staying out of the automatic score entirely.
 */
export interface AdvisorySuggestion {
  id: string
  /** The subjective dimension this advice targets (e.g. 立意 / 论证质量). */
  dimensionLabel: string
  /** Human-readable coaching note. This is advice, never a grade. */
  suggestion: string
  /**
   * Always `llm_inference` — subjective advice is model-derived, never
   * evidence-backed. Narrowed from Provenance so an evidence-kind tag can
   * never be attached to advisory output.
   */
  provenance: Extract<Provenance, { kind: 'llm_inference' }>
  /**
   * Hard teacher gate. Literal `true` so the compiler forbids constructing an
   * auto-applied advisory — nothing here enters scoring without a human.
   */
  requiresTeacherConfirmation: true
}
