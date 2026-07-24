// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ChoiceRunnerSpec, NumericRunnerSpec } from '../server/data/assignments'
import { QuestionStore } from '../server/questionbank/QuestionStore'
import {
  QuestionBankService,
  QuestionNotFoundError,
  QuestionOwnershipError
} from '../server/questionbank/QuestionBankService'
import {
  QuestionValidationError,
  type QuestionDraft
} from '../server/questionbank/questionValidation'
import {
  SEED_AUTHOR_ID,
  seedQuestionId,
  seedQuestionsFromAssignments
} from '../server/questionbank/seedFromAssignments'

const TEACHER = 'teacher-alpha'
const OTHER_TEACHER = 'teacher-beta'
const FIXED_NOW = () => new Date('2026-07-24T00:00:00.000Z')

function choiceDraft(overrides: Partial<QuestionDraft> = {}): QuestionDraft {
  return {
    questionBankId: 'bank-1',
    authorId: TEACHER,
    subject: 'math',
    questionType: 'choice',
    stem: '2(x+1) 化简后等于？',
    payload: { kind: 'choice', correctOptionIds: ['B'] },
    kpIds: ['kp.math.algebra.simplify'],
    difficulty: 2,
    ...overrides
  }
}

describe('QuestionBankService CRUD (录入)', () => {
  let store: QuestionStore
  let service: QuestionBankService

  beforeEach(() => {
    store = new QuestionStore({ dbPath: ':memory:' })
    service = new QuestionBankService({ store, now: FIXED_NOW })
  })

  afterEach(() => {
    store.close()
  })

  it('creates a structured Question from hand-entry with an id + createdAt', () => {
    const question = service.create(choiceDraft())
    expect(question.id).toMatch(/^q_/)
    expect(question.createdAt).toBe('2026-07-24T00:00:00.000Z')
    expect(question.subject).toBe('math')
    expect(question.questionType).toBe('choice')
    expect((question.payload as ChoiceRunnerSpec).correctOptionIds).toEqual(['B'])
    expect(question.kpIds).toEqual(['kp.math.algebra.simplify'])
    expect(question.difficulty).toBe(2)
  })

  it('defaults source to authored_key (D2 teacher-authored key)', () => {
    const question = service.create(choiceDraft())
    expect(question.source).toBe('authored_key')
  })

  it('persists + reads back a question through the store', () => {
    const created = service.create(choiceDraft())
    const fetched = service.get(created.id, TEACHER)
    expect(fetched.stem).toBe(created.stem)
    expect(fetched.id).toBe(created.id)
  })

  it('updates an owned question and re-validates the payload', () => {
    const created = service.create(choiceDraft())
    const updated = service.update(created.id, TEACHER, {
      difficulty: 4,
      payload: { kind: 'choice', correctOptionIds: ['A', 'C'] }
    })
    expect(updated.difficulty).toBe(4)
    expect((updated.payload as ChoiceRunnerSpec).correctOptionIds).toEqual(['A', 'C'])
    expect(updated.id).toBe(created.id)
    expect(updated.createdAt).toBe(created.createdAt)
  })

  it('deletes an owned question', () => {
    const created = service.create(choiceDraft())
    expect(service.delete(created.id, TEACHER)).toBe(true)
    expect(() => service.get(created.id, TEACHER)).toThrow(QuestionNotFoundError)
  })

  it('rejects a payload that does not match the declared questionType', () => {
    expect(() =>
      service.create(
        choiceDraft({
          questionType: 'numeric',
          payload: { kind: 'choice', correctOptionIds: ['B'] }
        })
      )
    ).toThrow(QuestionValidationError)
  })

  it('rejects difficulty outside 1..5', () => {
    expect(() => service.create(choiceDraft({ difficulty: 9 }))).toThrow(
      QuestionValidationError
    )
  })

  it('rejects an unsupported subject', () => {
    expect(() =>
      service.create(choiceDraft({ subject: 'astrology' }))
    ).toThrow(QuestionValidationError)
  })
})

describe('QuestionBankService ownership (老师私有 / 共享出界)', () => {
  let store: QuestionStore
  let service: QuestionBankService

  beforeEach(() => {
    store = new QuestionStore({ dbPath: ':memory:' })
    service = new QuestionBankService({ store, now: FIXED_NOW })
  })

  afterEach(() => {
    store.close()
  })

  it('refuses to read another teacher’s question', () => {
    const created = service.create(choiceDraft())
    expect(() => service.get(created.id, OTHER_TEACHER)).toThrow(
      QuestionOwnershipError
    )
  })

  it('refuses to update / delete another teacher’s question', () => {
    const created = service.create(choiceDraft())
    expect(() => service.update(created.id, OTHER_TEACHER, { difficulty: 5 })).toThrow(
      QuestionOwnershipError
    )
    expect(() => service.delete(created.id, OTHER_TEACHER)).toThrow(
      QuestionOwnershipError
    )
  })

  it('scopes list() to the requesting teacher only', () => {
    service.create(choiceDraft({ authorId: TEACHER }))
    service.create(choiceDraft({ authorId: OTHER_TEACHER }))
    expect(service.list(TEACHER)).toHaveLength(1)
    expect(service.list(OTHER_TEACHER)).toHaveLength(1)
  })
})

describe('QuestionBankService query (查询/筛选)', () => {
  let store: QuestionStore
  let service: QuestionBankService

  beforeEach(() => {
    store = new QuestionStore({ dbPath: ':memory:' })
    service = new QuestionBankService({ store, now: FIXED_NOW })
    service.create(
      choiceDraft({ kpIds: ['kp.math.algebra.simplify'], difficulty: 2 })
    )
    service.create(
      choiceDraft({
        subject: 'physics',
        questionType: 'numeric',
        stem: 'R = U / I = ?',
        payload: { kind: 'numeric', expected: 24, tolerance: 0.01 },
        kpIds: ['kp.physics.electricity.ohm_law'],
        difficulty: 4
      })
    )
  })

  afterEach(() => {
    store.close()
  })

  it('filters by subject', () => {
    const physics = service.list(TEACHER, { subject: 'physics' })
    expect(physics).toHaveLength(1)
    expect(physics[0]?.questionType).toBe('numeric')
  })

  it('filters by questionType', () => {
    expect(service.list(TEACHER, { questionType: 'choice' })).toHaveLength(1)
  })

  it('filters by knowledge point', () => {
    const byKp = service.list(TEACHER, {
      kpIds: ['kp.physics.electricity.ohm_law']
    })
    expect(byKp).toHaveLength(1)
    expect(byKp[0]?.subject).toBe('physics')
  })

  it('filters by difficulty band', () => {
    const hard = service.list(TEACHER, { minDifficulty: 3 })
    expect(hard).toHaveLength(1)
    expect(hard[0]?.difficulty).toBe(4)
  })

  it('summary flags hasSolution false when no solution present', () => {
    const summaries = service.list(TEACHER)
    expect(summaries.every((item) => item.hasSolution === false)).toBe(true)
  })
})

describe('QuestionBankService 组卷 (paper assembly)', () => {
  let store: QuestionStore
  let service: QuestionBankService

  beforeEach(() => {
    store = new QuestionStore({ dbPath: ':memory:' })
    service = new QuestionBankService({ store, now: FIXED_NOW })
  })

  afterEach(() => {
    store.close()
  })

  it('assembles a manual paper from chosen question ids', () => {
    const a = service.create(choiceDraft())
    const b = service.create(choiceDraft({ stem: '另一题' }))
    const paper = service.assembleManual(TEACHER, [a.id, b.id], '小测一')
    expect(paper.title).toBe('小测一')
    expect(paper.questionIds).toEqual([a.id, b.id])
    expect(paper.authorId).toBe(TEACHER)
  })

  it('refuses a manual paper containing a foreign question', () => {
    const mine = service.create(choiceDraft({ authorId: TEACHER }))
    const foreign = service.create(choiceDraft({ authorId: OTHER_TEACHER }))
    expect(() =>
      service.assembleManual(TEACHER, [mine.id, foreign.id])
    ).toThrow(QuestionOwnershipError)
  })

  it('refuses a manual paper with duplicate ids', () => {
    const a = service.create(choiceDraft())
    expect(() => service.assembleManual(TEACHER, [a.id, a.id])).toThrow(
      QuestionValidationError
    )
  })

  it('assembles by knowledge points (薄弱点组卷 primitive)', () => {
    service.create(choiceDraft({ kpIds: ['kp.math.algebra.simplify'] }))
    service.create(
      choiceDraft({
        stem: '第二道代数题',
        kpIds: ['kp.math.algebra.simplify']
      })
    )
    service.create(
      choiceDraft({
        subject: 'physics',
        stem: '物理题',
        kpIds: ['kp.physics.electricity.ohm_law']
      })
    )
    const paper = service.assembleByKnowledgePoints({
      authorId: TEACHER,
      kpIds: ['kp.math.algebra.simplify']
    })
    expect(paper.questionIds).toHaveLength(2)
  })

  it('throws when no question matches the target knowledge points', () => {
    service.create(choiceDraft({ kpIds: ['kp.math.algebra.simplify'] }))
    expect(() =>
      service.assembleByKnowledgePoints({
        authorId: TEACHER,
        kpIds: ['kp.nonexistent']
      })
    ).toThrow(QuestionNotFoundError)
  })

  it('honours the difficulty band in KP assembly', () => {
    service.create(
      choiceDraft({ kpIds: ['kp.shared'], difficulty: 1 })
    )
    service.create(
      choiceDraft({ stem: '难题', kpIds: ['kp.shared'], difficulty: 5 })
    )
    const paper = service.assembleByKnowledgePoints({
      authorId: TEACHER,
      kpIds: ['kp.shared'],
      minDifficulty: 4
    })
    expect(paper.questionIds).toHaveLength(1)
  })
})

describe('Seed import from demo assignments (迁移/共存)', () => {
  let store: QuestionStore

  beforeEach(() => {
    store = new QuestionStore({ dbPath: ':memory:' })
  })

  afterEach(() => {
    store.close()
  })

  it('imports all 14 demo assignments as seed questions', () => {
    const result = seedQuestionsFromAssignments(store, FIXED_NOW)
    expect(result.imported).toBe(14)
    expect(result.skipped).toBe(0)
    expect(store.count({ authorId: SEED_AUTHOR_ID })).toBe(14)
  })

  it('is idempotent — a re-run skips existing seeds', () => {
    seedQuestionsFromAssignments(store, FIXED_NOW)
    const second = seedQuestionsFromAssignments(store, FIXED_NOW)
    expect(second.imported).toBe(0)
    expect(second.skipped).toBe(14)
    expect(store.count({ authorId: SEED_AUTHOR_ID })).toBe(14)
  })

  it('marks code seeds test_case and non-code seeds authored_key (D2)', () => {
    seedQuestionsFromAssignments(store, FIXED_NOW)
    const code = store.get(seedQuestionId('python-average'))
    const choice = store.get(seedQuestionId('choice-algebra-simplify'))
    expect(code?.source).toBe('test_case')
    expect(choice?.source).toBe('authored_key')
  })

  it('lifts KP tags from assignment evidence conceptIds', () => {
    seedQuestionsFromAssignments(store, FIXED_NOW)
    const choice = store.get(seedQuestionId('choice-algebra-simplify'))
    expect(choice?.kpIds).toContain('kp.math.algebra.simplify')
  })

  it('reuses the assignment RunnerSpec verbatim as the payload', () => {
    seedQuestionsFromAssignments(store, FIXED_NOW)
    const numeric = store.get(seedQuestionId('numeric-ohm-law'))
    expect((numeric?.payload as NumericRunnerSpec).kind).toBe('numeric')
    expect((numeric?.payload as NumericRunnerSpec).expected).toBe(24)
  })
})
