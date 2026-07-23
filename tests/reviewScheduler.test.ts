// @vitest-environment node

import { describe, expect, it } from 'vitest'
import type { EvaluationResult } from '../shared/contracts'
import { openMemoryDatabase } from '../server/db/memorySchema'
import { ReviewScheduler } from '../server/review/ReviewScheduler'

const SECRET = 'review-scheduler-test-hmac'

function sampleEvaluation(scoreByKp: Record<string, 'passed' | 'failed'>): EvaluationResult {
  return {
    id: 'eval_test_1',
    assignmentId: 'python-average',
    attempt: 1,
    createdAt: '2026-01-01T12:00:00.000Z',
    status: 'completed',
    score: 50,
    summary: 'test',
    evidence: Object.entries(scoreByKp).map(([kpId, state], index) => ({
      id: `ev-${String(index)}`,
      kind: 'test' as const,
      label: kpId,
      dimensionId: 'correctness',
      visibility: 'public' as const,
      state,
      weight: 10,
      message: state,
      conceptId: kpId
    })),
    dimensions: [],
    diagnoses: [],
    trace: [],
    mastery: [],
    feedbackSource: 'local-policy',
    studentId: 'learner-demo',
    provenance: {
      kind: 'evidence',
      evidenceIds: Object.keys(scoreByKp).map((_, index) => `ev-${String(index)}`),
      algorithm: 'simple.v1'
    }
  }
}

describe('ReviewScheduler.scoreToRating', () => {
  it('maps the four score bands at the documented boundaries', () => {
    expect(ReviewScheduler.scoreToRating(0)).toBe(1)
    expect(ReviewScheduler.scoreToRating(0.2999)).toBe(1)
    expect(ReviewScheduler.scoreToRating(0.3)).toBe(2)
    expect(ReviewScheduler.scoreToRating(0.5999)).toBe(2)
    expect(ReviewScheduler.scoreToRating(0.6)).toBe(3)
    expect(ReviewScheduler.scoreToRating(0.8499)).toBe(3)
    expect(ReviewScheduler.scoreToRating(0.85)).toBe(4)
    expect(ReviewScheduler.scoreToRating(1)).toBe(4)
  })
})

describe('ReviewScheduler.applyReview', () => {
  it('creates an empty card on first review and persists SchedulingState fields', () => {
    const db = openMemoryDatabase(':memory:')
    const scheduler = new ReviewScheduler({ db, hmacSecret: SECRET })

    const card = scheduler.applyReview('learner-demo', 'empty-sequence', 3)

    expect(card.id.startsWith('card_')).toBe(true)
    expect(card.studentId).toBe('learner-demo')
    expect(card.kpId).toBe('empty-sequence')
    expect(card.scheduling.reps).toBeGreaterThanOrEqual(1)
    expect(card.scheduling.state).not.toBe('new')
    expect(typeof card.scheduling.stability).toBe('number')
    expect(typeof card.scheduling.difficulty).toBe('number')
    expect(typeof card.scheduling.dueAt).toBe('string')

    db.close()
  })

  it('shortens the next interval after consecutive Again ratings', () => {
    const db = openMemoryDatabase(':memory:')
    const scheduler = new ReviewScheduler({ db, hmacSecret: SECRET })
    const studentId = 'learner-demo'
    const kpId = 'aggregation-basics'

    // Establish a healthy card with Easy so the due date is pushed out.
    const easy = scheduler.applyReview(
      studentId,
      kpId,
      4,
      new Date('2026-01-01T00:00:00.000Z')
    )
    const afterEasyDue = new Date(easy.scheduling.dueAt).getTime()

    // Fail twice in a row with Again.
    const again1 = scheduler.applyReview(
      studentId,
      kpId,
      1,
      new Date('2026-01-02T00:00:00.000Z')
    )
    const again2 = scheduler.applyReview(
      studentId,
      kpId,
      1,
      new Date('2026-01-02T00:10:00.000Z')
    )

    const afterAgain1Due = new Date(again1.scheduling.dueAt).getTime()
    const afterAgain2Due = new Date(again2.scheduling.dueAt).getTime()

    // After Easy the card was due later; after Again it is due much sooner.
    expect(afterEasyDue).toBeGreaterThan(new Date('2026-01-01T00:00:00.000Z').getTime())
    expect(afterAgain1Due).toBeLessThan(afterEasyDue)
    // Consecutive Again keeps the card in a short-horizon relearning schedule.
    expect(afterAgain2Due - new Date('2026-01-02T00:10:00.000Z').getTime()).toBeLessThan(
      afterEasyDue - new Date('2026-01-01T00:00:00.000Z').getTime()
    )
    expect(again2.scheduling.lapses).toBeGreaterThanOrEqual(again1.scheduling.lapses)

    db.close()
  })

  it('updates card due_at when applyFromEvaluation processes evidence scores', () => {
    const db = openMemoryDatabase(':memory:')
    const scheduler = new ReviewScheduler({ db, hmacSecret: SECRET })

    const first = scheduler.applyFromEvaluation(
      sampleEvaluation({ 'empty-sequence': 'failed' })
    )
    expect(first).toHaveLength(1)
    const initialDue = first[0]?.scheduling.dueAt
    expect(initialDue).toBeTruthy()

    const second = scheduler.applyFromEvaluation(
      sampleEvaluation({ 'empty-sequence': 'passed' })
    )
    expect(second).toHaveLength(1)
    expect(second[0]?.scheduling.dueAt).not.toBe(initialDue)
    expect(second[0]?.scheduling.reps).toBeGreaterThan(first[0]?.scheduling.reps ?? 0)

    // A failed kp maps to Again and should appear in the due queue at/after its due time.
    const dueAt = new Date(second[0]!.scheduling.dueAt)
    const listed = scheduler.listDue('learner-demo', new Date(dueAt.getTime() + 1_000))
    expect(listed.some((card) => card.kpId === 'empty-sequence')).toBe(true)

    db.close()
  })
})
