// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { generateVisualization, parseVisualization } from '../server/questionbank/visualizationSchema'

describe('visualizationSchema · validation', () => {
  it('accepts a valid ball-stick geometry', () => {
    const valid = parseVisualization({
      kind: 'ball_stick',
      atoms: [
        { id: 'A1', element: 'O', position: [0, 0, 0] },
        { id: 'A2', element: 'H', position: [0.8, 0, 0.6] },
        { id: 'A3', element: 'H', position: [-0.8, 0, 0.6] }
      ],
      bonds: [
        { from: 'A1', to: 'A2' },
        { from: 'A1', to: 'A3' }
      ],
      label: '水分子'
    })
    expect(valid.kind).toBe('ball_stick')
    if (valid.kind === 'ball_stick') {
      expect(valid.atoms.length).toBe(3)
    }
  })

  it('rejects empty atoms', () => {
    expect(() =>
      parseVisualization({ kind: 'ball_stick', atoms: [], bonds: [] })
    ).toThrow()
  })

  it('rejects a bond referencing a non-existent atom', () => {
    expect(() =>
      parseVisualization({
        kind: 'ball_stick',
        atoms: [{ id: 'A1', element: 'C', position: [0, 0, 0] }],
        bonds: [{ from: 'A1', to: 'NOPE' }]
      })
    ).toThrow()
  })

  it('rejects duplicate atom ids', () => {
    expect(() =>
      parseVisualization({
        kind: 'ball_stick',
        atoms: [
          { id: 'A1', element: 'C', position: [0, 0, 0] },
          { id: 'A1', element: 'C', position: [1, 0, 0] }
        ],
        bonds: []
      })
    ).toThrow()
  })

  it('rejects non-finite positions', () => {
    expect(() =>
      parseVisualization({
        kind: 'ball_stick',
        atoms: [{ id: 'A1', element: 'C', position: [Number.NaN, 0, 0] }],
        bonds: []
      })
    ).toThrow()
  })

  it('rejects an unknown kind', () => {
    expect(() =>
      parseVisualization({ kind: 'something_else', atoms: [], bonds: [] })
    ).toThrow()
  })
})

describe('visualizationSchema · curve', () => {
  it('accepts a valid curve geometry', () => {
    const valid = parseVisualization({
      kind: 'curve',
      points: [
        [1, 0, 0],
        [0, 1, 1],
        [-1, 0, 2],
        [0, -1, 3]
      ],
      label: '磁场螺旋'
    })
    expect(valid.kind).toBe('curve')
    if (valid.kind === 'curve') {
      expect(valid.points.length).toBe(4)
      expect(valid.secondaryPoints).toBeUndefined()
    }
  })

  it('accepts curve with secondaryPoints (DNA-style)', () => {
    const valid = parseVisualization({
      kind: 'curve',
      points: [
        [1, 0, 0],
        [0, 1, 1]
      ],
      secondaryPoints: [
        [-1, 0, 0],
        [0, -1, 1]
      ],
      label: 'DNA 双螺旋'
    })
    expect(valid.kind).toBe('curve')
    if (valid.kind === 'curve') {
      expect(valid.secondaryPoints?.length).toBe(2)
    }
  })

  it('rejects empty points', () => {
    expect(() => parseVisualization({ kind: 'curve', points: [] })).toThrow()
  })

  it('rejects a single point (need a polyline)', () => {
    expect(() =>
      parseVisualization({ kind: 'curve', points: [[0, 0, 0]] })
    ).toThrow()
  })

  it('rejects non-triple points', () => {
    expect(() =>
      parseVisualization({ kind: 'curve', points: [[0, 0], [1, 1]] })
    ).toThrow()
  })

  it('rejects non-finite coordinates', () => {
    expect(() =>
      parseVisualization({
        kind: 'curve',
        points: [
          [0, 0, 0],
          [Number.NaN, 0, 1]
        ]
      })
    ).toThrow()
  })

  it('rejects secondaryPoints that are too short', () => {
    expect(() =>
      parseVisualization({
        kind: 'curve',
        points: [
          [0, 0, 0],
          [1, 0, 0]
        ],
        secondaryPoints: [[0, 1, 0]]
      })
    ).toThrow()
  })

  it('routes ball_stick, curve, and primitives via union', () => {
    const ball = parseVisualization({
      kind: 'ball_stick',
      atoms: [{ id: 'A1', element: 'C', position: [0, 0, 0] }],
      bonds: []
    })
    const curve = parseVisualization({
      kind: 'curve',
      points: [
        [0, 0, 0],
        [1, 0, 0]
      ]
    })
    const primitives = parseVisualization({
      kind: 'primitives',
      nodes: [{ id: 'N1', position: [0, 0, 0] }],
      edges: []
    })
    expect(ball.kind).toBe('ball_stick')
    expect(curve.kind).toBe('curve')
    expect(primitives.kind).toBe('primitives')
  })
})

describe('visualizationSchema · primitives', () => {
  it('accepts a valid circuit graph', () => {
    const valid = parseVisualization({
      kind: 'primitives',
      nodes: [
        { id: 'V', label: '电源', position: [-2, 0, 0], role: 'source' },
        { id: 'R', label: 'R', position: [2, 0, 0], role: 'resistor' }
      ],
      edges: [{ from: 'V', to: 'R', label: '导线' }],
      label: '串联电路'
    })
    expect(valid.kind).toBe('primitives')
    if (valid.kind === 'primitives') {
      expect(valid.nodes.length).toBe(2)
      expect(valid.edges.length).toBe(1)
    }
  })

  it('rejects empty nodes', () => {
    expect(() =>
      parseVisualization({ kind: 'primitives', nodes: [], edges: [] })
    ).toThrow()
  })

  it('rejects edges referencing missing nodes', () => {
    expect(() =>
      parseVisualization({
        kind: 'primitives',
        nodes: [{ id: 'A', position: [0, 0, 0] }],
        edges: [{ from: 'A', to: 'NOPE' }]
      })
    ).toThrow()
  })

  it('rejects duplicate node ids', () => {
    expect(() =>
      parseVisualization({
        kind: 'primitives',
        nodes: [
          { id: 'A', position: [0, 0, 0] },
          { id: 'A', position: [1, 0, 0] }
        ],
        edges: []
      })
    ).toThrow()
  })
})

describe('generateVisualization · fallback paths', () => {
  it('returns invalid for an empty description', async () => {
    const result = await generateVisualization('   ')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid')
  })

  it('returns no-llm when LLM env is unset', async () => {
    // LLM_* env is not configured in the test environment.
    const result = await generateVisualization('氨气分子 NH3')
    if (result.ok) {
      // If an LLM happens to be configured, accept any known kind from the prompt.
      expect(['ball_stick', 'curve', 'primitives']).toContain(
        result.visualization.kind
      )
    } else {
      expect(['no-llm', 'llm-failed']).toContain(result.reason)
    }
  })
})
