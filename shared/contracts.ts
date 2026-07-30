export type EvaluationStatus = 'completed' | 'rejected' | 'failed'

/**
 * Evidence atom kinds (ADR-0004 / ADR-0008 / ADR-0010).
 * Objective question types may produce cas_check / answer_match / etc.;
 * code remains test | static. structural_metric covers essay objective dims.
 * render_artifact is a weight=0 audit-only snapshot of visualization params
 * (ADR-0010) — makes a rendered scene reproducible without contributing score.
 */
export type EvidenceKind =
  | 'test'
  | 'static'
  | 'cas_check'
  | 'answer_match'
  | 'lint_result'
  | 'structural_metric'
  | 'render_artifact'

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
  | 'geometry'

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
  /**
   * ADR-0015 optional teacher-authored 3D visualization. When present the
   * unified Visualizer renders it (BallStickScene) in preference to any
   * hardcoded registry scene. Presentation only — never scored.
   */
  visualization?: Visualization
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
  /**
   * T08 teacher final adjudication for subjective dimensions (ADR-0006 §3).
   * DELIBERATELY separate from `score` — the automatic score reflects only
   * reproducible objective evidence; this carries the teacher's subjective
   * dimension grade stamped `teacher_annotation` provenance, gated by
   * requiresTeacherConfirmation. Cohort metrics can filter to see the
   * evidence layer vs the teacher-judgment layer distinctly. Never folded
   * into `score`, never batch-applied (每份人工判断 — 守铁律).
   */
  teacherAnnotation?: TeacherAnnotation
  /**
   * Paper-batch binding for T07 session derivation (T07). When set, attempts
   * belonging to the same paper group into one 'paper' practice session.
   * Explicit field — NOT derived from an assignmentId string prefix (the old
   * heuristic broke by_weakness batches and the /api/evaluations submit path).
   */
  paperId?: string
  /** Demo ownership stamp from the mock session (not real auth). */
  studentId?: string
  /** Required provenance tag (ADR-0006). Migrated rows default to evidence. */
  provenance: Provenance
}

/**
 * Teacher final adjudication payload (T08 / T13).
 * `signature` is HMAC-SHA256 over attemptId + fields (T13/P5) so tampering
 * is detectable; never folds into automatic `score`.
 */
export interface TeacherAnnotation {
  teacherId: string
  subjectiveScore: number
  subjectiveMaxScore: number
  note: string
  adjudicatedAt: string
  /** Hex HMAC-SHA256 (T13/P5). Optional on legacy rows graded before T13. */
  signature?: string
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
  /**
   * Optional product Attempt id (T07). When present, the evaluate path updates
   * that Attempt in place and preserves mode/paperId/teachingUnitId/termId so
   * D1 dual-mode mastery projection and T07 session grouping stay honest.
   * Legacy demo callers omit this and still get assessment-default Attempts.
   */
  attemptId?: string
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
  /**
   * Formal median — excludes subjective submissions still awaiting
   * teacherAnnotation (T08/T11 P4: 终裁后才入 Cohort).
   */
  medianScore: number
  needsAttention: number
  /**
   * Count of completed results with requiresTeacherConfirmation advisory
   * but no teacherAnnotation yet (T11 P4).
   */
  pendingAdjudication: number
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
  /**
   * Paper-batch binding (T07). When set, this attempt belongs to a composed
   * paper; T07 session derivation groups attempts sharing a paperId into one
   * 'paper' session. Explicit top-level field — the old practice of stuffing
   * a paper_ prefix into result.assignmentId broke under /api/evaluations
   * submit (which overwrites assignmentId with the question id).
   */
  paperId?: string
  /** T12/P1 assignment deadline (ISO-8601). Optional on free practice. */
  dueAt?: string
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
  /** ADR-0015 optional teacher-authored 3D visualization (presentation only). */
  visualization?: Visualization
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

/**
 * Teacher hand-entry draft for POST /api/questions (T03).
 * `authorId` is stamped server-side from the session — never trust the client.
 */
export interface CreateQuestionInput {
  questionBankId: string
  subject: SubjectLanguage
  questionType: QuestionType
  stem: string
  /** RunnerSpec payload matching questionType. */
  payload: unknown
  kpIds?: string[]
  difficulty?: number
  source?: EvidenceSource
  termId?: string
  /** Optional T09 standard solution (teacher-authored). */
  solution?: Omit<StandardSolution, 'authorId' | 'source'> & {
    authorId?: string
    source?: 'authored'
  }
}

/** PATCH /api/questions/:id — partial update of an owned question. */
export type UpdateQuestionInput = Omit<Partial<CreateQuestionInput>, 'solution'> & {
  /** null clears an existing standard solution (待补). */
  solution?: CreateQuestionInput['solution'] | null
}

/**
 * POST /api/questions/:id/adopt-solution (T09).
 * Promote an AI (or free-text) draft into a teacher-authored standard solution.
 */
export interface AdoptSolutionInput {
  content: string
  latex?: string
  keyPoints?: string[]
}

export interface AdoptSolutionResult {
  question: Question
  solution: StandardSolution | null
  tutoring: {
    mode: 'rag_restate' | 'llm_generate'
    needsSolution: boolean
    requiresDisclaimer: boolean
  }
}

// ---------------------------------------------------------------------------
// Teacher-authored visualization (ADR-0015).
// A teacher describes a scene in natural language → an LLM proposes a ball-stick
// geometry → the teacher previews it in 3D and confirms → it is stored on the
// Question and rendered by the unified visualizer suite. This is the
// *presentation* layer only; it never enters the scoring evidence chain.
// ---------------------------------------------------------------------------

/** One atom in a ball-stick visualization: id, element symbol, 3D position. */
export interface VisualizationAtom {
  id: string
  element: string
  position: readonly [number, number, number]
}

/** A bond between two atom ids. */
export interface VisualizationBond {
  from: string
  to: string
}

/**
 * Ball-stick visualization payload (ADR-0015 MVP). Covers molecules, crystals,
 * and structures expressible as atoms + bonds. The `kind` discriminant leaves
 * room for curve/primitive kinds without a schema rewrite.
 */
export interface BallStickVisualization {
  kind: 'ball_stick'
  atoms: readonly VisualizationAtom[]
  bonds: readonly VisualizationBond[]
  /** Optional human label shown above the canvas. */
  label?: string
}

/**
 * Curve visualization (Phase 4 / ADR-0015 extension). Pre-sampled 3D polyline
 * points — magnetic helices, DNA strands, trajectories. Pure data + zod
 * validation; no expression evaluation. Optional secondaryPoints draws a
 * second strand (DNA double helix) without expanding to multi-strand schema.
 */
export interface CurveVisualization {
  kind: 'curve'
  /** Primary curve polyline, each point [x, y, z]. */
  points: readonly (readonly [number, number, number])[]
  /** Optional second strand (e.g. DNA complementary helix). */
  secondaryPoints?: readonly (readonly [number, number, number])[]
  /** Optional human label shown above the canvas. */
  label?: string
}

/** Union of all visualization kinds. Discriminant scales per ADR-0015. */
export type Visualization = BallStickVisualization | CurveVisualization

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
  /** T12/P1 optional deadline echoed from assignment input. */
  dueAt?: string
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

// ---------------------------------------------------------------------------
// T07 — student practice sessions + mistake book (D1 dual-mode entry)
// ---------------------------------------------------------------------------

/**
 * A practice session groups a student's attempts. Two entry shapes (T07):
 * - single: one attempt per session (自由练, 一题一交一反馈)
 * - paper:  multiple attempts bound to one paper/assignment batch (成套测评)
 * Sessions are *derived* from Attempt metadata (teachingUnitId/mode/paperId),
 * not a separate store — the AttemptStore is the single source of truth.
 */
export interface PracticeSession {
  id: string
  studentId: string
  mode: SessionMode
  teachingUnitId: string
  termId: string
  /** 'single' 自由练 | 'paper' 成套打包. */
  shape: 'single' | 'paper'
  attemptIds: string[]
  startedAt: string
  lastActiveAt: string
  /** For paper sessions: the assigned paper/assignment id if known. */
  paperId?: string
}

/** One mistake-book entry: an incorrectly-answered question, aggregatable. */
export interface MistakeEntry {
  questionId: string
  teachingUnitId: string
  subject: SubjectLanguage
  kpIds: string[]
  /** Most recent failed attempt for this question. */
  attemptId: string
  lastScore: number
  lastActiveAt: string
  /** Consecutive assessment-mode passes (N→mastered, moved out of active book). */
  consecutiveAssessmentPasses: number
  mastered: boolean
}

export interface MistakeBookView {
  studentId: string
  entries: MistakeEntry[]
  /** Entries with mastered=true are history; the rest are the active book. */
  activeCount: number
  masteredCount: number
}

/** POST /api/student/practice — start or continue a practice attempt. */
export interface StartPracticeRequest {
  questionId: string
  teachingUnitId: string
  termId: string
  /** D1 gate: practice opens tutoring; assessment closes it. */
  mode: SessionMode
  /** For paper sessions: bind the attempt to a paper batch. */
  paperId?: string
}

export interface StartPracticeResponse {
  attemptId: string
  mode: SessionMode
  /** Whether tutoring layers are available for this attempt (D1). */
  tutoringEnabled: boolean
}

// ---------------------------------------------------------------------------
// T08 — teacher workflow: teaching unit / roster import / assignment / grading
// ---------------------------------------------------------------------------

/** A teacher creating a teaching unit (class × subject × term, D3). */
export interface CreateTeachingUnitInput {
  classId: string
  subjectId: string
  termId: string
  taughtKpIds: string[]
}

export interface TeachingUnitView extends TeachingUnit {
  className: string
  subjectName: string
  termName: string
  enrolledCount: number
}

/** Roster row for student import (T08 reuses AuthService.importStudents). */
export interface RosterRow {
  studentNumber: string
  displayName: string
}

export interface ImportedRosterEntry {
  userId: string
  loginId: string
  displayName: string
  activationCode: string
}

export interface ImportRosterResult {
  classId: string
  termId: string
  imported: ImportedRosterEntry[]
}

/** Three assignment shapes (T08): hand-pick / assemble-by-kp / by-weakness. */
export type AssignmentKind = 'handpick' | 'assemble_by_kp' | 'by_weakness'

export interface CreateAssignmentInput {
  teachingUnitId: string
  mode: SessionMode
  kind: AssignmentKind
  /** handpick: explicit question ids. */
  questionIds?: string[]
  /** assemble_by_kp: KP filter for QuestionBankService.assembleByKnowledgePoints. */
  kpIds?: string[]
  limit?: number
  /** Optional target students; omitted = whole class. */
  studentIds?: string[]
  /** Paper/assignment title for the batch. */
  title?: string
  /** T12/P1 deadline (ISO-8601). Optional. */
  dueAt?: string
}

export interface CreateAssignmentResult {
  teachingUnitId: string
  kind: AssignmentKind
  paperId: string
  attemptIds: string[]
  studentIds: string[]
  questionIds: string[]
  mode: SessionMode
  createdAt: string
  /** Echo of input dueAt when set (T12/P1). */
  dueAt?: string
}

/**
 * A subjective (essay) item awaiting teacher final adjudication (T08).
 * The objective evidence (~40% reproducible) already entered the score;
 * the advisory AI suggestions (立意/论证) are displayed but NOT scored;
 * the teacher writes the final subjective dimension score as
 * `teacher_annotation` provenance (ADR-0006), gated by
 * requiresTeacherConfirmation. Batch grading is forbidden (守铁律).
 */
export interface GradingQueueItem {
  attemptId: string
  studentId: string
  questionId: string
  teachingUnitId: string
  stem: string
  submittedAt: string
  /** Objective evidence already scored (字数/结构/语法) — reproducible. */
  objectiveScore: number
  objectiveMaxScore: number
  /** AI advisory suggestions (灰色"AI 推断"徽章) — never scored. */
  advisory: AdvisorySuggestion[]
  /** Student's submitted answer text for the teacher to read. */
  submissionText: string
  /** Present when a teacher has already adjudicated this item. */
  teacherAnnotation?: TeacherAnnotation
}

export interface GradeSubjectiveInput {
  attemptId: string
  subjectiveScore: number
  subjectiveMaxScore: number
  note: string
}

export interface GradeSubjectiveResult {
  attemptId: string
  /** teacher_annotation provenance — never folded into the automatic score. */
  teacherAnnotation: TeacherAnnotation
}

// ---------------------------------------------------------------------------
// T14 — teacher batch tips (站内消息; never touches score)
// ---------------------------------------------------------------------------

/** Teacher-authored short tip for a teaching unit (not a grade, not Intervention). */
export interface TeacherTip {
  id: string
  teachingUnitId: string
  teacherId: string
  /** Plain text body, max ~2000 chars. */
  body: string
  createdAt: string
  /** Optional weak-KP tags (display/link only). */
  kpIds?: string[]
  /** Optional paper link (display only; never writes score). */
  paperId?: string
  /** Optional question link (display only; never writes score). */
  questionId?: string
}

/** Per-student delivery envelope for a tip (one tip → N deliveries). */
export interface TeacherTipDelivery {
  tipId: string
  studentId: string
  /** ISO-8601; absent/undefined = unread. */
  readAt?: string
}

/** POST /api/teacher/tips */
export interface CreateTeacherTipInput {
  teachingUnitId: string
  body: string
  /** Optional subset of enrolled students; omitted = whole unit. */
  studentIds?: string[]
  kpIds?: string[]
  paperId?: string
  questionId?: string
}

export interface CreateTeacherTipResult {
  tip: TeacherTip
  /** Students who received a delivery envelope. */
  studentIds: string[]
  deliveryCount: number
}

/** GET /api/teacher/tips — tip + read counters for the teacher. */
export interface TeacherTipSummary extends TeacherTip {
  deliveryCount: number
  readCount: number
}

/** GET /api/student/tips — inbox item (unread first). */
export interface StudentTipItem extends TeacherTip {
  /** Present when this student has marked the tip read. */
  readAt?: string
}
