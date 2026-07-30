// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  CUBE_EDGES,
  parseVertexIds,
  projectIso,
  projectToViewport
} from '../src/components/student/cubeProjection'

const VERTICES = {
  A: [-1, -1, -1] as const,
  B: [1, -1, -1] as const,
  C: [1, 1, -1] as const,
  D: [-1, 1, -1] as const,
  E: [-1, -1, 1] as const,
  F: [1, -1, 1] as const,
  G: [1, 1, 1] as const,
  H: [-1, 1, 1] as const
}

describe('projectIso · isometric projection', () => {
  it('maps the origin to (0,0)', () => {
    expect(projectIso([0, 0, 0])).toEqual({ x: 0, y: 0 })
  })

  it('maps +x axis to (cos30, sin30)', () => {
    const p = projectIso([1, 0, 0])
    expect(p.x).toBeCloseTo(Math.cos(Math.PI / 6), 6)
    expect(p.y).toBeCloseTo(Math.sin(Math.PI / 6), 6)
  })

  it('maps +y axis to (-cos30, sin30) — foreshortened left', () => {
    const p = projectIso([0, 1, 0])
    expect(p.x).toBeCloseTo(-Math.cos(Math.PI / 6), 6)
    expect(p.y).toBeCloseTo(Math.sin(Math.PI / 6), 6)
  })

  it('maps +z axis straight up (x=0, y=-1)', () => {
    const p = projectIso([0, 0, 1])
    expect(p.x).toBe(0)
    expect(p.y).toBe(-1)
  })

  it('distinguishes all 8 cube vertices (no two collapse to one point)', () => {
    const pts = Object.values(VERTICES).map((v) => projectIso(v))
    const keys = new Set(pts.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`))
    expect(keys.size).toBe(8)
  })
})

describe('projectToViewport · fit to canvas', () => {
  it('returns empty for no points', () => {
    const r = projectToViewport([], 100, 100)
    expect(r.points).toEqual([])
  })

  it('fits all 8 cube vertices inside the canvas margins', () => {
    const width = 420
    const height = 320
    const margin = 24
    const r = projectToViewport(Object.values(VERTICES), width, height, margin)
    r.points.forEach((p) => {
      expect(p.x).toBeGreaterThanOrEqual(margin - 0.5)
      expect(p.x).toBeLessThanOrEqual(width - margin + 0.5)
      expect(p.y).toBeGreaterThanOrEqual(margin - 0.5)
      expect(p.y).toBeLessThanOrEqual(height - margin + 0.5)
    })
  })

  it('preserves relative ordering of vertices (A below E since E is above A)', () => {
    const r = projectToViewport(Object.values(VERTICES), 420, 320)
    const keys = Object.keys(VERTICES)
    const byId = (id: keyof typeof VERTICES) => r.points[keys.indexOf(id)]!
    // E = A + (0,0,1); +z goes up (lower y on screen) → E.y < A.y.
    expect(byId('E').y).toBeLessThan(byId('A').y)
  })
})

describe('CUBE_EDGES', () => {
  it('has exactly 12 edges', () => {
    expect(CUBE_EDGES.length).toBe(12)
  })
})

describe('parseVertexIds', () => {
  it('splits comma-separated ids and uppercases', () => {
    expect(parseVertexIds('a,b,c,d')).toEqual(['A', 'B', 'C', 'D'])
  })

  it('handles Chinese comma and mixed whitespace', () => {
    expect(parseVertexIds('A，B C， d')).toEqual(['A', 'B', 'C', 'D'])
  })

  it('deduplicates is NOT its job (caller dedups) — keeps repeats', () => {
    expect(parseVertexIds('A,A,B')).toEqual(['A', 'A', 'B'])
  })
})
