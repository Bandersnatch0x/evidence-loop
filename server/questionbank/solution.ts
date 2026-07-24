import type { StandardSolution } from '../../shared/contracts'

/**
 * T09 standard-solution access + validation utility.
 *
 * A `StandardSolution` is the teacher-authored, human-authoritative solution
 * attached to a `Question`. It is deliberately OPTIONAL (裁决: not a hard gate,
 * else teacher import burden kills cold-start). Its presence tiers AI tutoring
 * trust:
 *   - present  → RAG the verified solution; AI 复述+展开 (lowest hallucination).
 *   - absent   → 待补; AI degrades to pure generation with an llm_inference
 *                disclaimer badge.
 *
 * This module owns ONLY solution parse/validate/serialize + the tutoring-mode
 * decision. It never touches the QuestionBankService body (T03 owner).
 */

/** Max solution body length — guards against unbounded rich-text payloads. */
const MAX_CONTENT_LENGTH = 20_000
const MAX_LATEX_LENGTH = 8_000
const MAX_KEY_POINTS = 50
const MAX_KEY_POINT_LENGTH = 2_000

export class SolutionValidationError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'SolutionValidationError'
  }
}

/**
 * AI tutoring mode derived from solution presence (T09 §3).
 * - `rag_restate`: a verified solution exists; the LLM restates/expands it.
 * - `llm_generate`: no solution; the LLM self-generates with a disclaimer.
 */
export type TutoringMode = 'rag_restate' | 'llm_generate'

export interface TutoringContext {
  mode: TutoringMode
  /** Verified solution text for RAG, when present. */
  ragContent?: string
  ragLatex?: string
  ragKeyPoints?: string[]
  /** True when the question is flagged 待补 (no standard solution). */
  needsSolution: boolean
  /** Show the "AI 生成，可能有误" disclaimer badge when true (ADR-0006 gray). */
  requiresDisclaimer: boolean
}

/**
 * Validate + normalize a candidate standard solution. Trims strings, drops
 * empty key points, and enforces length caps. Throws SolutionValidationError
 * on structurally invalid input so the store never persists malformed JSON.
 */
export function validateSolution(input: unknown): StandardSolution {
  if (typeof input !== 'object' || input === null) {
    throw new SolutionValidationError('Standard solution must be an object')
  }

  const record = input as Record<string, unknown>

  const content = record.content
  if (typeof content !== 'string' || content.trim() === '') {
    throw new SolutionValidationError('Solution content must be a non-empty string')
  }
  if (content.length > MAX_CONTENT_LENGTH) {
    throw new SolutionValidationError(
      `Solution content exceeds ${String(MAX_CONTENT_LENGTH)} characters`
    )
  }

  const authorId = record.authorId
  if (typeof authorId !== 'string' || authorId.trim() === '') {
    throw new SolutionValidationError('Solution authorId must be a non-empty string')
  }

  if (record.source !== undefined && record.source !== 'authored') {
    throw new SolutionValidationError(
      "Solution source must be 'authored' (human-authoritative)"
    )
  }

  const solution: StandardSolution = {
    content: content.trim(),
    authorId: authorId.trim(),
    source: 'authored'
  }

  if (record.latex !== undefined) {
    if (typeof record.latex !== 'string') {
      throw new SolutionValidationError('Solution latex must be a string')
    }
    const latex = record.latex.trim()
    if (latex.length > MAX_LATEX_LENGTH) {
      throw new SolutionValidationError(
        `Solution latex exceeds ${String(MAX_LATEX_LENGTH)} characters`
      )
    }
    if (latex !== '') solution.latex = latex
  }

  if (record.keyPoints !== undefined) {
    if (!Array.isArray(record.keyPoints)) {
      throw new SolutionValidationError('Solution keyPoints must be an array')
    }
    const keyPoints = record.keyPoints
      .map((point) => {
        if (typeof point !== 'string') {
          throw new SolutionValidationError('Each keyPoint must be a string')
        }
        return point.trim()
      })
      .filter((point) => point !== '')
    if (keyPoints.length > MAX_KEY_POINTS) {
      throw new SolutionValidationError(
        `Solution keyPoints exceed ${String(MAX_KEY_POINTS)} entries`
      )
    }
    for (const point of keyPoints) {
      if (point.length > MAX_KEY_POINT_LENGTH) {
        throw new SolutionValidationError(
          `A keyPoint exceeds ${String(MAX_KEY_POINT_LENGTH)} characters`
        )
      }
    }
    if (keyPoints.length > 0) solution.keyPoints = keyPoints
  }

  return solution
}

/**
 * Serialize a solution to the JSON stored in `questions.solution_json`.
 * Returns null when absent so the nullable column stays null (待补 marker).
 */
export function serializeSolution(
  solution: StandardSolution | undefined
): string | null {
  if (solution === undefined) return null
  return JSON.stringify(solution)
}

/**
 * Parse `questions.solution_json` back into a StandardSolution. Returns
 * undefined for null / empty / malformed JSON so a corrupt row degrades to
 * 待补 rather than throwing on read.
 */
export function parseSolution(
  json: string | null | undefined
): StandardSolution | undefined {
  if (json === null || json === undefined || json.trim() === '') {
    return undefined
  }
  try {
    return validateSolution(JSON.parse(json))
  } catch {
    return undefined
  }
}

/** True when a question has a usable standard solution. */
export function hasSolution(solution: StandardSolution | undefined): boolean {
  return solution !== undefined
}

/**
 * Build the AI tutoring context from a question's solution (T09 §3).
 * Present → RAG restate (verified, low hallucination). Absent → 待补 +
 * pure-generation disclaimer.
 */
export function buildTutoringContext(
  solution: StandardSolution | undefined
): TutoringContext {
  if (solution === undefined) {
    return {
      mode: 'llm_generate',
      needsSolution: true,
      requiresDisclaimer: true
    }
  }

  return {
    mode: 'rag_restate',
    ragContent: solution.content,
    ragLatex: solution.latex,
    ragKeyPoints: solution.keyPoints,
    needsSolution: false,
    requiresDisclaimer: false
  }
}
