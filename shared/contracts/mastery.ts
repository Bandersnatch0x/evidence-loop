/** Mastery profile, review scheduling, intervention suggestion (ADR-0006). */

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
