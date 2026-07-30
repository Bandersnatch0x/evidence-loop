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

describe('visualization persistence (ADR-0015)', () => {
  let store: QuestionStore

  beforeEach(() => {
    store = new QuestionStore({ dbPath: ':memory:' })
  })

  it('stores + retrieves a visualization round-trip', () => {
    const service = new QuestionBankService({ store })
    const created = service.create(baseDraft())
    expect(created.visualization).toBeUndefined()

    const adopted = service.adoptVisualization(created.id, TEACHER, ammoniaViz)
    expect(adopted.visualization).toBeDefined()
    expect(adopted.visualization?.kind).toBe('ball_stick')
    if (adopted.visualization?.kind === 'ball_stick') {
      expect(adopted.visualization.atoms.length).toBe(4)
    }

    // Re-read from store to confirm persistence.
    const reread = service.get(created.id, TEACHER)
    expect(reread?.visualization?.kind).toBe('ball_stick')
    if (reread?.visualization?.kind === 'ball_stick') {
      expect(reread.visualization.atoms.length).toBe(4)
      expect(reread.visualization.label).toBe('氨气 NH3')
    }
  })

  it('survives a subsequent unrelated update (visualization preserved)', () => {
    const service = new QuestionBankService({ store })
    const created = service.create(baseDraft())
    service.adoptVisualization(created.id, TEACHER, ammoniaViz)

    // A later update that does NOT touch visualization must keep it.
    service.update(created.id, TEACHER, { difficulty: 4 })
    const reread = service.get(created.id, TEACHER)
    expect(reread?.difficulty).toBe(4)
    expect(reread?.visualization?.kind).toBe('ball_stick')
    if (reread?.visualization?.kind === 'ball_stick') {
      expect(reread.visualization.atoms.length).toBe(4)
    }
  })

  it('clears the visualization when adopted with null', () => {
    const service = new QuestionBankService({ store })
    const created = service.create(baseDraft())
    service.adoptVisualization(created.id, TEACHER, ammoniaViz)
    expect(service.get(created.id, TEACHER)?.visualization).toBeDefined()

    service.adoptVisualization(created.id, TEACHER, null)
    expect(service.get(created.id, TEACHER)?.visualization).toBeUndefined()
  })

  it('refuses to adopt on a foreign-owned question', () => {
    const service = new QuestionBankService({ store })
    const created = service.create(baseDraft())
    expect(() =>
      service.adoptVisualization(created.id, 'teacher-other', ammoniaViz)
    ).toThrow()
  })

  it('drops an invalid stored visualization on read (not fatal)', () => {
    // Write a malformed visualization_json directly, then confirm get survives.
    const service = new QuestionBankService({ store })
    const created = service.create(baseDraft())
    const db = (
      store as unknown as {
        db: { prepare: (s: string) => { run: (...b: unknown[]) => void } }
      }
    ).db
    db.prepare('UPDATE questions SET visualization_json = ? WHERE id = ?').run(
      '{"kind":"ball_stick","atoms":[],"bonds":[]}',
      created.id
    )
    const reread = service.get(created.id, TEACHER)
    expect(reread?.visualization).toBeUndefined()
    // Scoring-relevant fields are untouched.
    expect(reread?.payload).toBeDefined()
  })
})
