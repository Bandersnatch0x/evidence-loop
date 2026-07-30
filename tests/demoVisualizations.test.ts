// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  ensureDemoCurveVisualizations,
  sampleDnaDoubleHelix,
  sampleMagneticHelix
} from '../server/questionbank/demoVisualizations'
import { QuestionStore } from '../server/questionbank/QuestionStore'
import { seedQuestionsFromAssignments } from '../server/questionbank/seedFromAssignments'

describe('demo curve visualizations', () => {
  it('samples a helix with constant-ish radius', () => {
    const points = sampleMagneticHelix(2, 40, 1)
    expect(points.length).toBe(40)
    const radii = points.map((p) => Math.hypot(p[0], p[1]))
    for (const r of radii) {
      expect(r).toBeCloseTo(1, 5)
    }
  })

  it('samples DNA with two strands', () => {
    const { points, secondaryPoints } = sampleDnaDoubleHelix(2, 50, 1)
    expect(points.length).toBe(50)
    expect(secondaryPoints.length).toBe(50)
  })

  it('attaches curve viz to seed questions on ensure', () => {
    const store = new QuestionStore({ dbPath: ':memory:' })
    seedQuestionsFromAssignments(store)
    const updated = ensureDemoCurveVisualizations(store)
    expect(updated).toBeGreaterThanOrEqual(2)

    const helix = store.get('seed:physics-magnetic-helix')
    expect(helix?.visualization?.kind).toBe('curve')

    const dna = store.get('seed:bio-dna-double-helix')
    expect(dna?.visualization?.kind).toBe('curve')
    if (dna?.visualization?.kind === 'curve') {
      expect(dna.visualization.secondaryPoints?.length).toBeGreaterThan(10)
    }

    // Idempotent second pass.
    expect(ensureDemoCurveVisualizations(store)).toBe(0)
  })
})
