// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  ensureDemoCurveVisualizations,
  sampleDnaDoubleHelix,
  sampleMagneticHelix,
  sampleSeriesCircuit
} from '../server/questionbank/demoVisualizations'
import { QuestionStore } from '../server/questionbank/QuestionStore'
import { seedQuestionsFromAssignments } from '../server/questionbank/seedFromAssignments'

describe('demo visualizations', () => {
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

  it('builds a series circuit graph', () => {
    const circuit = sampleSeriesCircuit()
    expect(circuit.kind).toBe('primitives')
    if (circuit.kind === 'primitives') {
      expect(circuit.nodes.length).toBeGreaterThanOrEqual(3)
      expect(circuit.edges.length).toBeGreaterThanOrEqual(3)
    }
  })

  it('attaches curve + primitives viz to seed questions on ensure', () => {
    const store = new QuestionStore({ dbPath: ':memory:' })
    seedQuestionsFromAssignments(store)
    const updated = ensureDemoCurveVisualizations(store)
    expect(updated).toBeGreaterThanOrEqual(3)

    const helix = store.get('seed:physics-magnetic-helix')
    expect(helix?.visualization?.kind).toBe('curve')

    const dna = store.get('seed:bio-dna-double-helix')
    expect(dna?.visualization?.kind).toBe('curve')
    if (dna?.visualization?.kind === 'curve') {
      expect(dna.visualization.secondaryPoints?.length).toBeGreaterThan(10)
      expect(dna.visualization.crossBars?.length).toBeGreaterThan(5)
    }

    const ohm = store.get('seed:numeric-ohm-law')
    expect(ohm?.visualization?.kind).toBe('primitives')

    // Idempotent second pass.
    expect(ensureDemoCurveVisualizations(store)).toBe(0)
  })
})
