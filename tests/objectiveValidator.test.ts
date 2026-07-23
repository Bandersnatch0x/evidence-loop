// @vitest-environment node

import { describe, expect, it } from 'vitest'
import type {
  ChoiceRunnerSpec,
  ExecutableAssignment,
  FillBlankRunnerSpec,
  NumericRunnerSpec,
  RunnerSpec
} from '../server/data/assignments'
import { ObjectiveValidator } from '../server/runner/ObjectiveValidator'
import type { RunnerEvidence } from '../server/runner/types'
import type { QuestionType } from '../shared/contracts'

/**
 * Build a minimal ExecutableAssignment carrying a single `answer_match`
 * criterion so the validator's evidence id matches (mirrors how
 * EvaluationAgent joins evidence to criteria).
 */
function makeAssignment(
  questionType: QuestionType,
  runner: RunnerSpec,
  criterionId = 'answer'
): ExecutableAssignment {
  return {
    id: 'fixture',
    title: 'fixture',
    module: 'fixture',
    language: 'math',
    questionType,
    estimatedMinutes: 1,
    status: 'ready',
    objective: '',
    scenario: '',
    requirements: [],
    constraints: [],
    functionSignature: '',
    rubric: [
      { id: 'correctness', label: '正确性', description: '', maxScore: 100 }
    ],
    demoVariants: [],
    criteria: [
      {
        id: criterionId,
        kind: 'answer_match',
        label: '答案匹配',
        dimensionId: 'correctness',
        visibility: 'public',
        weight: 100,
        conceptId: 'concept',
        passedMessage: '正确',
        failedMessage: '错误'
      }
    ],
    runner
  }
}

const validator = new ObjectiveValidator()

/** First evidence atom, asserted present (avoids `!` under strict TS). */
function firstEvidence(result: { evidence: RunnerEvidence[] }): RunnerEvidence {
  const [evidence] = result.evidence
  if (!evidence) throw new Error('Expected at least one evidence atom')
  return evidence
}

describe('ObjectiveValidator · choice', () => {
  const singleSpec: ChoiceRunnerSpec = { kind: 'choice', correctOptionIds: ['B'] }
  const multiSpec: ChoiceRunnerSpec = {
    kind: 'choice',
    correctOptionIds: ['A', 'C', 'D']
  }

  it('passes a correct single-choice answer', async () => {
    const result = await validator.run({
      assignment: makeAssignment('choice', singleSpec),
      submission: 'B'
    })

    expect(result.status).toBe('completed')
    expect(firstEvidence(result)).toMatchObject({ id: 'answer', state: 'passed' })
  })

  it('fails a wrong single-choice answer', async () => {
    const result = await validator.run({
      assignment: makeAssignment('choice', singleSpec),
      submission: 'A'
    })

    expect(firstEvidence(result).state).toBe('failed')
  })

  it('matches multi-choice regardless of order', async () => {
    const result = await validator.run({
      assignment: makeAssignment('choice', multiSpec),
      submission: 'D, A, C'
    })

    expect(firstEvidence(result).state).toBe('passed')
  })

  it('fails multi-choice when a required option is missing', async () => {
    const result = await validator.run({
      assignment: makeAssignment('choice', multiSpec),
      submission: 'A, C'
    })

    expect(firstEvidence(result).state).toBe('failed')
  })

  it('fails multi-choice when an extra option is present', async () => {
    const result = await validator.run({
      assignment: makeAssignment('choice', multiSpec),
      submission: 'A, B, C, D'
    })

    expect(firstEvidence(result).state).toBe('failed')
  })

  it('treats an empty submission as a failed choice (boundary)', async () => {
    const result = await validator.run({
      assignment: makeAssignment('choice', singleSpec),
      submission: '   '
    })

    expect(firstEvidence(result)).toMatchObject({ state: 'failed', actual: '(空)' })
  })
})

describe('ObjectiveValidator · fill_blank', () => {
  it('passes an exact match', async () => {
    const spec: FillBlankRunnerSpec = {
      kind: 'fill_blank',
      acceptedAnswers: ['光合作用']
    }
    const result = await validator.run({
      assignment: makeAssignment('fill_blank', spec),
      submission: '光合作用'
    })

    expect(firstEvidence(result).state).toBe('passed')
  })

  it('normalizes surrounding and internal whitespace', async () => {
    const spec: FillBlankRunnerSpec = {
      kind: 'fill_blank',
      acceptedAnswers: ['carbon dioxide']
    }
    const result = await validator.run({
      assignment: makeAssignment('fill_blank', spec),
      submission: '  carbon   dioxide '
    })

    expect(firstEvidence(result).state).toBe('passed')
  })

  it('is case-insensitive by default', async () => {
    const spec: FillBlankRunnerSpec = {
      kind: 'fill_blank',
      acceptedAnswers: ['Photosynthesis']
    }
    const result = await validator.run({
      assignment: makeAssignment('fill_blank', spec),
      submission: 'PHOTOSYNTHESIS'
    })

    expect(firstEvidence(result).state).toBe('passed')
  })

  it('honors caseSensitive when enabled', async () => {
    const spec: FillBlankRunnerSpec = {
      kind: 'fill_blank',
      acceptedAnswers: ['NaCl'],
      caseSensitive: true
    }
    const wrong = await validator.run({
      assignment: makeAssignment('fill_blank', spec),
      submission: 'nacl'
    })
    const right = await validator.run({
      assignment: makeAssignment('fill_blank', spec),
      submission: 'NaCl'
    })

    expect(firstEvidence(wrong).state).toBe('failed')
    expect(firstEvidence(right).state).toBe('passed')
  })

  it('accepts any of multiple acceptable answers', async () => {
    const spec: FillBlankRunnerSpec = {
      kind: 'fill_blank',
      acceptedAnswers: ['H2O', 'water', '水']
    }
    const result = await validator.run({
      assignment: makeAssignment('fill_blank', spec),
      submission: '水'
    })

    expect(firstEvidence(result).state).toBe('passed')
  })

  it('fails a non-matching answer', async () => {
    const spec: FillBlankRunnerSpec = {
      kind: 'fill_blank',
      acceptedAnswers: ['光合作用']
    }
    const result = await validator.run({
      assignment: makeAssignment('fill_blank', spec),
      submission: '呼吸作用'
    })

    expect(firstEvidence(result).state).toBe('failed')
  })
})

describe('ObjectiveValidator · numeric', () => {
  const spec: NumericRunnerSpec = { kind: 'numeric', expected: 3.14, tolerance: 0.01 }

  it('passes a value inside tolerance', async () => {
    const result = await validator.run({
      assignment: makeAssignment('numeric', spec),
      submission: '3.145'
    })

    expect(firstEvidence(result).state).toBe('passed')
  })

  it('passes a value exactly on the tolerance boundary', async () => {
    const result = await validator.run({
      assignment: makeAssignment('numeric', spec),
      submission: '3.15'
    })

    expect(firstEvidence(result).state).toBe('passed')
  })

  it('fails a value just outside tolerance', async () => {
    const result = await validator.run({
      assignment: makeAssignment('numeric', spec),
      submission: '3.16'
    })

    expect(firstEvidence(result).state).toBe('failed')
  })

  it('passes an exact match with zero tolerance (boundary)', async () => {
    const exactSpec: NumericRunnerSpec = { kind: 'numeric', expected: 42, tolerance: 0 }
    const result = await validator.run({
      assignment: makeAssignment('numeric', exactSpec),
      submission: '42'
    })

    expect(firstEvidence(result).state).toBe('passed')
  })

  it('fails a non-numeric submission', async () => {
    const result = await validator.run({
      assignment: makeAssignment('numeric', spec),
      submission: 'abc'
    })

    expect(firstEvidence(result)).toMatchObject({ state: 'failed', actual: 'abc' })
  })

  it('handles negative values within tolerance', async () => {
    const negSpec: NumericRunnerSpec = { kind: 'numeric', expected: -273.15, tolerance: 0.1 }
    const result = await validator.run({
      assignment: makeAssignment('numeric', negSpec),
      submission: '-273.1'
    })

    expect(firstEvidence(result).state).toBe('passed')
  })
})

describe('ObjectiveValidator · true/false (choice boolean special case)', () => {
  const spec: ChoiceRunnerSpec = { kind: 'choice', correctOptionIds: ['true'] }

  it('passes a matching boolean answer', async () => {
    const result = await validator.run({
      assignment: makeAssignment('choice', spec),
      submission: '正确'
    })

    expect(firstEvidence(result).state).toBe('passed')
  })

  it('normalizes assorted truthy words to the same literal', async () => {
    for (const answer of ['true', 'T', '对', '是', '√']) {
      const result = await validator.run({
        assignment: makeAssignment('choice', spec),
        submission: answer
      })
      expect(firstEvidence(result).state).toBe('passed')
    }
  })

  it('fails a false answer against a true key', async () => {
    const result = await validator.run({
      assignment: makeAssignment('choice', spec),
      submission: '错误'
    })

    expect(firstEvidence(result).state).toBe('failed')
  })

  it('passes a false answer against a false key', async () => {
    const falseSpec: ChoiceRunnerSpec = { kind: 'choice', correctOptionIds: ['false'] }
    const result = await validator.run({
      assignment: makeAssignment('choice', falseSpec),
      submission: 'no'
    })

    expect(firstEvidence(result).state).toBe('passed')
  })
})

describe('ObjectiveValidator · guards', () => {
  it('rejects code (Python) specs', async () => {
    const assignment = makeAssignment('code', {
      functionName: 'f',
      maxAstNodes: 10,
      testCases: []
    })
    const result = await validator.run({ assignment, submission: 'x' })

    expect(result.status).toBe('failed')
    expect(result.reason).toContain('不支持代码题型')
  })

  it('rejects unsupported objective specs (expression)', async () => {
    const assignment = makeAssignment('expression', {
      kind: 'expression',
      expectedLatex: 'x^2'
    })
    const result = await validator.run({ assignment, submission: 'x^2' })

    expect(result.status).toBe('failed')
    expect(result.reason).toContain('expression')
  })

  it('fails when submission is missing', async () => {
    const assignment = makeAssignment('numeric', {
      kind: 'numeric',
      expected: 1,
      tolerance: 0
    })
    const result = await validator.run({ assignment })

    expect(result.status).toBe('failed')
  })

  it('produces deterministic evidence across repeated runs', async () => {
    const assignment = makeAssignment('choice', {
      kind: 'choice',
      correctOptionIds: ['A', 'B']
    })
    const first = await validator.run({ assignment, submission: 'B, A' })
    const second = await validator.run({ assignment, submission: 'B, A' })

    expect(firstEvidence(first).state).toBe(firstEvidence(second).state)
    expect(firstEvidence(first).message).toBe(firstEvidence(second).message)
  })
})
