/** Three-layer AI tutoring contracts (T05). */

import type { Provenance } from './evaluation'
import type { SessionMode } from './org'
import type { StandardSolution } from './question'

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
