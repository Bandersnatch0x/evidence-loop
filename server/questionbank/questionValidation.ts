import type {
  EvidenceSource,
  Question,
  QuestionType,
  SubjectLanguage
} from '../../shared/contracts'
import type { RunnerSpec } from '../data/assignments'
import { isPythonRunnerSpec } from '../data/assignments'
import { validateSolution } from './solution'

/**
 * T03 question hand-entry validation.
 *
 * Validates the structured Question produced by teacher entry: subject +
 * questionType + stem + a type-matched RunnerSpec payload + KP tags +
 * difficulty. The payload shapes are the SAME RunnerSpec union the
 * RunnerRegistry already routes by questionType, so a valid Question runs
 * through the existing scoring loop unchanged.
 */

export class QuestionValidationError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'QuestionValidationError'
  }
}

const QUESTION_TYPES: readonly QuestionType[] = [
  'choice',
  'fill_blank',
  'numeric',
  'expression',
  'chem_equation',
  'code',
  'essay',
  'geometry'
]

const SUBJECTS: readonly SubjectLanguage[] = [
  'python',
  'math',
  'physics',
  'chemistry',
  'chinese',
  'english',
  'biology',
  'politics',
  'history',
  'geography'
]

const EVIDENCE_SOURCES: readonly EvidenceSource[] = ['test_case', 'authored_key']

const MIN_DIFFICULTY = 1
const MAX_DIFFICULTY = 5
const MAX_STEM_LENGTH = 8_000
const MAX_KP_IDS = 50

/** Draft shape accepted from the hand-entry form / import path. */
export interface QuestionDraft {
  id?: string
  questionBankId: string
  authorId: string
  subject: string
  questionType: string
  stem: string
  payload: unknown
  kpIds?: unknown
  difficulty?: unknown
  source?: unknown
  termId?: string
  createdAt?: string
  solution?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Validate a RunnerSpec payload against the declared questionType. Returns the
 * narrowed spec so callers persist a shape the RunnerRegistry can consume.
 */
export function validatePayload(
  questionType: QuestionType,
  payload: unknown
): RunnerSpec {
  if (!isRecord(payload)) {
    throw new QuestionValidationError('Question payload must be an object')
  }

  switch (questionType) {
    case 'choice':
      return validateChoice(payload)
    case 'fill_blank':
      return validateFillBlank(payload)
    case 'numeric':
      return validateNumeric(payload)
    case 'expression':
      return validateExpression(payload)
    case 'chem_equation':
      return validateChemEquation(payload)
    case 'essay':
      return validateEssay(payload)
    case 'code':
      return validateCode(payload)
    case 'geometry':
      return validateGeometry(payload)
    default: {
      const exhaustive: never = questionType
      throw new QuestionValidationError(
        `Unsupported question type: ${String(exhaustive)}`
      )
    }
  }
}

function validateChoice(payload: Record<string, unknown>): RunnerSpec {
  if (payload.kind !== 'choice') {
    throw new QuestionValidationError("Choice payload requires kind: 'choice'")
  }
  const ids = payload.correctOptionIds
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new QuestionValidationError(
      'Choice payload requires a non-empty correctOptionIds array'
    )
  }
  const correctOptionIds = ids.map((id) => {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new QuestionValidationError('Each correctOptionId must be a non-empty string')
    }
    return id
  })
  return { kind: 'choice', correctOptionIds }
}

function validateFillBlank(payload: Record<string, unknown>): RunnerSpec {
  if (payload.kind !== 'fill_blank') {
    throw new QuestionValidationError("Fill-blank payload requires kind: 'fill_blank'")
  }
  const accepted = payload.acceptedAnswers
  if (!Array.isArray(accepted) || accepted.length === 0) {
    throw new QuestionValidationError(
      'Fill-blank payload requires a non-empty acceptedAnswers array'
    )
  }
  const acceptedAnswers = accepted.map((answer) => {
    if (typeof answer !== 'string' || answer === '') {
      throw new QuestionValidationError('Each acceptedAnswer must be a non-empty string')
    }
    return answer
  })
  const spec: RunnerSpec = { kind: 'fill_blank', acceptedAnswers }
  if (payload.caseSensitive !== undefined) {
    if (typeof payload.caseSensitive !== 'boolean') {
      throw new QuestionValidationError('caseSensitive must be a boolean')
    }
    spec.caseSensitive = payload.caseSensitive
  }
  return spec
}

function validateNumeric(payload: Record<string, unknown>): RunnerSpec {
  if (payload.kind !== 'numeric') {
    throw new QuestionValidationError("Numeric payload requires kind: 'numeric'")
  }
  if (typeof payload.expected !== 'number' || !Number.isFinite(payload.expected)) {
    throw new QuestionValidationError('Numeric payload requires a finite expected number')
  }
  if (
    typeof payload.tolerance !== 'number' ||
    !Number.isFinite(payload.tolerance) ||
    payload.tolerance < 0
  ) {
    throw new QuestionValidationError(
      'Numeric payload requires a non-negative finite tolerance'
    )
  }
  return { kind: 'numeric', expected: payload.expected, tolerance: payload.tolerance }
}

function validateExpression(payload: Record<string, unknown>): RunnerSpec {
  if (payload.kind !== 'expression') {
    throw new QuestionValidationError("Expression payload requires kind: 'expression'")
  }
  if (typeof payload.expectedLatex !== 'string' || payload.expectedLatex.trim() === '') {
    throw new QuestionValidationError(
      'Expression payload requires a non-empty expectedLatex string'
    )
  }
  const spec: RunnerSpec = { kind: 'expression', expectedLatex: payload.expectedLatex }
  if (payload.steps !== undefined) {
    if (
      !Array.isArray(payload.steps) ||
      payload.steps.some((step) => typeof step !== 'string')
    ) {
      throw new QuestionValidationError('Expression steps must be an array of strings')
    }
    spec.steps = payload.steps as readonly string[]
  }
  return spec
}

function validateChemEquation(payload: Record<string, unknown>): RunnerSpec {
  if (payload.kind !== 'chem_equation') {
    throw new QuestionValidationError(
      "Chem-equation payload requires kind: 'chem_equation'"
    )
  }
  if (
    typeof payload.expectedEquation !== 'string' ||
    payload.expectedEquation.trim() === ''
  ) {
    throw new QuestionValidationError(
      'Chem-equation payload requires a non-empty expectedEquation string'
    )
  }
  return { kind: 'chem_equation', expectedEquation: payload.expectedEquation }
}

function validateEssay(payload: Record<string, unknown>): RunnerSpec {
  if (payload.kind !== 'essay') {
    throw new QuestionValidationError("Essay payload requires kind: 'essay'")
  }
  const spec: RunnerSpec = { kind: 'essay' }
  if (payload.minWords !== undefined) {
    if (
      typeof payload.minWords !== 'number' ||
      !Number.isInteger(payload.minWords) ||
      payload.minWords < 0
    ) {
      throw new QuestionValidationError('Essay minWords must be a non-negative integer')
    }
    spec.minWords = payload.minWords
  }
  if (payload.requiredKeywords !== undefined) {
    if (
      !Array.isArray(payload.requiredKeywords) ||
      payload.requiredKeywords.some((keyword) => typeof keyword !== 'string')
    ) {
      throw new QuestionValidationError(
        'Essay requiredKeywords must be an array of strings'
      )
    }
    spec.requiredKeywords = payload.requiredKeywords as string[]
  }
  return spec
}

function validateCode(payload: Record<string, unknown>): RunnerSpec {
  // Code reuses the untagged PythonRunnerSpec shape (no `kind` discriminator).
  if (!isPythonRunnerSpec(payload as unknown as RunnerSpec)) {
    throw new QuestionValidationError(
      'Code payload requires a PythonRunnerSpec (functionName, maxAstNodes, testCases[])'
    )
  }
  return payload as unknown as RunnerSpec
}

function isTriple(value: unknown): value is [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((n) => typeof n === 'number' && Number.isFinite(n))
  )
}

function validateGeometry(payload: Record<string, unknown>): RunnerSpec {
  if (payload.kind !== 'geometry') {
    throw new QuestionValidationError("Geometry payload requires kind: 'geometry'")
  }
  if (!isRecord(payload.vertices)) {
    throw new QuestionValidationError('Geometry payload requires a vertices object')
  }
  const vertices: Record<string, readonly [number, number, number]> = {}
  for (const [key, coord] of Object.entries(payload.vertices)) {
    if (!/^[A-H]$/.test(key)) {
      throw new QuestionValidationError(`Geometry vertex keys must be A..H, got: ${key}`)
    }
    if (!isTriple(coord)) {
      throw new QuestionValidationError(
        `Geometry vertex ${key} must be a 3-tuple of finite numbers`
      )
    }
    vertices[key] = coord
  }
  if (Object.keys(vertices).length === 0) {
    throw new QuestionValidationError('Geometry payload requires at least one vertex')
  }
  if (
    !Array.isArray(payload.sectionVertexIds) ||
    payload.sectionVertexIds.length === 0 ||
    !payload.sectionVertexIds.every((id) => typeof id === 'string' && id in vertices)
  ) {
    throw new QuestionValidationError(
      'Geometry sectionVertexIds must be a non-empty array of vertex keys present in vertices'
    )
  }
  return { kind: 'geometry', vertices, sectionVertexIds: payload.sectionVertexIds as string[] }
}

/**
 * Validate + normalize a full question draft into a persistable Question
 * (minus the store-assigned id / createdAt when omitted). Throws
 * QuestionValidationError on any structural violation.
 */
export function validateQuestionDraft(
  draft: QuestionDraft
): Omit<Question, 'id' | 'createdAt'> & { id?: string; createdAt?: string } {
  if (typeof draft.questionBankId !== 'string' || draft.questionBankId.trim() === '') {
    throw new QuestionValidationError('questionBankId is required')
  }
  if (typeof draft.authorId !== 'string' || draft.authorId.trim() === '') {
    throw new QuestionValidationError('authorId is required')
  }
  if (typeof draft.subject !== 'string' || !isSubject(draft.subject)) {
    throw new QuestionValidationError(`Unsupported subject: ${String(draft.subject)}`)
  }
  if (typeof draft.questionType !== 'string' || !isQuestionType(draft.questionType)) {
    throw new QuestionValidationError(
      `Unsupported questionType: ${String(draft.questionType)}`
    )
  }
  if (typeof draft.stem !== 'string' || draft.stem.trim() === '') {
    throw new QuestionValidationError('stem must be a non-empty string')
  }
  if (draft.stem.length > MAX_STEM_LENGTH) {
    throw new QuestionValidationError(
      `stem exceeds ${String(MAX_STEM_LENGTH)} characters`
    )
  }

  const payload = validatePayload(draft.questionType, draft.payload)
  const kpIds = validateKpIds(draft.kpIds)
  const difficulty = validateDifficulty(draft.difficulty)
  const source = validateSource(draft.source)

  const normalized: Omit<Question, 'id' | 'createdAt'> & {
    id?: string
    createdAt?: string
  } = {
    questionBankId: draft.questionBankId,
    authorId: draft.authorId,
    subject: draft.subject,
    questionType: draft.questionType,
    stem: draft.stem.trim(),
    payload,
    kpIds,
    difficulty,
    source
  }

  if (draft.id !== undefined) normalized.id = draft.id
  if (draft.createdAt !== undefined) normalized.createdAt = draft.createdAt
  if (draft.termId !== undefined) normalized.termId = draft.termId
  if (draft.solution !== undefined) {
    normalized.solution = validateSolution(draft.solution)
  }

  return normalized
}

function validateKpIds(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    throw new QuestionValidationError('kpIds must be an array')
  }
  if (value.length > MAX_KP_IDS) {
    throw new QuestionValidationError(`kpIds exceed ${String(MAX_KP_IDS)} entries`)
  }
  return value.map((kpId) => {
    if (typeof kpId !== 'string' || kpId.trim() === '') {
      throw new QuestionValidationError('Each kpId must be a non-empty string')
    }
    return kpId
  })
}

function validateDifficulty(value: unknown): number {
  if (value === undefined) return 3
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < MIN_DIFFICULTY ||
    value > MAX_DIFFICULTY
  ) {
    throw new QuestionValidationError(
      `difficulty must be an integer in [${String(MIN_DIFFICULTY)}, ${String(MAX_DIFFICULTY)}]`
    )
  }
  return value
}

function validateSource(value: unknown): EvidenceSource {
  if (value === undefined) return 'authored_key'
  if (typeof value !== 'string' || !isEvidenceSource(value)) {
    throw new QuestionValidationError(
      "source must be 'test_case' or 'authored_key'"
    )
  }
  return value
}

function isQuestionType(value: string): value is QuestionType {
  return (QUESTION_TYPES as readonly string[]).includes(value)
}

function isSubject(value: string): value is SubjectLanguage {
  return (SUBJECTS as readonly string[]).includes(value)
}

function isEvidenceSource(value: string): value is EvidenceSource {
  return (EVIDENCE_SOURCES as readonly string[]).includes(value)
}
