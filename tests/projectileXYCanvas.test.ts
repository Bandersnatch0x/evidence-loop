// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { computeXYTrajectory } from '../src/components/student/trajectoryEval'

const PARAMS = { v0: 10, theta: Math.PI / 4, g: 9.8, tMax: 2, samples: 4 }

describe('computeXYTrajectory · full projectile x(t),y(t)', () => {
  it('samples both x and y for a correct two-line submission', () => {
    const pts = computeXYTrajectory(
      'x = v0*cos(theta)*t\ny = v0*sin(theta)*t - 0.5*g*t^2',
      PARAMS
    )
    expect(pts).not.toBeNull()
    const v0x = 10 * Math.cos(Math.PI / 4)
    const v0y = 10 * Math.sin(Math.PI / 4)
    const ts = [0, 0.5, 1.0, 1.5, 2.0]
    pts!.forEach((p, i) => {
      expect(p.t).toBeCloseTo(ts[i]!, 6)
      expect(p.x).toBeCloseTo(v0x * ts[i]!, 6)
      expect(p.y).toBeCloseTo(v0y * ts[i]! - 0.5 * 9.8 * ts[i]! * ts[i]!, 6)
    })
  })

  it('parses JSON object form too', () => {
    const pts = computeXYTrajectory(
      '{"x":"v0*cos(theta)*t","y":"v0*sin(theta)*t-0.5*g*t^2"}',
      PARAMS
    )
    expect(pts).not.toBeNull()
    expect(pts![0]!.x).toBe(0)
    expect(pts![0]!.y).toBe(0)
  })

  it('returns null when y is missing', () => {
    expect(computeXYTrajectory('x = v0*cos(theta)*t', PARAMS)).toBeNull()
  })

  it('returns null when x is missing', () => {
    expect(
      computeXYTrajectory('y = v0*sin(theta)*t - 0.5*g*t^2', PARAMS)
    ).toBeNull()
  })

  it('returns null when x expression is unparseable', () => {
    expect(
      computeXYTrajectory('x = @@@bad@@@\ny = v0*sin(theta)*t', PARAMS)
    ).toBeNull()
  })

  it('diverges for a wrong x (cos vs sin) — the curve shape differs', () => {
    const P = { ...PARAMS, theta: Math.PI / 6 } // cos≠sin clearly
    const correct = computeXYTrajectory(
      'x = v0*cos(theta)*t\ny = v0*sin(theta)*t - 0.5*g*t^2',
      P
    )!
    const wrongX = computeXYTrajectory(
      'x = v0*sin(theta)*t\ny = v0*sin(theta)*t - 0.5*g*t^2',
      P
    )!
    // At t=1.5, correct x uses cos, wrong uses sin → different x values
    const cx = correct.find((p) => p.t === 1.5)!.x
    const wx = wrongX.find((p) => p.t === 1.5)!.x
    expect(Math.abs(cx - wx)).toBeGreaterThan(0.5)
  })
})
