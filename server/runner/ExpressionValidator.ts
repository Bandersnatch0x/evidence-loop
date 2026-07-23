import {
  evaluate,
  parse,
  rationalize,
  simplify,
  type MathNode
} from 'mathjs'
import type { CodeRunner, RunnerEvidence, RunnerRequest, RunnerResult } from './types'
import { resolveSubmission } from './types'

const DEFAULT_TIMEOUT_MS = 2_000
const DEFAULT_NUMERICAL_TRIALS = 24
const DEFAULT_NUMERICAL_TOLERANCE = 1e-8
const NUMERICAL_SAMPLE_RANGE = 10

/**
 * Local read of ExpressionRunnerSpec (+ optional steps).
 * Does not modify assignments.ts — runtime shape only.
 */
export interface ExpressionRunnerConfig {
  readonly kind: 'expression'
  /** Expected final expression (mathjs-friendly or light LaTeX). */
  expectedLatex: string
  /**
   * Optional derivation chain for consecutive CAS checks
   * (simplify(step_n - step_{n+1}) == 0).
   */
  steps?: readonly string[]
}

export interface ExpressionValidatorOptions {
  /** Wall-clock budget for a single run (parse failures / hangs → blocked). */
  timeoutMs?: number
  /** Random substitution trials when symbolic identity is uncertain. */
  numericalTrials?: number
  /** Absolute tolerance for numerical equivalence. */
  numericalTolerance?: number
}

export interface ParsedExpressionSubmission {
  /** Final answer expression (mathjs form). */
  answer: string
  /** Intermediate steps if provided (may exclude final). */
  steps: string[]
}

type EquivalenceVerdict = 'equal' | 'unequal' | 'uncertain'

/** Expansion rules so simplify can reduce binomial forms to polynomials. */
const EXPANSION_RULES = [
  ...simplify.rules,
  { l: '(n1+n2)^2', r: 'n1^2 + 2*n1*n2 + n2^2' },
  { l: '(n1-n2)^2', r: 'n1^2 - 2*n1*n2 + n2^2' },
  { l: '(n1+n2)^3', r: 'n1^3 + 3*n1^2*n2 + 3*n1*n2^2 + n2^3' },
  { l: '(n1-n2)^3', r: 'n1^3 - 3*n1^2*n2 + 3*n1*n2^2 - n2^3' },
  { l: 'n1*(n2+n3)', r: 'n1*n2 + n1*n3' },
  { l: '(n1+n2)*n3', r: 'n1*n3 + n2*n3' },
  { l: 'n1*(n2-n3)', r: 'n1*n2 - n1*n3' },
  { l: '(n1-n2)*n3', r: 'n1*n3 - n2*n3' }
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isExpressionRunnerConfig(value: unknown): value is ExpressionRunnerConfig {
  if (!isRecord(value)) return false
  if (value.kind !== 'expression') return false
  if (typeof value.expectedLatex !== 'string') return false
  if (value.steps !== undefined) {
    if (!Array.isArray(value.steps)) return false
    if (!value.steps.every((step) => typeof step === 'string')) return false
  }
  return true
}

/**
 * Normalize light LaTeX / display forms into mathjs-parseable text.
 * Full LaTeX is out of scope; this covers common homework forms.
 */
export function normalizeExpression(raw: string): string {
  let text = raw.trim()
  if (text.startsWith('$') && text.endsWith('$')) {
    text = text.slice(1, -1).trim()
  }
  text = text
    .replace(/\\left/g, '')
    .replace(/\\right/g, '')
    .replace(/\\cdot/g, '*')
    .replace(/\\times/g, '*')
    .replace(/\\div/g, '/')
    .replace(/\\pm/g, '+')
    .replace(/\\dfrac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, '($1)/($2)')
    .replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, '($1)/($2)')
    .replace(/\\sqrt\s*\{([^{}]+)\}/g, 'sqrt($1)')
    .replace(/\^{([^{}]+)}/g, '^($1)')
    .replace(/\{([^{}]+)\}/g, '($1)')
    .replace(/\\/g, '')
    .replace(/\s+/g, '')
  return text
}

export function parseExpressionSubmission(raw: string): ParsedExpressionSubmission {
  const trimmed = raw.trim()
  if (!trimmed) {
    throw new Error('提交内容为空')
  }

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed) as unknown
    } catch {
      throw new Error('提交 JSON 无法解析')
    }

    if (Array.isArray(parsed)) {
      if (!parsed.every((item) => typeof item === 'string')) {
        throw new Error('步骤数组必须全为字符串')
      }
      if (parsed.length === 0) {
        throw new Error('步骤数组为空')
      }
      const steps = parsed.map((item) => normalizeExpression(item))
      const answer = steps[steps.length - 1] ?? ''
      return { answer, steps: steps.slice(0, -1).concat(answer) }
    }

    if (!isRecord(parsed)) {
      throw new Error('提交 JSON 格式无效')
    }

    const answerRaw =
      typeof parsed.answer === 'string'
        ? parsed.answer
        : typeof parsed.final === 'string'
          ? parsed.final
          : typeof parsed.expression === 'string'
            ? parsed.expression
            : undefined
    if (answerRaw === undefined) {
      throw new Error('提交 JSON 缺少 answer/final/expression 字段')
    }

    const stepsRaw = parsed.steps
    const steps: string[] = []
    if (stepsRaw !== undefined) {
      if (!Array.isArray(stepsRaw) || !stepsRaw.every((s) => typeof s === 'string')) {
        throw new Error('steps 必须为字符串数组')
      }
      for (const step of stepsRaw) {
        steps.push(normalizeExpression(step))
      }
    }

    const answer = normalizeExpression(answerRaw)
    if (steps.length === 0) {
      return { answer, steps: [answer] }
    }
    const last = steps[steps.length - 1]
    if (last !== answer) {
      steps.push(answer)
    }
    return { answer, steps }
  }

  // Multi-line: each non-empty line is a step; last is the final answer.
  if (trimmed.includes('\n')) {
    const lines = trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => normalizeExpression(line))
    if (lines.length === 0) {
      throw new Error('提交内容为空')
    }
    const answer = lines[lines.length - 1] ?? ''
    return { answer, steps: lines }
  }

  const answer = normalizeExpression(trimmed)
  return { answer, steps: [answer] }
}

function isZeroNode(node: MathNode): boolean {
  const text = node.toString().replace(/\s+/g, '')
  return text === '0' || text === '0.0' || text === '-0'
}

function isConstantNode(node: MathNode): boolean {
  try {
    const simplified = simplify(node)
    // Constants evaluate without a scope.
    const value: unknown = evaluate(simplified.toString())
    return typeof value === 'number' && Number.isFinite(value)
  } catch {
    return false
  }
}

/**
 * Symbolic identity: simplify(student - expected) ≡ 0.
 * Uses simplify + rationalize + expansion rules; returns uncertain when CAS
 * cannot decide (caller may apply numerical fallback).
 */
export function symbolicEquivalence(
  leftRaw: string,
  rightRaw: string
): EquivalenceVerdict {
  const left = normalizeExpression(leftRaw)
  const right = normalizeExpression(rightRaw)

  try {
    parse(left)
    parse(right)
  } catch {
    throw new Error(`表达式解析失败：${leftRaw} 或 ${rightRaw}`)
  }

  if (left === right) {
    return 'equal'
  }

  const diffSource = `(${left})-(${right})`

  try {
    const simplified = simplify(diffSource)
    if (isZeroNode(simplified)) {
      return 'equal'
    }
  } catch {
    // continue
  }

  try {
    const expanded = simplify(diffSource, EXPANSION_RULES)
    if (isZeroNode(expanded)) {
      return 'equal'
    }
    // Clearly a non-zero constant → unequal
    if (isConstantNode(expanded)) {
      const value: unknown = evaluate(expanded.toString())
      if (typeof value === 'number' && Math.abs(value) > 1e-12) {
        return 'unequal'
      }
      if (typeof value === 'number' && Math.abs(value) <= 1e-12) {
        return 'equal'
      }
    }
  } catch {
    // continue
  }

  try {
    const rat = rationalize(diffSource)
    if (isZeroNode(rat)) {
      return 'equal'
    }
    if (isConstantNode(rat)) {
      const value: unknown = evaluate(rat.toString())
      if (typeof value === 'number' && Math.abs(value) > 1e-12) {
        return 'unequal'
      }
      if (typeof value === 'number' && Math.abs(value) <= 1e-12) {
        return 'equal'
      }
    }
  } catch {
    // continue
  }

  // Compare fully expanded/simplified strings
  try {
    const leftCanon = simplify(left, EXPANSION_RULES).toString().replace(/\s+/g, '')
    const rightCanon = simplify(right, EXPANSION_RULES).toString().replace(/\s+/g, '')
    if (leftCanon === rightCanon) {
      return 'equal'
    }
  } catch {
    // continue
  }

  return 'uncertain'
}

function isSymbolNode(node: MathNode): node is MathNode & { name: string } {
  return node.type === 'SymbolNode' && 'name' in node && typeof (node as { name: unknown }).name === 'string'
}

function collectSymbols(raw: string): string[] {
  const node = parse(raw)
  const names = new Set<string>()
  node.traverse((child: MathNode) => {
    if (!isSymbolNode(child)) return
    // Skip math constants / functions that appear as symbols
    if (child.name === 'e' || child.name === 'pi' || child.name === 'i') return
    names.add(child.name)
  })
  return [...names].sort()
}

/**
 * Multi-point random substitution when symbolic CAS is uncertain.
 * Returns equal only if all finite samples match within tolerance.
 */
export function numericalEquivalence(
  leftRaw: string,
  rightRaw: string,
  options: {
    trials: number
    tolerance: number
    /** Deterministic seed for reproducible tests (mulberry32). */
    seed?: number
  }
): EquivalenceVerdict {
  const left = normalizeExpression(leftRaw)
  const right = normalizeExpression(rightRaw)

  let symbols: string[]
  try {
    symbols = [...new Set([...collectSymbols(left), ...collectSymbols(right)])]
  } catch {
    throw new Error('数值校验前解析失败')
  }

  let state = options.seed ?? (0xa55c11e ^ (left.length * 31 + right.length))
  const nextRandom = (): number => {
    // mulberry32
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  let finiteComparisons = 0

  for (let trial = 0; trial < options.trials; trial++) {
    const scope: Record<string, number> = {}
    for (const name of symbols) {
      // Avoid exact zero which can hide division issues asymmetrically
      let value = (nextRandom() * 2 - 1) * NUMERICAL_SAMPLE_RANGE
      if (Math.abs(value) < 0.05) {
        value = value >= 0 ? 0.5 : -0.5
      }
      scope[name] = value
    }

    let leftValue: unknown
    let rightValue: unknown
    try {
      leftValue = evaluate(left, scope)
      rightValue = evaluate(right, scope)
    } catch {
      // Domain error for this sample — skip
      continue
    }

    if (typeof leftValue !== 'number' || typeof rightValue !== 'number') {
      continue
    }
    if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) {
      continue
    }

    finiteComparisons += 1
    if (Math.abs(leftValue - rightValue) > options.tolerance) {
      return 'unequal'
    }
  }

  if (finiteComparisons === 0) {
    // Constant expressions with no free symbols
    if (symbols.length === 0) {
      try {
        const lv: unknown = evaluate(left)
        const rv: unknown = evaluate(right)
        if (
          typeof lv === 'number' &&
          typeof rv === 'number' &&
          Number.isFinite(lv) &&
          Number.isFinite(rv)
        ) {
          return Math.abs(lv - rv) <= options.tolerance ? 'equal' : 'unequal'
        }
      } catch {
        return 'uncertain'
      }
    }
    return 'uncertain'
  }

  return 'equal'
}

export function expressionsEquivalent(
  left: string,
  right: string,
  options: {
    numericalTrials: number
    numericalTolerance: number
    seed?: number
  }
): { equal: boolean; method: 'symbolic' | 'numerical'; detail: string } {
  const symbolic = symbolicEquivalence(left, right)
  if (symbolic === 'equal') {
    return {
      equal: true,
      method: 'symbolic',
      detail: 'simplify(subtract(left, right)) ≡ 0'
    }
  }
  if (symbolic === 'unequal') {
    return {
      equal: false,
      method: 'symbolic',
      detail: 'simplify(subtract(left, right)) 为非零常数'
    }
  }

  const numerical = numericalEquivalence(left, right, {
    trials: options.numericalTrials,
    tolerance: options.numericalTolerance,
    seed: options.seed
  })

  if (numerical === 'equal') {
    return {
      equal: true,
      method: 'numerical',
      detail: `符号简化不确定，${options.numericalTrials} 次随机代入数值一致`
    }
  }
  if (numerical === 'unequal') {
    return {
      equal: false,
      method: 'numerical',
      detail: '符号简化不确定，随机代入数值不一致'
    }
  }

  return {
    equal: false,
    method: 'numerical',
    detail: '符号与数值均无法确认等价，按失败处理'
  }
}

function runWithTimeout<T>(fn: () => T, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error(`CAS 校验超时（>${timeoutMs}ms）`))
    }, timeoutMs)

    // Defer to allow the timer to be scheduled before heavy sync work starts
    // on the next microtask when expressions are large.
    queueMicrotask(() => {
      if (settled) return
      try {
        const result = fn()
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(result)
      } catch (error) {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  })
}

/**
 * CAS-based expression validator for math/physics expression questions.
 * Produces cas_check-style RunnerEvidence (ids consumable by EvaluationAgent).
 */
export class ExpressionValidator implements CodeRunner {
  public readonly name = 'expression-cas'

  private readonly timeoutMs: number
  private readonly numericalTrials: number
  private readonly numericalTolerance: number

  public constructor(options: ExpressionValidatorOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.numericalTrials = options.numericalTrials ?? DEFAULT_NUMERICAL_TRIALS
    this.numericalTolerance = options.numericalTolerance ?? DEFAULT_NUMERICAL_TOLERANCE
  }

  public async run(request: RunnerRequest): Promise<RunnerResult> {
    const startedAt = performance.now()

    try {
      return await runWithTimeout(() => this.runSync(request, startedAt), this.timeoutMs)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const isTimeout = message.includes('超时')
      return {
        status: 'completed',
        durationMs: Math.round(performance.now() - startedAt),
        evidence: [
          {
            id: 'cas-final',
            state: 'blocked',
            message: isTimeout
              ? message
              : `CAS 校验失败：${message}`
          }
        ],
        reason: message
      }
    }
  }

  private runSync(request: RunnerRequest, startedAt: number): RunnerResult {
    const runner = request.assignment.runner
    if (!isExpressionRunnerConfig(runner)) {
      return {
        status: 'failed',
        durationMs: Math.round(performance.now() - startedAt),
        evidence: [],
        reason: 'ExpressionValidator 需要 kind: "expression" 的 RunnerSpec'
      }
    }

    let submission: ParsedExpressionSubmission
    try {
      submission = parseExpressionSubmission(resolveSubmission(request))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        status: 'completed',
        durationMs: Math.round(performance.now() - startedAt),
        evidence: [
          {
            id: 'cas-final',
            state: 'blocked',
            actual: resolveSubmissionSafe(request),
            message: `提交解析失败：${message}`
          }
        ]
      }
    }

    const expected = normalizeExpression(runner.expectedLatex)
    const evidence: RunnerEvidence[] = []

    // Optional step-chain checks: student steps take precedence; else spec.steps
    const chain =
      submission.steps.length > 1
        ? submission.steps
        : runner.steps && runner.steps.length > 1
          ? runner.steps.map((step) => normalizeExpression(step))
          : []

    if (chain.length > 1) {
      for (let index = 0; index < chain.length - 1; index++) {
        const current = chain[index] ?? ''
        const next = chain[index + 1] ?? ''
        const stepId = `cas-step-${index}-${index + 1}`
        try {
          // Validate both parse before CAS
          parse(current)
          parse(next)
          const verdict = expressionsEquivalent(current, next, {
            numericalTrials: this.numericalTrials,
            numericalTolerance: this.numericalTolerance,
            seed: index + 1
          })
          evidence.push({
            id: stepId,
            state: verdict.equal ? 'passed' : 'failed',
            actual: `${current} → ${next}`,
            message: verdict.equal
              ? `步骤 ${index + 1}→${index + 2} 代数等价（${verdict.method}）`
              : `步骤 ${index + 1}→${index + 2} 代数不等价：${verdict.detail}`
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          evidence.push({
            id: stepId,
            state: 'blocked',
            actual: `${current} → ${next}`,
            message: `步骤解析/校验失败：${message}`
          })
        }
      }
    }

    // Final answer equivalence
    try {
      parse(submission.answer)
      parse(expected)
      const verdict = expressionsEquivalent(submission.answer, expected, {
        numericalTrials: this.numericalTrials,
        numericalTolerance: this.numericalTolerance,
        seed: 99
      })
      evidence.push({
        id: 'cas-final',
        state: verdict.equal ? 'passed' : 'failed',
        actual: submission.answer,
        message: verdict.equal
          ? `最终答案与期望代数等价（${verdict.method}）`
          : `最终答案与期望不等价：${verdict.detail}`
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      evidence.push({
        id: 'cas-final',
        state: 'blocked',
        actual: submission.answer,
        message: `表达式解析失败：${message}`
      })
    }

    return {
      status: 'completed',
      durationMs: Math.round(performance.now() - startedAt),
      evidence
    }
  }
}

function resolveSubmissionSafe(request: RunnerRequest): string | undefined {
  try {
    return resolveSubmission(request)
  } catch {
    return request.submission ?? request.code
  }
}
