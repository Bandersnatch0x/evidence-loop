// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { computeTrajectory } from '../src/components/student/trajectoryEval'

const PARAMS = { v0: 10, theta: Math.PI / 4, g: 9.8, tMax: 2, samples: 4 }

describe('computeTrajectory · projectile y(t)', () => {
  it('samples the correct y(t)=v0*sin(θ)*t - 0.5*g*t^2', () => {
    const pts = computeTrajectory('y = v0*sin(theta)*t - 0.5*g*t^2', PARAMS)
    expect(pts).not.toBeNull()
    const v0y = 10 * Math.sin(Math.PI / 4)
    const expected = [0, 0.5, 1.0, 1.5, 2.0].map((t) => v0y * t - 0.5 * 9.8 * t * t)
    expect(pts!.map((p) => p.t)).toEqual([0, 0.5, 1.0, 1.5, 2.0])
    pts!.forEach((p, i) => {
      expect(p.y).toBeCloseTo(expected[i]!, 6)
    })
  })

  it('diverges for a wrong submission (cos instead of sin)', () => {
    // θ=π/6 → sin=0.5, cos≈0.866, so the two curves clearly separate.
    const P = { v0: 10, theta: Math.PI / 6, g: 9.8, tMax: 2, samples: 4 }
    const correct = computeTrajectory('y = v0*sin(theta)*t - 0.5*g*t^2', P)!
    const wrong = computeTrajectory('y = v0*cos(theta)*t - 0.5*g*t^2', P)!
    expect(wrong).not.toBeNull()
    const c15 = correct.find((p) => p.t === 1.5)!.y
    const w15 = wrong.find((p) => p.t === 1.5)!.y
    expect(Math.abs(c15 - w15)).toBeGreaterThan(0.5)
  })

  it('returns null for unparseable submission', () => {
    expect(computeTrajectory('@@@not an equation@@@', PARAMS)).toBeNull()
    expect(computeTrajectory('', PARAMS)).toBeNull()
  })

  it('evaluates a submission written without the `y =` prefix', () => {
    const pts = computeTrajectory('v0*sin(theta)*t - 0.5*g*t^2', PARAMS)
    expect(pts).not.toBeNull()
    expect(pts![0]?.y).toBe(0)
  })
})
