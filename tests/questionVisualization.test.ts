// @vitest-environment node

import { beforeEach, describe, expect, it } from 'vitest'
import { QuestionStore } from '../server/questionbank/QuestionStore'
import { QuestionBankService } from '../server/questionbank/QuestionBankService'
import type { QuestionDraft } from '../server/questionbank/questionValidation'
import type { Visualization } from '../shared/contracts'

const TEACHER = 'teacher-alpha'

function baseDraft(): QuestionDraft {
  return {
    questionBankId: 'bank-1',
    authorId: TEACHER,
    subject: 'chemistry',
    questionType: 'fill_blank',
    stem: '氨气的分子构型？',
    payload: { kind: 'fill_blank', acceptedAnswers: ['trigonal pyramidal'] },
    kpIds: ['kp.chemistry.matter.molecular_geometry'],
    difficulty: 3
  }
}

const ammoniaViz: Visualization = {
  kind: 'ball_stick',
  atoms: [
    { id: 'N', element: 'N', position: [0, 0, 0] },
    { id: 'H1', element: 'H', position: [0.8, 0.3, 0.5] },
    { id: 'H2', element: 'H', position: [-0.8, 0.3, 0.5] },
    { id: 'H3', element: 'H', position: [0, 0.3, -0.9] }
  ],
  bonds: [
    { from: 'N', to: 'H1' },
    { from: 'N', to: 'H2' },
    { from: 'N', to: 'H3' }
  ],
  label: '氨气 NH3'
}

describe('visualization persistence is removed (Phase C, #30)', () => {
  let store: QuestionStore

  beforeEach(() => {
    store = new QuestionStore({ dbPath: ':memory:' })
  })

  it('adopt-visualization no longer persists a visualization (column deleted)', () => {
    const service = new QuestionBankService({ store })
    const created = service.create(baseDraft())
    expect(created.visualization).toBeUndefined()

    // Phase C (#30): the legacy visualization_json column is deleted, so
    // adopting a visualization is a transient no-op — it never round-trips.
    const adopted = service.adoptVisualization(created.id, TEACHER, ammoniaViz)
    expect(adopted.visualization?.kind).toBe('ball_stick')

    // Re-read from store: the field is NOT persisted.
    const reread = service.get(created.id, TEACHER)
    expect(reread?.visualization).toBeUndefined()
    // Scoring-relevant fields are untouched.
    expect(reread?.payload).toBeDefined()
    expect(reread?.stem).toBe('氨气的分子构型？')
  })

  it('refuses to adopt on a foreign-owned question', () => {
    const service = new QuestionBankService({ store })
    const created = service.create(baseDraft())
    expect(() =>
      service.adoptVisualization(created.id, 'teacher-other', ammoniaViz)
    ).toThrow()
  })
})
