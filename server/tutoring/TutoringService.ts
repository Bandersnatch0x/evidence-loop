import { randomUUID } from 'node:crypto'
import type {
  Attempt,
  SessionMode,
  StandardSolution,
  TutoringLayer,
  TutoringMessage,
  TutoringResponse,
  TutoringTurn
} from '../../shared/contracts'
import type { FeedbackContext } from '../domain/feedback'
import type { AttemptStore } from '../store/AttemptStore'
import type { EvaluationStore } from '../store/EvaluationStore'
import { isAttemptStore } from '../store/AttemptStore'
import { resolveLlmProvider } from './callOpenAICompatible'
import { DialogueGenerator } from './DialogueGenerator'
import { ExplainGenerator } from './ExplainGenerator'
import { SocraticGenerator } from './SocraticGenerator'
import type { TutoringGenerator, TutoringInput } from './types'

/**
 * Mode-gate + orchestration for three tutoring layers (T05 / D1).
 *
 * Physical isolation:
 *   - reads Attempt / FeedbackContext only
 *   - never writes score / evidence / mastery
 *   - stamps every output as llm_inference TutoringMessage
 */
export class TutoringModeError extends Error {
  public readonly statusCode: number

  public constructor(message: string, statusCode = 403) {
    super(message)
    this.name = 'TutoringModeError'
    this.statusCode = statusCode
  }
}

export class TutoringNotFoundError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'TutoringNotFoundError'
  }
}

export interface TutoringServiceOptions {
  store: EvaluationStore | AttemptStore
  explain?: TutoringGenerator
  socratic?: TutoringGenerator
  dialogue?: TutoringGenerator
}

export interface TutoringCallRequest {
  attemptId: string
  mode: SessionMode
  layer: TutoringLayer
  message?: string
  history?: TutoringTurn[]
  priorSummary?: string
  lowEffortStreak?: number
  solution?: StandardSolution
}

export class TutoringService {
  private readonly store: EvaluationStore | AttemptStore
  private readonly explain: TutoringGenerator
  private readonly socratic: TutoringGenerator
  private readonly dialogue: TutoringGenerator

  public constructor(options: TutoringServiceOptions) {
    this.store = options.store
    const llm = resolveLlmProvider()
    this.explain = options.explain ?? new ExplainGenerator(llm)
    this.socratic = options.socratic ?? new SocraticGenerator(llm)
    this.dialogue = options.dialogue ?? new DialogueGenerator(llm)
  }

  public async handle(request: TutoringCallRequest): Promise<TutoringResponse> {
    const attempt = await this.loadAttempt(request.attemptId)
    this.assertModeGate(request.layer, request.mode, attempt)

    const input: TutoringInput = {
      context: feedbackContextFromAttempt(attempt),
      mode: attempt.mode,
      solution: request.solution,
      message: request.message,
      history: request.history,
      priorSummary: request.priorSummary,
      lowEffortStreak: request.lowEffortStreak
    }

    if (
      (request.layer === 'socratic' || request.layer === 'dialogue') &&
      (!request.message || request.message.trim() === '')
    ) {
      throw new TutoringModeError('message is required for this tutoring layer', 400)
    }

    const generator = this.generatorFor(request.layer)
    const result = await generator.generate(input)
    const message = stampMessage(request.layer, result)

    return {
      message,
      allowedMode: attempt.mode,
      layer: request.layer
    }
  }

  private generatorFor(layer: TutoringLayer): TutoringGenerator {
    if (layer === 'explain') return this.explain
    if (layer === 'socratic') return this.socratic
    return this.dialogue
  }

  private async loadAttempt(attemptId: string): Promise<Attempt> {
    if (isAttemptStore(this.store)) {
      const attempt = await this.store.getAttempt(attemptId)
      if (attempt) return attempt
      throw new TutoringNotFoundError(`Attempt not found: ${attemptId}`)
    }

    // Legacy EvaluationStore path: project as assessment attempt so mode
    // gating still has a stable shape (D1 default for formal eval history).
    const evaluation = await this.store.get(attemptId)
    if (!evaluation) {
      throw new TutoringNotFoundError(`Attempt not found: ${attemptId}`)
    }
    return {
      id: evaluation.id,
      studentId: evaluation.studentId ?? 'unknown-student',
      questionId: evaluation.assignmentId,
      teachingUnitId: 'legacy-teaching-unit',
      termId: 'legacy-term',
      mode: 'assessment',
      createdAt: evaluation.createdAt,
      result: evaluation
    }
  }

  /**
   * D1 dual-mode gate (T05):
   *   - socratic / dialogue: practice only
   *   - explain: practice always; assessment only after completed submit
   * Client-declared mode must match Attempt.mode.
   */
  private assertModeGate(
    layer: TutoringLayer,
    declaredMode: SessionMode,
    attempt: Attempt
  ): void {
    if (declaredMode !== attempt.mode) {
      throw new TutoringModeError(
        `mode mismatch: request is ${declaredMode} but attempt is ${attempt.mode}`,
        400
      )
    }

    if (layer === 'socratic' || layer === 'dialogue') {
      if (attempt.mode !== 'practice') {
        throw new TutoringModeError(
          'Socratic and dialogue tutoring are only available in practice mode (D1)',
          403
        )
      }
      return
    }

    // explain
    if (attempt.mode === 'assessment') {
      if (attempt.result.status !== 'completed') {
        throw new TutoringModeError(
          'Explain tutoring in assessment mode is only available after submission is completed',
          403
        )
      }
    }
  }
}

function feedbackContextFromAttempt(attempt: Attempt): FeedbackContext {
  const result = attempt.result
  // Minimal assignment shell — generators only need title/objective/type.
  // Full ExecutableAssignment is not required for tutoring read path.
  return {
    assignment: {
      id: result.assignmentId,
      title: result.assignmentId,
      module: '',
      language: 'math',
      questionType: 'expression',
      estimatedMinutes: 0,
      status: 'ready',
      objective: result.summary,
      scenario: '',
      requirements: [],
      constraints: [],
      functionSignature: '',
      rubric: result.dimensions.map((d) => ({
        id: d.id,
        label: d.label,
        description: d.description,
        maxScore: d.maxScore
      })),
      demoVariants: [],
      criteria: [],
      runner: { kind: 'expression', expectedLatex: '' }
    },
    score: result.score,
    previousScore: result.previousScore,
    evidence: result.evidence,
    diagnoses: result.diagnoses,
    intervention: result.intervention
  }
}

function stampMessage(
  layer: TutoringLayer,
  result: {
    content: string
    source: 'local-policy' | 'llm'
    model: string
    sourceMessages?: string[]
    confidence?: number
    disclaimer?: string
  }
): TutoringMessage {
  const extractedAt = new Date().toISOString()
  return {
    id: `tutoring-${layer}-${randomUUID()}`,
    layer,
    role: 'assistant',
    content: result.content,
    provenance: {
      kind: 'llm_inference',
      sourceMessages: result.sourceMessages ?? [result.content],
      model: result.model,
      extractedAt,
      ...(result.confidence !== undefined
        ? { confidence: result.confidence }
        : {})
    },
    source: result.source,
    createdAt: extractedAt,
    ...(result.disclaimer !== undefined
      ? { disclaimer: result.disclaimer }
      : {})
  }
}

/** Factory used by routes / tests. */
export function createTutoringService(
  store: EvaluationStore | AttemptStore
): TutoringService {
  return new TutoringService({ store })
}
