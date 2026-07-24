import type {
  SessionMode,
  StandardSolution,
  TutoringLayer,
  TutoringMessage,
  TutoringTurn
} from '../../shared/contracts'
import type { FeedbackContext } from '../domain/feedback'
import type { LlmProviderConfig } from './callOpenAICompatible'

/**
 * Read-only tutoring input (T05 iron rule).
 *
 * Generators consume FeedbackContext + optional T09 solution + dialogue
 * window only. They never receive mutators for scoring outputs and never
 * import the formal mastery or runner modules.
 */
export interface TutoringInput {
  context: FeedbackContext
  mode: SessionMode
  solution?: StandardSolution
  /** Student utterance for socratic / dialogue. */
  message?: string
  history?: TutoringTurn[]
  /** Optional summary of turns beyond the rolling window. */
  priorSummary?: string
  /** Client-reported consecutive low-effort hint streak (socratic). */
  lowEffortStreak?: number
}

export interface TutoringGeneratorResult {
  content: string
  source: 'local-policy' | 'llm'
  model: string
  /** Extra provenance source message fragments (optional). */
  sourceMessages?: string[]
  confidence?: number
  disclaimer?: string
}

export interface TutoringGenerator {
  readonly layer: TutoringLayer
  generate(input: TutoringInput): Promise<TutoringGeneratorResult>
}

export interface TutoringLlmOptions {
  config: LlmProviderConfig
  temperature: number
  timeoutMs?: number
  maxTokens?: number
}

export type { FeedbackContext, TutoringMessage, TutoringLayer, SessionMode }
