/**
 * Mini expression evaluator for the projectile trajectory canvas.
 *
 * Why not mathjs: mathjs (~150KB) is not currently in the client bundle
 * (server-only). Pulling it in to draw one curve would be a gold hammer.
 * This evaluator covers only what the projectile slice needs: numbers,
 * vars t/v0/theta/g (+ constants pi/e), + - * / ^, sin/cos, parens,
 * unary minus. See ADR 0009.
 *
 * The `y = RHS` split mirrors server-side splitEquationTakeRhs in
 * ExpressionValidator — duplicated on purpose (server code must not enter
 * the client bundle; see ADR 0009 未做项).
 */

export interface TrajectoryPoint {
  t: number
  y: number
}

type Token =
  | { kind: 'num'; value: number }
  | { kind: 'var'; name: string }
  | { kind: 'op'; value: string }
  | { kind: 'lparen' }
  | { kind: 'rparen' }
  | { kind: 'comma' }

function tokenize(src: string): Token[] | null {
  const tokens: Token[] = []
  let i = 0
  while (i < src.length) {
    const ch = src.charAt(i)
    if (ch === ' ' || ch === '\t') {
      i++
      continue
    }
    if (ch >= '0' && ch <= '9') {
      let num = ''
      while (i < src.length) {
        const c = src.charAt(i)
        if (!((c >= '0' && c <= '9') || c === '.')) break
        num += c
        i++
      }
      const value = Number(num)
      if (!Number.isFinite(value)) return null
      tokens.push({ kind: 'num', value })
      continue
    }
    if (ch >= 'a' && ch <= 'z') {
      let name = ''
      while (i < src.length) {
        const c = src.charAt(i)
        if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'))) break
        name += c
        i++
      }
      tokens.push({ kind: 'var', name })
      continue
    }
    if (ch === '(') {
      tokens.push({ kind: 'lparen' })
      i++
      continue
    }
    if (ch === ')') {
      tokens.push({ kind: 'rparen' })
      i++
      continue
    }
    if (ch === ',') {
      tokens.push({ kind: 'comma' })
      i++
      continue
    }
    if (ch === '*' || ch === '/' || ch === '+' || ch === '-' || ch === '^') {
      tokens.push({ kind: 'op', value: ch })
      i++
      continue
    }
    return null
  }
  return tokens
}

// Recursive-descent parser → evaluator. Precedence low→high:
// expr = term (('+'|'-') term)*
// term = factor (('*'|'/') factor)*
// factor = unary ('^' factor)?   (right-assoc)
// unary = ('-'|'+') unary | primary
// primary = num | var | func '(' expr ')' | '(' expr ')'
interface ParseState {
  tokens: Token[]
  pos: number
}

function parseExpr(state: ParseState, scope: Record<string, number>): number | null {
  let left = parseTerm(state, scope)
  if (left === null) return null
  while (state.pos < state.tokens.length) {
    const tk = state.tokens[state.pos]
    if (tk === undefined || tk.kind !== 'op' || (tk.value !== '+' && tk.value !== '-')) break
    state.pos++
    const right = parseTerm(state, scope)
    if (right === null) return null
    left = tk.value === '+' ? left + right : left - right
  }
  return left
}

function parseTerm(state: ParseState, scope: Record<string, number>): number | null {
  let left = parseFactor(state, scope)
  if (left === null) return null
  while (state.pos < state.tokens.length) {
    const tk = state.tokens[state.pos]
    if (tk === undefined || tk.kind !== 'op' || (tk.value !== '*' && tk.value !== '/')) break
    state.pos++
    const right = parseFactor(state, scope)
    if (right === null) return null
    if (tk.value === '*') {
      left = left * right
    } else {
      if (right === 0) return null
      left = left / right
    }
  }
  return left
}

function parseFactor(state: ParseState, scope: Record<string, number>): number | null {
  const base = parseUnary(state, scope)
  if (base === null) return null
  const tk = state.tokens[state.pos]
  if (tk !== undefined && tk.kind === 'op' && tk.value === '^') {
    state.pos++
    const exp = parseFactor(state, scope) // right-assoc
    if (exp === null) return null
    const result = Math.pow(base, exp)
    return Number.isFinite(result) ? result : null
  }
  return base
}

function parseUnary(state: ParseState, scope: Record<string, number>): number | null {
  const tk = state.tokens[state.pos]
  if (tk !== undefined && tk.kind === 'op' && (tk.value === '-' || tk.value === '+')) {
    state.pos++
    const operand = parseUnary(state, scope)
    if (operand === null) return null
    return tk.value === '-' ? -operand : operand
  }
  return parsePrimary(state, scope)
}

function parsePrimary(state: ParseState, scope: Record<string, number>): number | null {
  const tk = state.tokens[state.pos]
  if (tk === undefined) return null
  if (tk.kind === 'num') {
    state.pos++
    return tk.value
  }
  if (tk.kind === 'lparen') {
    state.pos++
    const value = parseExpr(state, scope)
    if (value === null) return null
    const next = state.tokens[state.pos]
    if (next === undefined || next.kind !== 'rparen') return null
    state.pos++
    return value
  }
  if (tk.kind === 'var') {
    state.pos++
    if (tk.name === 'sin' || tk.name === 'cos') {
      const lparen = state.tokens[state.pos]
      if (lparen === undefined || lparen.kind !== 'lparen') return null
      state.pos++
      const arg = parseExpr(state, scope)
      if (arg === null) return null
      const rparen = state.tokens[state.pos]
      if (rparen === undefined || rparen.kind !== 'rparen') return null
      state.pos++
      return tk.name === 'sin' ? Math.sin(arg) : Math.cos(arg)
    }
    if (tk.name === 'pi') return Math.PI
    if (tk.name === 'e') return Math.E
    if (Object.prototype.hasOwnProperty.call(scope, tk.name)) {
      return scope[tk.name] ?? null
    }
    return null
  }
  return null
}

function takeRhs(raw: string): string {
  const text = raw.trim()
  if (/[=<>!]=|<=|>=|!=/.test(text)) return text
  const eqIdx = text.indexOf('=')
  if (eqIdx === -1) return text
  return text.slice(eqIdx + 1)
}

function evaluateAt(rhs: string, scope: Record<string, number>): number | null {
  const tokens = tokenize(rhs)
  if (tokens === null) return null
  const state: ParseState = { tokens, pos: 0 }
  const value = parseExpr(state, scope)
  if (value === null) return null
  if (state.pos !== tokens.length) return null
  return Number.isFinite(value) ? value : null
}

/**
 * Sample the learner's y(t) over [0, tMax]. Returns null if the expression
 * cannot be evaluated at any sample.
 */
export function computeTrajectory(
  submission: string,
  params: { v0: number; theta: number; g: number; tMax: number; samples: number }
): TrajectoryPoint[] | null {
  const rhs = takeRhs(submission)
  if (rhs.trim() === '') return null
  const points: TrajectoryPoint[] = []
  const { v0, theta, g, tMax, samples } = params
  for (let i = 0; i <= samples; i++) {
    const t = (tMax * i) / samples
    const scope = { t, v0, theta, g }
    const y = evaluateAt(rhs, scope)
    if (y === null) return null
    points.push({ t, y })
  }
  return points
}

export interface XYPoint {
  t: number
  x: number
  y: number
}

/**
 * Sample the learner's x(t) and y(t) over [0, tMax] for a full projectile
 * trajectory in physical x-y space (ADR-0011). The submission must contain
 * both `x = <rhs>` and `y = <rhs>`; missing either returns null. Returns null
 * if either expression fails to evaluate at any sample.
 */
export function computeXYTrajectory(
  submission: string,
  params: { v0: number; theta: number; g: number; tMax: number; samples: number }
): XYPoint[] | null {
  // Extract labeled x and y RHSs.
  const xRhs = extractLabeled(submission, 'x')
  const yRhs = extractLabeled(submission, 'y')
  if (xRhs === null || yRhs === null) return null
  const points: XYPoint[] = []
  const { v0, theta, g, tMax, samples } = params
  for (let i = 0; i <= samples; i++) {
    const t = (tMax * i) / samples
    const scope = { t, v0, theta, g }
    const x = evaluateAt(xRhs, scope)
    const y = evaluateAt(yRhs, scope)
    if (x === null || y === null) return null
    points.push({ t, x, y })
  }
  return points
}

/** Extract `label = rhs` from a multi-line submission. Returns null if absent. */
function extractLabeled(submission: string, label: string): string | null {
  const target = label.toLowerCase()
  const lines = submission
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  for (const line of lines) {
    const eqIdx = line.indexOf('=')
    if (eqIdx === -1) continue
    const lbl = line.slice(0, eqIdx).trim().toLowerCase()
    if (lbl === target) return takeRhs(line)
  }
  // JSON form: {"x":"...","y":"..."}
  if (submission.trim().startsWith('{')) {
    try {
      const obj = JSON.parse(submission) as unknown
      if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
        const v = (obj as Record<string, unknown>)[target]
        if (typeof v === 'string') return takeRhs(v)
      }
    } catch {
      // fall through
    }
  }
  return null
}
