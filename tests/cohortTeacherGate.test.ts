// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  createCohortSnapshot,
  formalScoreForCohort,
  isAwaitingTeacherAdjudication
} from '../server/data/cohort'
import type {
  EvaluationHistoryItem,
  EvaluationResult
} from '../shared/contracts'

function baseResult(
  overrides: Partial<EvaluationResult> = {}
): EvaluationResult {
  return {
    id: 'ev-1',
    assignmentId: 'essay-perseverance-growth',
    attempt: 1,
    createdAt: '2026-07-24T08:00:00.000Z',
    status: 'completed',
    score: 40,
    summary: '客观 40',
    evidence: [],
    dimensions: [],
    diagnoses: [],
    trace: [],
    mastery: [],
    feedbackSource: 'local-policy',
    studentId: 'learner-demo',
    provenance: {
      kind: 'evidence',
      evidenceIds: [],
      algorithm: 'simple.v1'
    },
    ...overrides
  }
}

const advisory = [
  {
    id: 'adv-1',
    dimensionLabel: '立意',
    suggestion: '深化',
    provenance: {
      kind: 'llm_inference' as const,
      sourceMessages: ['深化'],
      model: 'rule-based',
      extractedAt: '2026-07-24T08:00:00.000Z'
    },
    requiresTeacherConfirmation: true as const
  }
]

describe('T11 P4 cohort teacherAnnotation gate', () => {
  it('marks subjective without teacherAnnotation as awaiting adjudication', () => {
    const pending = baseResult({ advisory })
    expect(isAwaitingTeacherAdjudication(pending)).toBe(true)
    expect(formalScoreForCohort(pending)).toBeUndefined()
  })

  it('admits subjective into formal metrics only after teacherAnnotation', () => {
    const adjudicated = baseResult({
      advisory,
      teacherAnnotation: {
        teacherId: 'teacher-demo',
        subjectiveScore: 8,
        subjectiveMaxScore: 10,
        note: 'ok',
        adjudicatedAt: '2026-07-24T09:00:00.000Z'
      }
    })
    expect(isAwaitingTeacherAdjudication(adjudicated)).toBe(false)
    // Formal score stays the objective result.score (铁律: 不折叠进 score)
    expect(formalScoreForCohort(adjudicated)).toBe(40)
  })

  it('objective-only results enter formal metrics immediately', () => {
    const objective = baseResult({
      assignmentId: 'python-average',
      score: 80,
      advisory: undefined
    })
    expect(isAwaitingTeacherAdjudication(objective)).toBe(false)
    expect(formalScoreForCohort(objective)).toBe(80)
  })

  it('createCohortSnapshot excludes pending from median and counts them', () => {
    const pending = baseResult({ id: 'p1', score: 99, advisory })
    const objective = baseResult({
      id: 'o1',
      assignmentId: 'python-average',
      score: 60,
      advisory: undefined
    })
    const history: EvaluationHistoryItem[] = [
      {
        id: 'o1',
        assignmentId: 'python-average',
        attempt: 1,
        createdAt: objective.createdAt,
        score: 60,
        status: 'completed',
        studentId: 'learner-demo'
      }
    ]
    const snap = createCohortSnapshot(history, [pending, objective])
    expect(snap.pendingAdjudication).toBe(1)
    // Median must not be pulled up by the pending 99
    expect(snap.medianScore).toBe(60)
  })

  it('after adjudication, subjective score joins formal median', () => {
    const adjudicated = baseResult({
      id: 'a1',
      score: 40,
      advisory,
      teacherAnnotation: {
        teacherId: 't',
        subjectiveScore: 9,
        subjectiveMaxScore: 10,
        note: 'good',
        adjudicatedAt: '2026-07-24T10:00:00.000Z'
      }
    })
    const objective = baseResult({
      id: 'o1',
      assignmentId: 'choice-1',
      score: 80,
      advisory: undefined
    })
    const snap = createCohortSnapshot([], [adjudicated, objective])
    expect(snap.pendingAdjudication).toBe(0)
    expect(snap.medianScore).toBe(60) // median(40, 80)
  })
})
