// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { createAssignmentRegistry } from '../server/data/assignments'
import {
  createQuestionBackedRegistry,
  projectQuestionToAssignment,
  projectQuestionToExecutable,
  resolveVisualizationForAssignmentId
} from '../server/questionbank/projectQuestionAssignment'
import type { Question, Visualization } from '../shared/contracts'

const curve: Visualization = {
  kind: 'curve',
  points: [
    [0, 0, 0],
    [1, 0, 1]
  ],
  label: '螺旋'
}

function sampleQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q-private-1',
    questionBankId: 'bank-1',
    authorId: 'teacher-alpha',
    subject: 'physics',
    questionType: 'fill_blank',
    stem: '磁场中的带电粒子轨迹',
    payload: { kind: 'fill_blank', acceptedAnswers: ['螺旋'] },
    kpIds: ['kp.physics.em'],
    difficulty: 3,
    source: 'authored_key',
    createdAt: '2026-07-31T00:00:00.000Z',
    visualization: curve,
    ...overrides
  }
}

describe('projectQuestionToAssignment', () => {
  it('copies visualization onto the Assignment shell', () => {
    const assignment = projectQuestionToAssignment(sampleQuestion())
    expect(assignment.id).toBe('q-private-1')
    expect(assignment.visualization?.kind).toBe('curve')
    expect(assignment.questionType).toBe('fill_blank')
    expect(assignment.language).toBe('physics')
  })

  it('omits visualization when the question has none', () => {
    const assignment = projectQuestionToAssignment(
      sampleQuestion({ visualization: undefined })
    )
    expect(assignment.visualization).toBeUndefined()
  })

  it('truncates long stems into the title', () => {
    const long = '甲'.repeat(100)
    const assignment = projectQuestionToAssignment(
      sampleQuestion({ stem: long })
    )
    expect(assignment.title.length).toBeLessThanOrEqual(80)
    expect(assignment.title.endsWith('…')).toBe(true)
  })
})

describe('projectQuestionToExecutable', () => {
  it('builds runner + answer-match criteria from fill_blank payload', () => {
    const exec = projectQuestionToExecutable(sampleQuestion())
    expect(exec).toBeDefined()
    expect(exec?.runner).toEqual({
      kind: 'fill_blank',
      acceptedAnswers: ['螺旋']
    })
    expect(exec?.criteria).toHaveLength(1)
    expect(exec?.criteria[0]?.id).toBe('answer-match')
    expect(exec?.criteria[0]?.weight).toBe(100)
  })

  it('returns undefined when payload kind mismatches questionType', () => {
    const exec = projectQuestionToExecutable(
      sampleQuestion({
        questionType: 'numeric',
        payload: { kind: 'fill_blank', acceptedAnswers: ['1'] }
      })
    )
    expect(exec).toBeUndefined()
  })

  it('projects expression multi-answer criteria as cas-<label>', () => {
    const exec = projectQuestionToExecutable(
      sampleQuestion({
        questionType: 'expression',
        payload: {
          kind: 'expression',
          expectedLatex: '0',
          answers: { x: '1', y: '2' }
        }
      })
    )
    expect(exec?.criteria.map((c) => c.id).sort()).toEqual([
      'cas-x',
      'cas-y'
    ])
  })
})

describe('createQuestionBackedRegistry', () => {
  it('falls back to private question projection for scoring', () => {
    const q = sampleQuestion()
    const registry = createQuestionBackedRegistry(createAssignmentRegistry(), (id) =>
      id === q.id ? q : undefined
    )
    const resolved = registry.get(q.id)
    expect(resolved?.id).toBe(q.id)
    expect(resolved?.criteria[0]?.id).toBe('answer-match')
  })

  it('keeps demo registry assignments', () => {
    const registry = createQuestionBackedRegistry(
      createAssignmentRegistry(),
      () => undefined
    )
    expect(registry.get('python-average')?.id).toBe('python-average')
  })
})

describe('resolveVisualizationForAssignmentId', () => {
  it('prefers seed:<id> over bare id', () => {
    const seedViz: Visualization = {
      kind: 'curve',
      points: [
        [0, 0, 0],
        [1, 1, 1]
      ],
      label: 'seed'
    }
    const bareViz: Visualization = {
      kind: 'ball_stick',
      atoms: [{ id: 'A1', element: 'C', position: [0, 0, 0] }],
      bonds: []
    }
    const peek = (id: string): Question | undefined => {
      if (id === 'seed:demo-1') {
        return sampleQuestion({ id, visualization: seedViz })
      }
      if (id === 'demo-1') {
        return sampleQuestion({ id, visualization: bareViz })
      }
      return undefined
    }
    const resolved = resolveVisualizationForAssignmentId(peek, 'demo-1')
    expect(resolved?.kind).toBe('curve')
    if (resolved?.kind === 'curve') {
      expect(resolved.label).toBe('seed')
    }
  })

  it('falls back to bare question id', () => {
    const peek = (id: string): Question | undefined => {
      if (id === 'q-private-1') {
        return sampleQuestion()
      }
      return undefined
    }
    const resolved = resolveVisualizationForAssignmentId(peek, 'q-private-1')
    expect(resolved?.kind).toBe('curve')
  })
})
