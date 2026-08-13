/** Next-practice + assign-by-weakness contracts (T06). */

import type { SessionMode } from './org'
import type { QuestionSummary } from './question'

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
