// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  hardGeometryIssues,
  softGeometryWarnings
} from '../server/questionbank/geometrySanity'
import { parseVisualization } from '../server/questionbank/visualizationSchema'

describe('geometrySanity · hard rejects', () => {
  it('flags zero-length bonds', () => {
    const issues = hardGeometryIssues({
      kind: 'ball_stick',
      atoms: [
        { id: 'A1', element: 'C', position: [0, 0, 0] },
        { id: 'A2', element: 'H', position: [0, 0, 0] }
      ],
      bonds: [{ from: 'A1', to: 'A2' }]
    })
    expect(issues.some((m) => m.includes('长度为 0'))).toBe(true)
  })

  it('rejects all-same curve points via parse', () => {
    expect(() =>
      parseVisualization({
        kind: 'curve',
        points: [
          [1, 1, 1],
          [1, 1, 1],
          [1, 1, 1]
        ]
      })
    ).toThrow()
  })

  it('rejects primitives self-loop edges', () => {
    expect(() =>
      parseVisualization({
        kind: 'primitives',
        nodes: [
          { id: 'A', position: [0, 0, 0] },
          { id: 'B', position: [1, 0, 0] }
        ],
        edges: [{ from: 'A', to: 'A' }]
      })
    ).toThrow()
  })
})

describe('geometrySanity · soft warnings', () => {
  it('warns when DNA lacks crossBars', () => {
    const warnings = softGeometryWarnings({
      kind: 'curve',
      points: [
        [1, 0, 0],
        [0, 1, 1],
        [-1, 0, 2]
      ],
      secondaryPoints: [
        [-1, 0, 0],
        [0, -1, 1],
        [1, 0, 2]
      ]
    })
    expect(warnings.some((w) => w.includes('crossBars'))).toBe(true)
  })

  it('accepts DNA with crossBars without hard fail', () => {
    const viz = parseVisualization({
      kind: 'curve',
      points: [
        [1, 0, 0],
        [0, 1, 1]
      ],
      secondaryPoints: [
        [-1, 0, 0],
        [0, -1, 1]
      ],
      crossBars: [
        [
          [1, 0, 0],
          [-1, 0, 0]
        ]
      ],
      label: 'DNA'
    })
    expect(viz.kind).toBe('curve')
    if (viz.kind === 'curve') {
      expect(viz.crossBars?.length).toBe(1)
    }
  })
})
