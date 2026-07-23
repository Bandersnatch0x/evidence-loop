import type {
  ChoiceRunnerSpec,
  ExecutableAssignment,
  FillBlankRunnerSpec,
  NumericRunnerSpec
} from '../data/assignments'
import type { CodeRunner, RunnerEvidence, RunnerRequest, RunnerResult } from './types'
import { resolveSubmission } from './types'

/**
 * Deterministic validator for objective question types (ADR-0008): choice,
 * fill_blank, and numeric. True/false questions are modelled as a boolean
 * special case of `choice` (correctOptionIds carry boolean literals), so this
 * validator needs no dedicated spec and honours the "do not touch
 * contracts/assignments" constraint.
 *
 * Every branch is pure: no network, no filesystem, no clock-dependent logic
 * beyond duration measurement. Given the same spec + submission it always
 * yields the same Evidence, satisfying ADR-0001 (score only from reproducible
 * evidence).
 */

/** Words normalised to the boolean literal `true` for true/false questions. */
const BOOLEAN_TRUE_WORDS = new Set([
  'true',
  't',
  'yes',
  'y',
  '对',
  '正确',
  '是',
  '√',
  '✓'
])

/** Words normalised to the boolean literal `false` for true/false questions. */
const BOOLEAN_FALSE_WORDS = new Set([
  'false',
  'f',
  'no',
  'n',
  '错',
  '错误',
  '否',
  '×',
  '✗'
])

/** Option delimiters: ASCII + full-width commas/semicolons/enumeration comma. */
const OPTION_SEPARATORS = /[\s,;，、；]+/

interface Outcome {
  state: 'passed' | 'failed'
  actual: string
  message: string
}

type ObjectiveSpec = ChoiceRunnerSpec | FillBlankRunnerSpec | NumericRunnerSpec

/**
 * Collapse a raw token to its boolean literal when it names one, otherwise
 * return the trimmed token unchanged (preserving case for real option ids
 * like `A`/`B`). Boolean matching is therefore case-insensitive while ordinary
 * option matching stays case-sensitive.
 */
function normalizeToken(raw: string): string {
  const trimmed = raw.trim()
  const lower = trimmed.toLowerCase()
  if (BOOLEAN_TRUE_WORDS.has(lower)) return 'true'
  if (BOOLEAN_FALSE_WORDS.has(lower)) return 'false'
  return trimmed
}

function parseOptionSet(raw: string): Set<string> {
  const tokens = raw
    .split(OPTION_SEPARATORS)
    .map((token) => normalizeToken(token))
    .filter((token) => token.length > 0)
  return new Set(tokens)
}

function setsEqual(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false
  for (const value of left) {
    if (!right.has(value)) return false
  }
  return true
}

/** Round a float to a stable, human-readable string (strips FP noise). */
function formatNumber(value: number): string {
  return String(Number(value.toFixed(9)))
}

function evaluateChoice(spec: ChoiceRunnerSpec, submission: string): Outcome {
  const submitted = parseOptionSet(submission)
  const correct = new Set(
    spec.correctOptionIds
      .map((option) => normalizeToken(option))
      .filter((option) => option.length > 0)
  )
  const passed = setsEqual(submitted, correct)
  const actual = submitted.size > 0 ? [...submitted].join(', ') : '(空)'
  const expected = [...correct].join(', ')
  return {
    state: passed ? 'passed' : 'failed',
    actual,
    message: passed
      ? '选项集合与标准答案一致（顺序无关）'
      : `选项集合不匹配，标准答案为 ${expected}`
  }
}

function evaluateFillBlank(spec: FillBlankRunnerSpec, submission: string): Outcome {
  const normalize = (value: string): string => {
    const collapsed = value.trim().replace(/\s+/g, ' ')
    return spec.caseSensitive ? collapsed : collapsed.toLowerCase()
  }
  const submitted = normalize(submission)
  const accepted = spec.acceptedAnswers.map((answer) => normalize(answer))
  const passed = accepted.includes(submitted)
  return {
    state: passed ? 'passed' : 'failed',
    actual: submitted.length > 0 ? submitted : '(空)',
    message: passed
      ? '填空与可接受答案匹配'
      : `填空未命中任一可接受答案（共 ${accepted.length} 个）`
  }
}

function evaluateNumeric(spec: NumericRunnerSpec, submission: string): Outcome {
  const trimmed = submission.trim()
  const actual = Number(trimmed)
  if (trimmed.length === 0 || Number.isNaN(actual)) {
    return {
      state: 'failed',
      actual: trimmed.length > 0 ? trimmed : '(空)',
      message: '提交无法解析为数值'
    }
  }
  const diff = Math.abs(actual - spec.expected)
  const passed = diff <= spec.tolerance
  return {
    state: passed ? 'passed' : 'failed',
    actual: formatNumber(actual),
    message: passed
      ? `数值在容差范围内（|${formatNumber(actual)} - ${formatNumber(spec.expected)}| = ${formatNumber(diff)} ≤ ${formatNumber(spec.tolerance)}）`
      : `数值超出容差（误差 ${formatNumber(diff)} > 容差 ${formatNumber(spec.tolerance)}）`
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled objective spec: ${JSON.stringify(value)}`)
}

function evaluateSpec(spec: ObjectiveSpec, submission: string): Outcome {
  switch (spec.kind) {
    case 'choice':
      return evaluateChoice(spec, submission)
    case 'fill_blank':
      return evaluateFillBlank(spec, submission)
    case 'numeric':
      return evaluateNumeric(spec, submission)
    default:
      return assertNever(spec)
  }
}

/**
 * Resolve the evidence id so it aligns with the assignment's `answer_match`
 * criterion (EvaluationAgent joins runner evidence to criteria by id). Falls
 * back to a stable default when no criterion is declared.
 */
function resolveEvidenceId(assignment: ExecutableAssignment): string {
  const criterion = assignment.criteria.find((item) => item.kind === 'answer_match')
  return criterion?.id ?? 'answer-match'
}

export class ObjectiveValidator implements CodeRunner {
  public readonly name = 'objective-validator'

  public run(request: RunnerRequest): Promise<RunnerResult> {
    const startedAt = performance.now()
    const build = (partial: Omit<RunnerResult, 'durationMs'>): RunnerResult => ({
      ...partial,
      durationMs: Math.max(1, Math.round(performance.now() - startedAt))
    })

    const spec = request.assignment.runner

    if (!('kind' in spec)) {
      return Promise.resolve(
        build({
          status: 'failed',
          evidence: [],
          reason: '客观题验证器不支持代码题型（PythonRunnerSpec）。'
        })
      )
    }

    if (spec.kind === 'expression' || spec.kind === 'chem_equation' || spec.kind === 'essay') {
      return Promise.resolve(
        build({
          status: 'failed',
          evidence: [],
          reason: `客观题验证器暂不支持题型 ${spec.kind}（仅 choice/fill_blank/numeric）。`
        })
      )
    }

    let submission: string
    try {
      submission = resolveSubmission(request)
    } catch (error) {
      return Promise.resolve(
        build({
          status: 'failed',
          evidence: [],
          reason: error instanceof Error ? error.message : '缺少提交内容。'
        })
      )
    }

    const outcome = evaluateSpec(spec, submission)
    const evidence: RunnerEvidence[] = [
      {
        id: resolveEvidenceId(request.assignment),
        state: outcome.state,
        actual: outcome.actual,
        message: outcome.message
      }
    ]

    return Promise.resolve(build({ status: 'completed', evidence }))
  }
}
