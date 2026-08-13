/** Evaluation, evidence, assignment presentation, rubric (ADR-0001/0004/0008). */

import type { Visualization } from './visualization'
import type { AdvisorySuggestion } from './knowledge'

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

export interface DemonstrationReferenceView {
  id: string
  role: 'primary' | 'supplementary'
  title: string
  authorName: string
  license: string
  versionSeq: number
  source: 'public' | 'mine'
  demoId: string
  versionId: string
  health: 'healthy' | 'unavailable'
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
   * unified Visualizer dispatches by kind (ball_stick / curve) in preference
   * to any hardcoded registry scene. Presentation only — never scored.
   * Populated for demo seed merges and private-question projections (Phase 5).
   */
  visualization?: Visualization
  /**
   * Fixed approved demonstration versions for student presentation. New
   * references take precedence over legacy visualization; display only and
   * never consumed by runners, rubrics, scoring, or evidence services.
   */
  demonstrations?: DemonstrationReferenceView[]
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
  /**
   * P2-1 scaffold trace: whether the student viewed the demonstration scaffold
   * before this submission, and for how long (ms). Presentation-only metadata -
   * never enters the score (红线：支架只进呈现层，永不进评分层). Enables
   * MasteryTimeline to distinguish independent vs scaffold-assisted mastery.
   */
  scaffoldUsed?: boolean
  scaffoldDurationMs?: number
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
  /** P2-1: whether the student viewed the demonstration scaffold before submit. */
  scaffoldUsed?: boolean
  /** P2-1: cumulative ms the demonstration scaffold was viewed before submit. */
  scaffoldDurationMs?: number
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
  /** P2-1 scaffold trace (presentation-only, never scored). */
  scaffoldUsed?: boolean
}

export interface ApiError {
  error: string
  details?: string[]
}
