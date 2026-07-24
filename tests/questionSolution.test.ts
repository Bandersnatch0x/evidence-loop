// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { QuestionStore } from '../server/questionbank/QuestionStore'
import {
  QuestionBankService,
  QuestionOwnershipError
} from '../server/questionbank/QuestionBankService'
import type { QuestionDraft } from '../server/questionbank/questionValidation'
import {
  buildTutoringContext,
  hasSolution,
  parseSolution,
  serializeSolution,
  SolutionValidationError,
  validateSolution
} from '../server/questionbank/solution'

const TEACHER = 'teacher-alpha'
const FIXED_NOW = () => new Date('2026-07-24T00:00:00.000Z')

function draftWithSolution(solution?: unknown): QuestionDraft {
  return {
    questionBankId: 'bank-1',
    authorId: TEACHER,
    subject: 'math',
    questionType: 'expression',
    stem: '(x+1)^2 → ?',
    payload: { kind: 'expression', expectedLatex: '(x+1)^2' },
    kpIds: ['kp.math.algebra.simplify'],
    difficulty: 3,
    solution
  }
}

const goodSolution = {
  content: '先用完全平方公式：(x+1)^2 = x^2 + 2x + 1。',
  latex: 'x^2+2x+1',
  keyPoints: ['识别完全平方', '展开交叉项 2·x·1'],
  authorId: TEACHER,
  source: 'authored' as const
}

describe('validateSolution (T09 存取校验)', () => {
  it('normalizes a well-formed solution', () => {
    const solution = validateSolution(goodSolution)
    expect(solution.content).toContain('完全平方')
    expect(solution.latex).toBe('x^2+2x+1')
    expect(solution.keyPoints).toHaveLength(2)
    expect(solution.source).toBe('authored')
  })

  it('trims strings and drops empty key points', () => {
    const solution = validateSolution({
      content: '  解法正文  ',
      keyPoints: ['步骤一', '   ', ''],
      authorId: TEACHER
    })
    expect(solution.content).toBe('解法正文')
    expect(solution.keyPoints).toEqual(['步骤一'])
  })

  it('defaults source to authored when omitted', () => {
    const solution = validateSolution({ content: '解', authorId: TEACHER })
    expect(solution.source).toBe('authored')
  })

  it('rejects empty content', () => {
    expect(() =>
      validateSolution({ content: '   ', authorId: TEACHER })
    ).toThrow(SolutionValidationError)
  })

  it('rejects a missing authorId', () => {
    expect(() => validateSolution({ content: '解' })).toThrow(
      SolutionValidationError
    )
  })

  it('rejects a non-authored source', () => {
    expect(() =>
      validateSolution({ content: '解', authorId: TEACHER, source: 'llm' })
    ).toThrow(SolutionValidationError)
  })
})

describe('serialize / parse round-trip', () => {
  it('serializes undefined to null (待补 marker)', () => {
    expect(serializeSolution(undefined)).toBeNull()
  })

  it('round-trips a solution through JSON', () => {
    const json = serializeSolution(validateSolution(goodSolution))
    expect(json).not.toBeNull()
    const parsed = parseSolution(json)
    expect(parsed?.content).toContain('完全平方')
    expect(parsed?.keyPoints).toHaveLength(2)
  })

  it('parses null / empty / malformed json to undefined (degrade to 待补)', () => {
    expect(parseSolution(null)).toBeUndefined()
    expect(parseSolution('')).toBeUndefined()
    expect(parseSolution('{not json')).toBeUndefined()
    expect(parseSolution('{"content":""}')).toBeUndefined()
  })
})

describe('buildTutoringContext (T09 §3 有解析复述 / 无解析生成)', () => {
  it('present solution → rag_restate with verified content, no disclaimer', () => {
    const context = buildTutoringContext(validateSolution(goodSolution))
    expect(context.mode).toBe('rag_restate')
    expect(context.ragContent).toContain('完全平方')
    expect(context.ragKeyPoints).toHaveLength(2)
    expect(context.needsSolution).toBe(false)
    expect(context.requiresDisclaimer).toBe(false)
  })

  it('absent solution → llm_generate, 待补, disclaimer required', () => {
    const context = buildTutoringContext(undefined)
    expect(context.mode).toBe('llm_generate')
    expect(context.needsSolution).toBe(true)
    expect(context.requiresDisclaimer).toBe(true)
    expect(context.ragContent).toBeUndefined()
  })

  it('hasSolution reflects presence', () => {
    expect(hasSolution(validateSolution(goodSolution))).toBe(true)
    expect(hasSolution(undefined)).toBe(false)
  })
})

describe('QuestionBankService solution integration', () => {
  let store: QuestionStore
  let service: QuestionBankService

  beforeEach(() => {
    store = new QuestionStore({ dbPath: ':memory:' })
    service = new QuestionBankService({ store, now: FIXED_NOW })
  })

  afterEach(() => {
    store.close()
  })

  it('persists a solution with the question and reads it back', () => {
    const created = service.create(draftWithSolution(goodSolution))
    const solution = service.getSolution(created.id, TEACHER)
    expect(solution?.content).toContain('完全平方')
    const refetched = service.get(created.id, TEACHER)
    expect(refetched.solution?.latex).toBe('x^2+2x+1')
  })

  it('a question without a solution is flagged 待补 (llm_generate)', () => {
    const created = service.create(draftWithSolution(undefined))
    expect(service.getSolution(created.id, TEACHER)).toBeUndefined()
    const context = service.tutoringContextFor(created.id, TEACHER)
    expect(context.mode).toBe('llm_generate')
    expect(context.needsSolution).toBe(true)
  })

  it('a question with a solution tutors via rag_restate', () => {
    const created = service.create(draftWithSolution(goodSolution))
    const context = service.tutoringContextFor(created.id, TEACHER)
    expect(context.mode).toBe('rag_restate')
    expect(context.requiresDisclaimer).toBe(false)
  })

  it('list summary flags hasSolution correctly', () => {
    service.create(draftWithSolution(goodSolution))
    service.create(draftWithSolution(undefined))
    const summaries = service.list(TEACHER)
    const withSolution = summaries.filter((item) => item.hasSolution)
    expect(withSolution).toHaveLength(1)
  })

  it('update can attach a solution to a 待补 question', () => {
    const created = service.create(draftWithSolution(undefined))
    const updated = service.update(created.id, TEACHER, {
      solution: goodSolution
    })
    expect(updated.solution?.content).toContain('完全平方')
  })

  it('update can clear a solution back to 待补 via explicit undefined', () => {
    const created = service.create(draftWithSolution(goodSolution))
    const updated = service.update(created.id, TEACHER, { solution: undefined })
    expect(updated.solution).toBeUndefined()
  })

  it('adoptSolution promotes AI draft text to authored standard solution (T09)', () => {
    const created = service.create(draftWithSolution(undefined))
    expect(service.tutoringContextFor(created.id, TEACHER).mode).toBe(
      'llm_generate'
    )

    const adopted = service.adoptSolution(created.id, TEACHER, {
      content: '  AI 讲解：先因式分解，再合并同类项。  ',
      latex: 'x^2+2x+1',
      keyPoints: ['因式分解', '  ', '合并同类项']
    })

    expect(adopted.solution?.content).toBe('AI 讲解：先因式分解，再合并同类项。')
    expect(adopted.solution?.authorId).toBe(TEACHER)
    expect(adopted.solution?.source).toBe('authored')
    expect(adopted.solution?.keyPoints).toEqual(['因式分解', '合并同类项'])
    expect(service.tutoringContextFor(created.id, TEACHER).mode).toBe(
      'rag_restate'
    )
    expect(service.tutoringContextFor(created.id, TEACHER).requiresDisclaimer).toBe(
      false
    )
  })

  it('adoptSolution refuses another teacher’s question', () => {
    const created = service.create(draftWithSolution(undefined))
    expect(() =>
      service.adoptSolution(created.id, 'other-teacher', {
        content: '偷写解析'
      })
    ).toThrow(QuestionOwnershipError)
  })
})
