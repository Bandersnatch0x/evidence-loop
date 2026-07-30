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
    expect(valid.atoms.length).toBe(3)
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
      // If an LLM happens to be configured, the structure must still validate.
      expect(result.visualization.kind).toBe('ball_stick')
    } else {
      expect(['no-llm', 'llm-failed']).toContain(result.reason)
    }
  })
})
