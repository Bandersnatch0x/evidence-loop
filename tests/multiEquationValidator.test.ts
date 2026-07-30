// @vitest-environment node

import { describe, expect, it } from 'vitest'
import type { ExecutableAssignment } from '../server/data/assignments'
import { ExpressionValidator, parseLabeledSubmission } from '../server/runner/ExpressionValidator'

const XY_ANSWERS = {
  x: 'v0*cos(theta)*t',
  y: 'v0*sin(theta)*t-0.5*g*t^2'
}

function makeXyAssignment(): ExecutableAssignment {
  return {
    id: 'physics-projectile-xy',
    title: '斜抛运动',
    module: '物理 · 力学',
    language: 'physics',
    questionType: 'expression',
    estimatedMinutes: 10,
    status: 'ready',
    objective: '写出 x(t) 与 y(t)',
    scenario: '固定 v0=10, theta=π/4, g=9.8',
    requirements: ['提交 x 与 y 两个表达式'],
    constraints: [],
    functionSignature: 'x = ?(t)\ny = ?(t)',
    rubric: [
      { id: 'correctness', label: '正确性', description: 'x/y 分量', maxScore: 100 }
    ],
    demoVariants: [],
    criteria: [
      {
        id: 'cas-x',
        kind: 'cas_check',
        label: 'x 分量',
        dimensionId: 'correctness',
        visibility: 'public',
        weight: 50,
        expected: 'v0*cos(theta)*t',
        conceptId: 'kp.physics.mechanics.projectile',
        passedMessage: 'x 分量正确',
        failedMessage: 'x 分量错误'
      },
      {
        id: 'cas-y',
        kind: 'cas_check',
        label: 'y 分量',
        dimensionId: 'correctness',
        visibility: 'public',
        weight: 50,
        expected: 'v0*sin(theta)*t-0.5*g*t^2',
        conceptId: 'kp.physics.mechanics.projectile',
        passedMessage: 'y 分量正确',
        failedMessage: 'y 分量错误'
      }
    ],
    runner: {
      kind: 'expression',
      expectedLatex: '',
      answers: XY_ANSWERS
    }
  }
}

describe('parseLabeledSubmission · line-oriented form', () => {
  it('splits `label = rhs` lines into a label map', () => {
    const out = parseLabeledSubmission(
      'x = v0*cos(theta)*t\ny = v0*sin(theta)*t - 0.5*g*t^2',
      XY_ANSWERS
    )
    expect(out.x).toBe('v0*cos(theta)*t')
    expect(out.y).toBe('v0*sin(theta)*t-0.5*g*t^2')
  })

  it('lowercases and trims labels', () => {
    const out = parseLabeledSubmission('  X = a+b\n Y = c+d ', XY_ANSWERS)
    expect(out.x).toBe('a+b')
    expect(out.y).toBe('c+d')
  })

  it('returns empty strings for missing labels', () => {
    const out = parseLabeledSubmission('x = v0*cos(theta)*t', XY_ANSWERS)
    expect(out.x).toBe('v0*cos(theta)*t')
    expect(out.y).toBe('')
  })

  it('ignores lines without `=`', () => {
    const out = parseLabeledSubmission('x = a+b\nthis is noise\ny = c+d', XY_ANSWERS)
    expect(out.x).toBe('a+b')
    expect(out.y).toBe('c+d')
  })
})

describe('parseLabeledSubmission · JSON object form', () => {
  it('parses a JSON object of label→rhs', () => {
    const out = parseLabeledSubmission(
      '{"x":"v0*cos(theta)*t","y":"v0*sin(theta)*t-0.5*g*t^2"}',
      XY_ANSWERS
    )
    expect(out.x).toBe('v0*cos(theta)*t')
    expect(out.y).toBe('v0*sin(theta)*t-0.5*g*t^2')
  })

  it('treats a missing key in JSON as empty (blocked downstream)', () => {
    const out = parseLabeledSubmission('{"x":"a+b"}', XY_ANSWERS)
    expect(out.x).toBe('a+b')
    expect(out.y).toBe('')
  })

  it('throws on malformed JSON', () => {
    expect(() => parseLabeledSubmission('{not valid', XY_ANSWERS)).toThrow()
  })
})

describe('ExpressionValidator · multi-expression mode', () => {
  const validator = new ExpressionValidator()
  const assignment = makeXyAssignment()

  it('passes both x and y for a correct two-line submission', async () => {
    const result = await validator.run({
      assignment,
      submission: 'x = v0*cos(theta)*t\ny = v0*sin(theta)*t - 0.5*g*t^2'
    })
    expect(result.status).toBe('completed')
    const x = result.evidence.find((e) => e.id === 'cas-x')
    const y = result.evidence.find((e) => e.id === 'cas-y')
    expect(x?.state).toBe('passed')
    expect(y?.state).toBe('passed')
  })

  it('passes via JSON object form too', async () => {
    const result = await validator.run({
      assignment,
      submission: '{"x":"v0*cos(theta)*t","y":"v0*sin(theta)*t-0.5*g*t^2"}'
    })
    const x = result.evidence.find((e) => e.id === 'cas-x')
    const y = result.evidence.find((e) => e.id === 'cas-y')
    expect(x?.state).toBe('passed')
    expect(y?.state).toBe('passed')
  })

  it('fails x when x is wrong but y is right', async () => {
    const result = await validator.run({
      assignment,
      submission: 'x = v0*sin(theta)*t\ny = v0*sin(theta)*t - 0.5*g*t^2'
    })
    const x = result.evidence.find((e) => e.id === 'cas-x')
    const y = result.evidence.find((e) => e.id === 'cas-y')
    expect(x?.state).toBe('failed')
    expect(y?.state).toBe('passed')
  })

  it('blocks cas-y when y is missing from submission', async () => {
    const result = await validator.run({
      assignment,
      submission: 'x = v0*cos(theta)*t'
    })
    const y = result.evidence.find((e) => e.id === 'cas-y')
    expect(y?.state).toBe('blocked')
    expect(result.evidence.find((e) => e.id === 'cas-x')?.state).toBe('passed')
  })

  it('blocks both on unparseable garbage', async () => {
    const result = await validator.run({ assignment, submission: '@@@garbage@@@' })
    // @@@ has no '=', so every label is missing → blocked
    const x = result.evidence.find((e) => e.id === 'cas-x')
    const y = result.evidence.find((e) => e.id === 'cas-y')
    expect(x?.state).toBe('blocked')
    expect(y?.state).toBe('blocked')
  })
})
