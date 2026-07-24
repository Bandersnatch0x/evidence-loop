// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { QuestionStore } from '../server/questionbank/QuestionStore'
import { QuestionBankService } from '../server/questionbank/QuestionBankService'
import type { QuestionDraft } from '../server/questionbank/questionValidation'
import { JsonAttemptStore } from '../server/store/AttemptStore'
import {
  MistakeBookService,
  PracticeSessionService
} from '../server/student'
import { openMemoryDatabase } from '../server/db/memorySchema'
import type {
  Attempt,
  EvaluationResult,
  SessionMode
} from '../shared/contracts'

const TEACHER = 'teacher-t07'
const STUDENT = 'student-a'
const NOW = () => new Date('2026-07-24T08:00:00.000Z')

let db: ReturnType<typeof openMemoryDatabase>
let questions: QuestionStore
let attempts: JsonAttemptStore

beforeEach(() => {
  db = openMemoryDatabase(':memory:')
  questions = new QuestionStore({ database: db })
  attempts = new JsonAttemptStore(':memory:')
})

afterEach(() => {
  questions.close()
  db.close()
})

function choiceDraft(qid: string): QuestionDraft {
  return {
    questionBankId: 'bank-t07',
    authorId: TEACHER,
    subject: 'math',
    questionType: 'choice',
    stem: `题 ${qid}`,
    payload: { kind: 'choice', correctOptionIds: ['A'] },
    kpIds: ['kp-A'],
    difficulty: 2
  }
}

function result(overrides: Partial<EvaluationResult> = {}): EvaluationResult {
  return {
    id: 'ev-1',
    assignmentId: 'q-1',
    attempt: 1,
    createdAt: '2026-07-24T08:00:00.000Z',
    status: 'completed',
    score: 0,
    summary: 'fail',
    evidence: [
      {
        id: 'ev-1',
        kind: 'test',
        label: 'correctness',
        dimensionId: 'correctness',
        visibility: 'public',
        state: 'failed',
        weight: 10,
        message: 'wrong',
        conceptId: 'kp-A',
        source: 'test_case'
      }
    ],
    dimensions: [{ id: 'correctness', label: 'c', description: '', maxScore: 10, earnedScore: 0, state: 'failed', evidenceIds: ['ev-1'] }],
    diagnoses: [],
    trace: [],
    mastery: [],
    feedbackSource: 'local-policy',
    studentId: STUDENT,
    provenance: { kind: 'evidence', evidenceIds: ['ev-1'], algorithm: 'simple.v1' },
    ...overrides
  }
}

function attempt(
  mode: SessionMode,
  qid: string,
  res: EvaluationResult,
  createdAt = '2026-07-24T08:00:00.000Z'
): Attempt {
  return {
    id: res.id,
    studentId: STUDENT,
    questionId: qid,
    teachingUnitId: 'tu-1',
    termId: 'term-1',
    mode,
    createdAt,
    result: res
  }
}

describe('T07 PracticeSessionService (D1 mode gate)', () => {
  beforeEach(() => {
    new QuestionBankService({ store: questions, now: NOW }).create(choiceDraft('q-1'))
  })

  it('startPractice: practice mode enables tutoring', async () => {
    const service = new PracticeSessionService({ attempts, now: NOW })
    const out = await service.startPractice(
      {
        questionId: 'q-1',
        teachingUnitId: 'tu-1',
        termId: 'term-1',
        mode: 'practice'
      },
      STUDENT
    )
    expect(out.mode).toBe('practice')
    expect(out.tutoringEnabled).toBe(true)
    const saved = await attempts.getAttempt(out.attemptId)
    expect(saved?.mode).toBe('practice')
    // placeholder never feeds mastery until submitted
    expect(saved?.result.status).toBe('rejected')
  })

  it('startPractice: assessment mode disables tutoring (D1)', async () => {
    const service = new PracticeSessionService({ attempts, now: NOW })
    const out = await service.startPractice(
      {
        questionId: 'q-1',
        teachingUnitId: 'tu-1',
        termId: 'term-1',
        mode: 'assessment'
      },
      STUDENT
    )
    expect(out.tutoringEnabled).toBe(false)
  })

  it('listSessions groups paper-batched attempts into one session', async () => {
    const service = new PracticeSessionService({ attempts, now: NOW })
    // Two attempts sharing a paper_ assignmentId → one paper session
    await attempts.saveAttempt({
      id: 'att-a',
      studentId: STUDENT,
      questionId: 'q-1',
      teachingUnitId: 'tu-1',
      termId: 'term-1',
      mode: 'assessment',
      createdAt: '2026-07-24T08:00:00.000Z',
      result: { ...result({ id: 'att-a', assignmentId: 'paper_xyz' }) }
    })
    await attempts.saveAttempt({
      id: 'att-b',
      studentId: STUDENT,
      questionId: 'q-1',
      teachingUnitId: 'tu-1',
      termId: 'term-1',
      mode: 'assessment',
      createdAt: '2026-07-24T08:05:00.000Z',
      result: { ...result({ id: 'att-b', assignmentId: 'paper_xyz' }) }
    })
    const sessions = await service.listSessions(STUDENT)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.shape).toBe('paper')
    expect(sessions[0]?.attemptIds).toHaveLength(2)
  })
})

describe('T07 MistakeBookService (D1 mastery rule)', () => {
  beforeEach(() => {
    const bank = new QuestionBankService({ store: questions, now: NOW })
    bank.create(choiceDraft('q-fail'))
  })

  it('collects incorrectly-answered questions', async () => {
    // one failed attempt → entry appears in active book
    await attempts.saveAttempt(
      attempt('assessment', 'q-fail', result({ id: 'a1' }))
    )
    const service = new MistakeBookService({
      attempts,
      questions,
      masteryThreshold: 2
    })
    const view = await service.view(STUDENT)
    expect(view.activeCount).toBe(1)
    expect(view.entries[0]?.questionId).toBe('q-fail')
    expect(view.entries[0]?.mastered).toBe(false)
  })

  it('marks mastered only after N consecutive ASSESSMENT passes (not practice)', async () => {
    const service = new MistakeBookService({
      attempts,
      questions,
      masteryThreshold: 2
    })
    // fail first
    await attempts.saveAttempt(
      attempt('assessment', 'q-fail', result({ id: 'a1' }), '2026-07-24T08:00:00.000Z')
    )
    // two practice passes — must NOT clear (D1: practice does not feed mastery)
    const passRes = result({
      id: 'a2',
      score: 10,
      status: 'completed',
      summary: 'pass',
      evidence: [
        {
          id: 'ev-p',
          kind: 'test',
          label: 'correctness',
          dimensionId: 'correctness',
          visibility: 'public',
          state: 'passed',
          weight: 10,
          message: 'ok',
          conceptId: 'kp-A',
          source: 'test_case'
        }
      ]
    })
    await attempts.saveAttempt(
      attempt('practice', 'q-fail', { ...passRes, id: 'a2' }, '2026-07-24T09:00:00.000Z')
    )
    await attempts.saveAttempt(
      attempt('practice', 'q-fail', { ...passRes, id: 'a3' }, '2026-07-24T10:00:00.000Z')
    )
    let view = await service.view(STUDENT)
    expect(view.entries[0]?.mastered).toBe(false)
    expect(view.activeCount).toBe(1)

    // two assessment passes → mastered (leaves active book)
    await attempts.saveAttempt(
      attempt('assessment', 'q-fail', { ...passRes, id: 'a4' }, '2026-07-24T11:00:00.000Z')
    )
    await attempts.saveAttempt(
      attempt('assessment', 'q-fail', { ...passRes, id: 'a5' }, '2026-07-24T12:00:00.000Z')
    )
    view = await service.view(STUDENT)
    expect(view.entries[0]?.mastered).toBe(true)
    expect(view.activeCount).toBe(0)
    expect(view.masteredCount).toBe(1)
  })

  it('skips questions the student never got wrong', async () => {
    const passRes = result({
      id: 'a-ok',
      score: 10,
      status: 'completed',
      summary: 'pass',
      evidence: [
        {
          id: 'ev-p',
          kind: 'test',
          label: 'correctness',
          dimensionId: 'correctness',
          visibility: 'public',
          state: 'passed',
          weight: 10,
          message: 'ok',
          conceptId: 'kp-A',
          source: 'test_case'
        }
      ]
    })
    await attempts.saveAttempt(attempt('assessment', 'q-fail', passRes))
    const service = new MistakeBookService({
      attempts,
      questions,
      masteryThreshold: 2
    })
    const view = await service.view(STUDENT)
    expect(view.entries).toHaveLength(0)
  })
})
