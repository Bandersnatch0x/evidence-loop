import type { ChemEquationRunnerSpec, RunnerSpec } from '../data/assignments'
import type {
  CodeRunner,
  RunnerEvidence,
  RunnerRequest,
  RunnerResult
} from './types'
import { resolveSubmission } from './types'

/** Element → atom count for a single formula unit (coefficient not applied). */
export type ElementCounts = ReadonlyMap<string, number>

export interface ParsedSpecies {
  /** Leading stoichiometric coefficient (default 1). */
  readonly coefficient: number
  /** Formula without coefficient or charge (e.g. `Ca(OH)2`). */
  readonly formula: string
  /** Net ionic charge of one formula unit (0 for neutrals). */
  readonly charge: number
  /** Atom counts for one formula unit. */
  readonly atoms: ElementCounts
}

export interface ParsedEquation {
  readonly reactants: readonly ParsedSpecies[]
  readonly products: readonly ParsedSpecies[]
  /** Original normalized text. */
  readonly raw: string
}

export class ChemParseError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'ChemParseError'
  }
}

const EVIDENCE_ID = 'cas_check'

function isChemEquationRunnerSpec(spec: RunnerSpec): spec is ChemEquationRunnerSpec {
  return (
    typeof spec === 'object' &&
    spec !== null &&
    'kind' in spec &&
    (spec as { kind?: unknown }).kind === 'chem_equation' &&
    'expectedEquation' in spec &&
    typeof (spec as { expectedEquation?: unknown }).expectedEquation === 'string'
  )
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y !== 0) {
    const t = y
    y = x % y
    x = t
  }
  return x === 0 ? 1 : x
}

function gcdAll(values: readonly number[]): number {
  if (values.length === 0) return 1
  return values.reduce((acc, n) => gcd(acc, n), values[0] ?? 1)
}

function mergeCounts(
  target: Map<string, number>,
  source: ElementCounts,
  multiplier: number
): void {
  for (const [element, count] of source) {
    target.set(element, (target.get(element) ?? 0) + count * multiplier)
  }
}

/**
 * Parse a chemical formula into element counts (one formula unit).
 * Supports nested parentheses and numeric subscripts: H2O, Ca(OH)2, Fe2(SO4)3.
 */
export function parseFormula(formula: string): ElementCounts {
  const trimmed = formula.trim()
  if (trimmed.length === 0) {
    throw new ChemParseError('化学式为空')
  }

  const { counts, next } = parseGroup(trimmed, 0)
  if (next !== trimmed.length) {
    throw new ChemParseError(`化学式无法完全解析：${formula}`)
  }
  if (counts.size === 0) {
    throw new ChemParseError(`化学式不含元素：${formula}`)
  }
  return counts
}

function parseGroup(
  input: string,
  start: number
): { counts: Map<string, number>; next: number } {
  const counts = new Map<string, number>()
  let i = start

  while (i < input.length) {
    const ch = input[i]
    if (ch === undefined) break

    if (ch === ')') {
      break
    }

    if (ch === '(') {
      const inner = parseGroup(input, i + 1)
      if (input[inner.next] !== ')') {
        throw new ChemParseError(`括号未闭合：${input}`)
      }
      let j = inner.next + 1
      const { value: mult, next: afterNum } = readNumber(input, j)
      j = afterNum
      mergeCounts(counts, inner.counts, mult)
      i = j
      continue
    }

    if (ch < 'A' || ch > 'Z') {
      throw new ChemParseError(`意外字符 '${ch}' 于化学式：${input}`)
    }

    let j = i + 1
    if (j < input.length) {
      const lower = input[j]
      if (lower !== undefined && lower >= 'a' && lower <= 'z') {
        j += 1
      }
    }
    const element = input.slice(i, j)
    const { value: mult, next: afterNum } = readNumber(input, j)
    counts.set(element, (counts.get(element) ?? 0) + mult)
    i = afterNum
  }

  return { counts, next: i }
}

function readNumber(input: string, start: number): { value: number; next: number } {
  let i = start
  while (i < input.length) {
    const ch = input[i]
    if (ch === undefined || ch < '0' || ch > '9') break
    i += 1
  }
  if (i === start) {
    return { value: 1, next: start }
  }
  const raw = input.slice(start, i)
  const value = Number.parseInt(raw, 10)
  if (!Number.isFinite(value) || value <= 0) {
    throw new ChemParseError(`非法下标：${raw}`)
  }
  return { value, next: i }
}

/**
 * Strip ionic charge suffix from a species token.
 * Accepts: +, -, 2+, 3-, ^2+, ^2-, ^{2+}, ^{2-}, ^{+}, ^{-}.
 */
export function splitCharge(token: string): { body: string; charge: number } {
  const caretBrace = token.match(/^(.*?)\^\{([0-9]*)([+-])\}$/)
  if (caretBrace) {
    const body = caretBrace[1] ?? ''
    const digits = caretBrace[2] ?? ''
    const sign = caretBrace[3] ?? '+'
    const magnitude = digits === '' ? 1 : Number.parseInt(digits, 10)
    return { body, charge: sign === '-' ? -magnitude : magnitude }
  }

  const caret = token.match(/^(.*?)\^([0-9]*)([+-])$/)
  if (caret) {
    const body = caret[1] ?? ''
    const digits = caret[2] ?? ''
    const sign = caret[3] ?? '+'
    const magnitude = digits === '' ? 1 : Number.parseInt(digits, 10)
    return { body, charge: sign === '-' ? -magnitude : magnitude }
  }

  // Trailing n+ / n- / + / - (prefer charge over subscript for trailing digits+sign)
  const plain = token.match(/^(.*?)([0-9]+)?([+-])$/)
  if (plain && plain[3] !== undefined) {
    const body = plain[1] ?? ''
    // Reject empty body or body that is only digits
    if (body.length > 0 && /[A-Za-z)]/.test(body)) {
      const digits = plain[2]
      const sign = plain[3]
      const magnitude = digits === undefined || digits === '' ? 1 : Number.parseInt(digits, 10)
      return { body, charge: sign === '-' ? -magnitude : magnitude }
    }
  }

  return { body: token, charge: 0 }
}

/**
 * Parse one species token such as `2H2O`, `Ca(OH)2`, `Fe2+`, `2OH-`.
 */
export function parseSpecies(token: string): ParsedSpecies {
  const cleaned = token.replace(/\s+/g, '')
  if (cleaned.length === 0) {
    throw new ChemParseError('物种为空')
  }

  let i = 0
  while (i < cleaned.length) {
    const ch = cleaned[i]
    if (ch === undefined || ch < '0' || ch > '9') break
    i += 1
  }

  let coefficient = 1
  let rest = cleaned
  if (i > 0) {
    // Leading digits are coefficient only when followed by element or '('
    const next = cleaned[i]
    if (next !== undefined && ((next >= 'A' && next <= 'Z') || next === '(' || next === '[')) {
      coefficient = Number.parseInt(cleaned.slice(0, i), 10)
      if (!Number.isFinite(coefficient) || coefficient <= 0) {
        throw new ChemParseError(`非法系数：${cleaned.slice(0, i)}`)
      }
      rest = cleaned.slice(i)
    }
  }

  if (rest.length === 0) {
    throw new ChemParseError(`缺少化学式：${token}`)
  }

  const { body, charge } = splitCharge(rest)
  if (body.length === 0) {
    throw new ChemParseError(`缺少化学式：${token}`)
  }

  // Allow optional square brackets as grouping alias: [Cu(NH3)4]
  const formulaBody = body.replace(/^\[/, '').replace(/\]$/, '')
  const atoms = parseFormula(formulaBody)

  return {
    coefficient,
    formula: formulaBody,
    charge,
    atoms
  }
}

function splitSide(side: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''

  for (let i = 0; i < side.length; i += 1) {
    const ch = side[i]
    if (ch === undefined) continue
    if (ch === '(' || ch === '[' || ch === '{') depth += 1
    if (ch === ')' || ch === ']' || ch === '}') depth -= 1

    if (ch === '+' && depth === 0) {
      // Species separator vs ionic charge trailing '+'.
      // Separator when the next token looks like a new species (digit, element, or group).
      // Charge '+' is followed by end-of-string, another '+', or non-species chars.
      const next = side[i + 1]
      const nextStartsSpecies =
        next !== undefined &&
        ((next >= '0' && next <= '9') ||
          (next >= 'A' && next <= 'Z') ||
          next === '(' ||
          next === '[')
      if (nextStartsSpecies) {
        parts.push(current)
        current = ''
        continue
      }
    }
    current += ch
  }

  if (current.length > 0) {
    parts.push(current)
  }

  if (parts.length === 0) {
    throw new ChemParseError('方程式一侧为空')
  }

  return parts.map((p) => p.trim()).filter((p) => p.length > 0)
}

/**
 * Parse a full chemical equation.
 * Accepts `=`, `->`, `→`, `⇒`, `-->` as separators between reactants and products.
 */
export function parseEquation(equation: string): ParsedEquation {
  const raw = equation.trim()
  if (raw.length === 0) {
    throw new ChemParseError('方程式为空')
  }

  const normalized = raw
    .replace(/\s+/g, '')
    .replace(/-->/g, '→')
    .replace(/->/g, '→')
    .replace(/⇒/g, '→')
    .replace(/=/g, '→')

  const sides = normalized.split('→')
  if (sides.length !== 2) {
    throw new ChemParseError('方程式必须恰好包含一个反应箭头（= 或 ->）')
  }

  const left = sides[0] ?? ''
  const right = sides[1] ?? ''
  if (left.length === 0 || right.length === 0) {
    throw new ChemParseError('反应物或生成物为空')
  }

  const reactants = splitSide(left).map(parseSpecies)
  const products = splitSide(right).map(parseSpecies)

  return { reactants, products, raw: normalized }
}

export interface BalanceReport {
  readonly balanced: boolean
  readonly atomDiff: ReadonlyMap<string, number>
  readonly chargeDiff: number
  readonly messages: readonly string[]
}

/** Check mass (atom) and charge conservation. */
export function checkBalance(equation: ParsedEquation): BalanceReport {
  const leftAtoms = new Map<string, number>()
  const rightAtoms = new Map<string, number>()
  let leftCharge = 0
  let rightCharge = 0

  for (const sp of equation.reactants) {
    mergeCounts(leftAtoms, sp.atoms, sp.coefficient)
    leftCharge += sp.charge * sp.coefficient
  }
  for (const sp of equation.products) {
    mergeCounts(rightAtoms, sp.atoms, sp.coefficient)
    rightCharge += sp.charge * sp.coefficient
  }

  const elements = new Set<string>([...leftAtoms.keys(), ...rightAtoms.keys()])
  const atomDiff = new Map<string, number>()
  const messages: string[] = []

  for (const el of [...elements].sort()) {
    const diff = (leftAtoms.get(el) ?? 0) - (rightAtoms.get(el) ?? 0)
    if (diff !== 0) {
      atomDiff.set(el, diff)
      messages.push(
        `元素 ${el} 不守恒（反应物 ${(leftAtoms.get(el) ?? 0)}，生成物 ${(rightAtoms.get(el) ?? 0)}）`
      )
    }
  }

  const chargeDiff = leftCharge - rightCharge
  if (chargeDiff !== 0) {
    messages.push(`电荷不守恒（反应物 ${leftCharge}，生成物 ${rightCharge}）`)
  }

  return {
    balanced: atomDiff.size === 0 && chargeDiff === 0,
    atomDiff,
    chargeDiff,
    messages
  }
}

/** Signature of a species independent of coefficient (formula + charge). */
function speciesKey(sp: ParsedSpecies): string {
  return `${sp.formula}|${sp.charge}`
}

/** Aggregate coefficients by species key on one side. */
function sideMap(species: readonly ParsedSpecies[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const sp of species) {
    map.set(speciesKey(sp), (map.get(speciesKey(sp)) ?? 0) + sp.coefficient)
  }
  return map
}

/**
 * Compare student equation to expected: same species on each side and
 * coefficients in the same simplest integer ratio (overall multiples allowed).
 */
export function compareEquations(
  student: ParsedEquation,
  expected: ParsedEquation
): { match: boolean; message: string } {
  const sLeft = sideMap(student.reactants)
  const sRight = sideMap(student.products)
  const eLeft = sideMap(expected.reactants)
  const eRight = sideMap(expected.products)

  const leftKeys = new Set([...sLeft.keys(), ...eLeft.keys()])
  const rightKeys = new Set([...sRight.keys(), ...eRight.keys()])

  for (const key of leftKeys) {
    if ((sLeft.get(key) ?? 0) === 0 || (eLeft.get(key) ?? 0) === 0) {
      return {
        match: false,
        message: `反应物物种不一致（期望与提交的物质组成不同）`
      }
    }
  }
  for (const key of rightKeys) {
    if ((sRight.get(key) ?? 0) === 0 || (eRight.get(key) ?? 0) === 0) {
      return {
        match: false,
        message: `生成物物种不一致（期望与提交的物质组成不同）`
      }
    }
  }

  // Collect coefficient pairs for ratio check (student / expected)
  const pairs: Array<{ s: number; e: number }> = []

  for (const key of leftKeys) {
    const s = sLeft.get(key) ?? 0
    const e = eLeft.get(key) ?? 0
    pairs.push({ s, e })
  }
  for (const key of rightKeys) {
    const s = sRight.get(key) ?? 0
    const e = eRight.get(key) ?? 0
    pairs.push({ s, e })
  }

  // Reduce expected and student vectors by their own GCD, then compare
  const studentCoeffs = pairs.map((p) => p.s)
  const expectedCoeffs = pairs.map((p) => p.e)
  const gS = gcdAll(studentCoeffs)
  const gE = gcdAll(expectedCoeffs)

  for (const p of pairs) {
    const ns = p.s / gS
    const ne = p.e / gE
    if (ns !== ne) {
      return {
        match: false,
        message: '系数比与标准答案不一致（约简后的化学计量比不同）'
      }
    }
  }

  return { match: true, message: '配平正确且系数比与标准答案一致' }
}

function durationSince(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt))
}

function evidence(
  state: RunnerEvidence['state'],
  message: string,
  actual?: string
): RunnerEvidence {
  return {
    id: EVIDENCE_ID,
    state,
    message,
    ...(actual !== undefined ? { actual } : {})
  }
}

/**
 * Deterministic chemical-equation balancing validator.
 * Produces a single `cas_check` evidence atom; parse failures yield `blocked`.
 */
export class ChemEquationValidator implements CodeRunner {
  public readonly name = 'chem-equation'

  public run(request: RunnerRequest): Promise<RunnerResult> {
    return Promise.resolve(this.evaluate(request))
  }

  private evaluate(request: RunnerRequest): RunnerResult {
    const startedAt = performance.now()

    try {
      const runnerSpec = request.assignment.runner
      if (!isChemEquationRunnerSpec(runnerSpec)) {
        return {
          status: 'failed',
          durationMs: durationSince(startedAt),
          reason: 'ChemEquationValidator requires ChemEquationRunnerSpec (kind: chem_equation).',
          evidence: [
            evidence('blocked', '运行器配置不是 chem_equation 类型')
          ]
        }
      }

      let submission: string
      try {
        submission = resolveSubmission(request)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          status: 'completed',
          durationMs: durationSince(startedAt),
          evidence: [evidence('blocked', `提交内容缺失：${message}`)]
        }
      }

      const submissionText = submission.trim()
      if (submissionText.length === 0) {
        return {
          status: 'completed',
          durationMs: durationSince(startedAt),
          evidence: [evidence('blocked', '提交的方程式为空', submission)]
        }
      }

      let studentEq: ParsedEquation
      try {
        studentEq = parseEquation(submissionText)
      } catch (error) {
        const message = error instanceof ChemParseError ? error.message : String(error)
        return {
          status: 'completed',
          durationMs: durationSince(startedAt),
          evidence: [evidence('blocked', `无法解析学生方程式：${message}`, submissionText)]
        }
      }

      let expectedEq: ParsedEquation
      try {
        expectedEq = parseEquation(runnerSpec.expectedEquation)
      } catch (error) {
        const message = error instanceof ChemParseError ? error.message : String(error)
        return {
          status: 'failed',
          durationMs: durationSince(startedAt),
          reason: `标准答案方程式无法解析：${message}`,
          evidence: [evidence('blocked', `标准答案无效：${message}`)]
        }
      }

      const studentBalance = checkBalance(studentEq)
      if (!studentBalance.balanced) {
        return {
          status: 'completed',
          durationMs: durationSince(startedAt),
          evidence: [
            evidence(
              'failed',
              `方程式未配平：${studentBalance.messages.join('；')}`,
              submissionText
            )
          ]
        }
      }

      // Expected should be balanced; if not, treat as config error
      const expectedBalance = checkBalance(expectedEq)
      if (!expectedBalance.balanced) {
        return {
          status: 'failed',
          durationMs: durationSince(startedAt),
          reason: `标准答案未配平：${expectedBalance.messages.join('；')}`,
          evidence: [evidence('blocked', '标准答案未配平，无法比对')]
        }
      }

      const comparison = compareEquations(studentEq, expectedEq)
      if (!comparison.match) {
        return {
          status: 'completed',
          durationMs: durationSince(startedAt),
          evidence: [evidence('failed', comparison.message, submissionText)]
        }
      }

      return {
        status: 'completed',
        durationMs: durationSince(startedAt),
        evidence: [evidence('passed', comparison.message, submissionText)]
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        status: 'completed',
        durationMs: durationSince(startedAt),
        evidence: [evidence('blocked', `校验异常：${message}`)]
      }
    }
  }
}

/** Test helper: reduce all coefficients of an equation by their GCD. */
export function reducedCoefficientVector(equation: ParsedEquation): number[] {
  const coeffs = [
    ...equation.reactants.map((s) => s.coefficient),
    ...equation.products.map((s) => s.coefficient)
  ]
  const g = gcdAll(coeffs)
  return coeffs.map((c) => c / g)
}
