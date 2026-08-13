/** Practice sessions + mistake book (T07). */

import type { SessionMode } from './org'
import type { SubjectLanguage } from './evaluation'

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
