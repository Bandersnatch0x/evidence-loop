// @vitest-environment node

import { describe, expect, it } from 'vitest'
import type { ExecutableAssignment } from '../server/data/assignments'
import {
  ExpressionValidator,
  expressionsEquivalent,
  normalizeExpression,
  numericalEquivalence,
  parseExpressionSubmission,
  symbolicEquivalence
} from '../server/runner/ExpressionValidator'

function makeExpressionAssignment(
  expectedLatex: string,
  steps?: readonly string[]
): ExecutableAssignment {
  return {
    id: 'expr-demo',
    title: '表达式 CAS 演示',
    module: '数学 · 代数',
    language: 'math',
    questionType: 'expression',
    estimatedMinutes: 5,
    status: 'ready',
    objective: '验证代数等价',
    scenario: '单元测试用',
    requirements: ['给出与期望代数等价的表达式'],
    constraints: ['使用 mathjs 可解析的写法'],
    functionSignature: 'expression',
    rubric: [
      {
        id: 'correctness',
        label: '正确性',
        description: '最终答案代数等价',
        maxScore: 100
      }
    ],
    demoVariants: [],
    criteria: [
      {
        id: 'cas-final',
        kind: 'cas_check',
        label: '最终答案 CAS',
        dimensionId: 'correctness',
        visibility: 'public',
        weight: 100,
        expected: expectedLatex,
        conceptId: 'kp.math.algebra.simplify',
        passedMessage: '最终答案等价',
        failedMessage: '最终答案不等价'
      }
    ],
    runner: {
      kind: 'expression',
      expectedLatex,
      ...(steps ? { steps } : {})
    }
  }
}

describe('ExpressionValidator helpers', () => {
  it('normalizes light LaTeX forms', () => {
    expect(normalizeExpression('x^{2}+2x+1')).toBe('x^(2)+2x+1')
    expect(normalizeExpression('$\\frac{1}{2}$')).toBe('(1)/(2)')
  })

  it('parses plain / multi-line / JSON submissions', () => {
    expect(parseExpressionSubmission('x^2+2x+1')).toEqual({
      answer: 'x^2+2x+1',
      steps: ['x^2+2x+1']
    })

    expect(
      parseExpressionSubmission('(x+1)^2\nx^2+2x+1')
    ).toEqual({
      answer: 'x^2+2x+1',
      steps: ['(x+1)^2', 'x^2+2x+1']
    })

    expect(
      parseExpressionSubmission(
        JSON.stringify({ answer: 'x^2+2*x+1', steps: ['(x+1)^2', 'x^2+2*x+1'] })
      )
    ).toMatchObject({
      answer: 'x^2+2*x+1',
      steps: ['(x+1)^2', 'x^2+2*x+1']
    })
  })

  it('detects symbolic equivalence for different forms', () => {
    expect(symbolicEquivalence('x^2+2*x+1', '(x+1)^2')).toBe('equal')
    // Non-equivalent polynomials may stay uncertain symbolically; numerical path decides.
    expect(symbolicEquivalence('x^2', 'x^2+1')).toBe('unequal')
    expect(
      expressionsEquivalent('x^2', '(x+1)^2', {
        numericalTrials: 16,
        numericalTolerance: 1e-8,
        seed: 11
      }).equal
    ).toBe(false)
  })

  it('uses numerical fallback when simplify is uncertain', () => {
    // Forms that differ by expansion-style identities still pass via CAS or numeric
    const result = expressionsEquivalent('2*(x+1)', '2*x+2', {
      numericalTrials: 16,
      numericalTolerance: 1e-8,
      seed: 7
    })
    expect(result.equal).toBe(true)

    const unequal = numericalEquivalence('x^2', 'x^2+1', {
      trials: 12,
      tolerance: 1e-8,
      seed: 3
    })
    expect(unequal).toBe('unequal')
  })
})

describe('ExpressionValidator', () => {
  const runner = new ExpressionValidator({ timeoutMs: 3_000 })

  it('passes when student form differs but is algebraically equal', async () => {
    const assignment = makeExpressionAssignment('(x+1)^2')

    const result = await runner.run({
      assignment,
      submission: 'x^2+2*x+1'
    })

    expect(result.status).toBe('completed')
    const final = result.evidence.find((item) => item.id === 'cas-final')
    expect(final?.state).toBe('passed')
    expect(final?.actual).toBe('x^2+2*x+1')
  })

  it('fails when expressions are not equivalent', async () => {
    const assignment = makeExpressionAssignment('(x+1)^2')

    const result = await runner.run({
      assignment,
      submission: 'x^2+1'
    })

    expect(result.status).toBe('completed')
    expect(result.evidence.find((item) => item.id === 'cas-final')?.state).toBe(
      'failed'
    )
  })

  it('blocks on illegal / unparseable expressions without throwing', async () => {
    const assignment = makeExpressionAssignment('x+1')

    const result = await runner.run({
      assignment,
      submission: 'x + * 1'
    })

    expect(result.status).toBe('completed')
    const final = result.evidence.find((item) => item.id === 'cas-final')
    expect(final?.state).toBe('blocked')
    expect(final?.message).toMatch(/解析|失败|Unexpected|Syntax/i)
  })

  it('validates consecutive steps when provided', async () => {
    const assignment = makeExpressionAssignment('x^2+2*x+1', [
      '(x+1)^2',
      'x^2+2*x+1'
    ])

    const result = await runner.run({
      assignment,
      submission: JSON.stringify({
        answer: 'x^2+2*x+1',
        steps: ['(x+1)^2', 'x^2+2*x+1']
      })
    })

    expect(result.status).toBe('completed')
    expect(result.evidence.find((item) => item.id === 'cas-step-0-1')?.state).toBe(
      'passed'
    )
    expect(result.evidence.find((item) => item.id === 'cas-final')?.state).toBe(
      'passed'
    )
  })

  it('detects a broken step chain', async () => {
    const assignment = makeExpressionAssignment('x^2')

    const result = await runner.run({
      assignment,
      submission: '(x+1)^2\nx^2+1\nx^2'
    })

    expect(result.status).toBe('completed')
    // First transition (x+1)^2 → x^2+1 is not equivalent
    expect(result.evidence.find((item) => item.id === 'cas-step-0-1')?.state).toBe(
      'failed'
    )
  })

  it('accepts legacy code field as submission alias', async () => {
    const assignment = makeExpressionAssignment('2*x')
    const result = await runner.run({
      assignment,
      code: 'x+x'
    })
    expect(result.evidence.find((item) => item.id === 'cas-final')?.state).toBe(
      'passed'
    )
  })

  it('blocks empty submission', async () => {
    const assignment = makeExpressionAssignment('1')
    const result = await runner.run({
      assignment,
      submission: '   '
    })
    expect(result.evidence.find((item) => item.id === 'cas-final')?.state).toBe(
      'blocked'
    )
  })
})
