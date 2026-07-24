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

/**
 * D2 evidence authority grade (product roadmap).
 * - test_case: machine-verified (code runner / CAS / objective match) — highest
 * - authored_key: teacher-authored answer key — human authority, overridable
 */
export type EvidenceSource = 'test_case' | 'authored_key'

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
  /** Required evidence authority grade (D2). Migrated rows default to test_case. */
  source: EvidenceSource
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

// ---------------------------------------------------------------------------
// Product data model (T01) — org / person / attempt aggregate roots
// ---------------------------------------------------------------------------

/** D1 dual-mode attempt: practice feeds FSRS only; assessment feeds formal mastery. */
export type SessionMode = 'practice' | 'assessment'

/** Two-layer product roles (no school admin). */
export type ProductRole = 'student' | 'teacher'

/** Natural person; accounts bind via User. */
export interface Person {
  id: string
  displayName: string
}

/** Account bound to a Person with a single role (student | teacher). */
export interface User {
  id: string
  personId: string
  role: ProductRole
  /** Login handle: student number, or teacher email / employee id. */
  loginId: string
  createdAt: string
}

/** Academic term slice (D4). */
export interface Term {
  id: string
  name: string
  startAt: string
  endAt: string
}

/** Administrative class (homeroom). */
export interface Class {
  id: string
  name: string
}

/** Subject catalog entry (knowledge-graph ownership dimension). */
export interface Subject {
  id: string
  name: string
  /** Optional bridge to existing scoring SubjectLanguage. */
  language?: SubjectLanguage
}

/**
 * Teaching unit = class × subject (D3). Carries the taught KP set for D4
 * cohort filtering (un-taught KPs must not alarm).
 */
export interface TeachingUnit {
  id: string
  teacherId: string
  classId: string
  subjectId: string
  termId: string
  taughtKpIds: string[]
}

/** Student enrollment in an administrative class for a term. */
export interface Enrollment {
  id: string
  studentId: string
  classId: string
  termId: string
}

/**
 * Attempt aggregate root (T01). Replaces bare EvaluationResult as the unit of
 * practice/assessment. D1–D4 discriminator fields are required so
 * reproducible / authoritative / model-inferred states stay distinguishable.
 */
export interface Attempt {
  id: string
  studentId: string
  questionId: string
  teachingUnitId: string
  termId: string
  mode: SessionMode
  createdAt: string
  /** Embedded evaluation payload (existing EvaluationResult shape). */
  result: EvaluationResult
}

/**
 * T09 standard solution (可选 text + latex). Attached to a Question so AI
 * tutoring can RAG the verified solution instead of self-computing (TR2
 *降幻觉). `source: 'authored'` mirrors the D2 authored_key authority grade —
 * a teacher wrote it, so it is human-authoritative and overridable.
 *
 * When absent, AI tutoring degrades to pure generation with a
 * `provenance.kind = 'llm_inference'` disclaimer badge.
 */
export interface StandardSolution {
  /** Standard solution body (rich text / markdown). */
  content: string
  /** Optional KaTeX/LaTeX rendering of the solution. */
  latex?: string
  /** Optional key solving steps / scoring points. */
  keyPoints?: string[]
  /** Teacher who authored the solution (D2 authored authority). */
  authorId: string
  /** Always 'authored' — a standard solution is human-authoritative. */
  source: 'authored'
}

/**
 * Question aggregate (T03). The structured unit produced by teacher hand-entry.
 * Ownership is teacher-private via `authorId` + `questionBankId`. `payload`
 * reuses the existing RunnerSpec shape (imported by the question-bank layer,
 * not re-declared here) so the RunnerRegistry routes by `questionType` without
 * a scoring rewrite. `source` carries the D2 evidence authority grade.
 */
export interface Question {
  id: string
  questionBankId: string
  authorId: string
  subject: SubjectLanguage
  questionType: QuestionType
  /** 题干（支持 LaTeX/KaTeX）. */
  stem: string
  /** Answer spec — the same RunnerSpec union the runners already consume. */
  payload: unknown
  /** Knowledge-point tags on the 121-node DAG. */
  kpIds: string[]
  /** 1..5 difficulty band. */
  difficulty: number
  /** D2 authority grade: authored_key (teacher key) or test_case (machine). */
  source: EvidenceSource
  createdAt: string
  termId?: string
  /** T09 optional standard solution (RAG context for AI tutoring). */
  solution?: StandardSolution
}

/** Lightweight list projection of a Question for bank browsing. */
export interface QuestionSummary {
  id: string
  questionBankId: string
  subject: SubjectLanguage
  questionType: QuestionType
  stem: string
  kpIds: string[]
  difficulty: number
  source: EvidenceSource
  /** True when a T09 standard solution is present (else marked 待补). */
  hasSolution: boolean
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

// ---------------------------------------------------------------------------
// T04 — scan import / OCR draft + human review gate (D2)
// ---------------------------------------------------------------------------

/**
 * How the raw text was extracted. MVP-0 covers electronic docs; OCR is the
 * scan/photo path (default mock / local, never auto-published).
 */
export type ImportParseMethod = 'docx' | 'pdf_text' | 'ocr' | 'raw_text'

/** Draft lifecycle. Only `confirmed` / `partially_confirmed` produce Questions. */
export type ImportDraftStatus =
  | 'pending_review'
  | 'confirmed'
  | 'partially_confirmed'

/** Per-item review state inside an ImportDraft. */
export type ImportItemStatus =
  | 'pending'
  | 'confirmed'
  | 'skipped'
  | 'low_confidence'

/**
 * One candidate question extracted from OCR/parse + LLM split.
 * Always `llm_inference`-provenanced and blocked from the scoring loop until
 * a teacher confirms it into a real Question (D2 human gate).
 */
export interface ImportDraftItem {
  index: number
  stem: string
  questionType: QuestionType
  /** Choice options when the splitter inferred a multiple-choice item. */
  options?: Array<{ id: string; text: string }>
  /** Free-text answer candidate (fill/numeric/expression) before payload build. */
  answerCandidate?: string
  /** Best-effort RunnerSpec-shaped payload; may be incomplete until confirm. */
  payloadCandidate?: unknown
  suggestedKpIds: string[]
  suggestedDifficulty?: number
  /** 0..1 model/heuristic confidence; low values surface as low_confidence. */
  confidence: number
  status: ImportItemStatus
  /**
   * Always llm_inference — OCR/LLM split is draft generation only.
   * Never enters score or mastery without the teacher confirm step.
   */
  provenance: Extract<Provenance, { kind: 'llm_inference' }>
}

/**
 * Import draft aggregate (T04). OCR/parse produces this "省打字" draft; the
 * teacher review gate is the only path into QuestionBank. Unconfirmed drafts
 * are never Questions and cannot be used for 测评态.
 */
export interface ImportDraft {
  id: string
  authorId: string
  questionBankId: string
  subject: SubjectLanguage
  status: ImportDraftStatus
  sourceFilename: string
  parseMethod: ImportParseMethod
  /** Full extracted text kept for audit / re-split. */
  rawText: string
  items: ImportDraftItem[]
  /**
   * Import-time privacy banner (T10): do not upload handwritten signatures,
   * student numbers, or other L3 PII with the paper.
   */
  privacyNotice: string
  createdAt: string
  confirmedAt?: string
  /** Question ids created after the human gate (empty until confirm). */
  confirmedQuestionIds: string[]
  /** Active OCR provider name when parseMethod is ocr. */
  ocrProvider?: string
  /**
   * T10 data classification for this payload. Import is L1 (question content);
   * L2/L3 student data must never ride this path.
   */
  egressClass: 'L1'
  /** Whether any outbound OCR/LLM call was allowed for this draft. */
  allowsEgress: boolean
}

// ---------------------------------------------------------------------------
// Adaptive loop (T06) — next-practice plan + weakness assignment
// ---------------------------------------------------------------------------

/** Why a knowledge point entered today's practice queue. */
export type PracticePrioritySource = 'fsrs_due' | 'dependency_gap'

/** One KP slot in the student's "today" queue, filled from the question bank. */
export interface NextPracticeItem {
  kpId: string
  /** FSRS due cards outrank dependency-gap interventions. */
  source: PracticePrioritySource
  reason: string
  /** FSRS due timestamp when source is fsrs_due. */
  dueAt?: string
  /** Questions selected from the teacher's bank for this KP (T03). */
  questions: QuestionSummary[]
}

/**
 * Student "today's practice" plan (T06).
 * Produced by NextPracticeService.generate — FSRS due ∪ dependency gaps,
 * intersected with TeachingUnit.taughtKpIds (D4).
 */
export interface NextPracticePlan {
  studentId: string
  teachingUnitId: string
  generatedAt: string
  /** D4 taught progress used as the filter set. */
  taughtKpIds: string[]
  items: NextPracticeItem[]
}

/** Teacher one-click weakness assignment (T06). */
export interface AssignWeaknessRequest {
  teachingUnitId: string
  /** Override auto-aggregated class weak KPs. */
  kpIds?: string[]
  /** Override whole-class enrollment. */
  studentIds?: string[]
  /** Max questions assembled from the bank. Default 10. */
  limit?: number
  /**
   * Attempt mode for placeholders. Default `practice` (巩固) so work feeds
   * FSRS only until the teacher flips a formal assessment (D1).
   */
  mode?: SessionMode
}

export interface AssignWeaknessResult {
  teachingUnitId: string
  kpIds: string[]
  studentIds: string[]
  questionIds: string[]
  attemptIds: string[]
  paperId: string
  mode: SessionMode
  createdAt: string
}

// ---------------------------------------------------------------------------
// T05 — three-layer AI tutoring (explain / socratic / dialogue)
// ---------------------------------------------------------------------------

/** Which tutoring layer produced a message. */
export type TutoringLayer = 'explain' | 'socratic' | 'dialogue'

/**
 * Advisory tutoring message (T05 / TR2).
 *
 * Structurally isolated from the scoring loop:
 *   - no `score` / `weight` / `earnedScore` / `evidence` fields
 *   - provenance is always `llm_inference` (grey "AI 推断" badge)
 *   - never folded into EvaluationResult.score
 */
export interface TutoringMessage {
  id: string
  layer: TutoringLayer
  role: 'assistant' | 'user'
  content: string
  /**
   * Always llm_inference — tutoring is model-derived coaching, never evidence.
   * Narrowed so an evidence-kind tag can never be attached.
   */
  provenance: Extract<Provenance, { kind: 'llm_inference' }>
  /** Live LLM vs deterministic template fallback. */
  source: 'local-policy' | 'llm'
  createdAt: string
  /** Shown when RAG solution is absent or source is pure generation. */
  disclaimer?: string
}

/** One prior turn for multi-turn dialogue / socratic windows. */
export interface TutoringTurn {
  role: 'assistant' | 'user'
  content: string
}

/** Shared body fields for POST /api/tutoring/* */
export interface TutoringRequestBase {
  /** Attempt aggregate id — mode is loaded server-side (D1 gate). */
  attemptId: string
  /**
   * Client-declared mode must match Attempt.mode (defense in depth).
   * Server rejects mismatches and assessment-gated layers.
   */
  mode: SessionMode
}

export interface TutoringExplainRequest extends TutoringRequestBase {
  /** Optional T09 standard solution for RAG restate (降幻觉). */
  solution?: StandardSolution
}

export interface TutoringSocraticRequest extends TutoringRequestBase {
  /** Student message (hint request / reply to prior question). */
  message: string
  /** Recent turns (server keeps last 4–6). */
  history?: TutoringTurn[]
  solution?: StandardSolution
  /**
   * Consecutive low-effort hint requests already observed client-side.
   * Server also re-derives from history; this is a fast path for UI counters.
   */
  lowEffortStreak?: number
}

export interface TutoringDialogueRequest extends TutoringRequestBase {
  message: string
  history?: TutoringTurn[]
  solution?: StandardSolution
  /** Optional one-line summary of turns beyond the rolling window. */
  priorSummary?: string
}

export interface TutoringResponse {
  message: TutoringMessage
  /** Echo of the mode gate decision for UI. */
  allowedMode: SessionMode
  layer: TutoringLayer
}
