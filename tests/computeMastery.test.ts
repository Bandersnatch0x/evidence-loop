// @vitest-environment node

import { describe, expect, it } from 'vitest'
import type { MasteryEvidence } from '../shared/contracts'
import { computeMastery } from '../server/mastery/computeMastery'

function evidence(
  overrides: Partial<MasteryEvidence> & Pick<MasteryEvidence, 'id' | 'score' | 'weight'>
): MasteryEvidence {
  return {
    kpId: 'kp.test',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

describe('computeMastery (simple.v1)', () => {
  it('returns 0 for an empty evidence array', () => {
    expect(computeMastery([])).toBe(0)
  })

  it('is deterministic for the same multiset of inputs', () => {
    const input = [
      evidence({ id: 'a', score: 1, weight: 2 }),
      evidence({ id: 'b', score: 0, weight: 1 }),
      evidence({ id: 'c', score: 0.5, weight: 1 })
    ]
    const first = computeMastery(input)
    const second = computeMastery(input)
    expect(first).toBe(second)
    // (1*2 + 0*1 + 0.5*1) / 4 = 2.5/4 = 0.625
    expect(first).toBeCloseTo(0.625, 10)
  })

  it('is order-independent (commutative weighted sum)', () => {
    const a = [
      evidence({ id: 'a', score: 1, weight: 3 }),
      evidence({ id: 'b', score: 0, weight: 1 }),
      evidence({ id: 'c', score: 0.5, weight: 2 })
    ]
    const b = [a[2]!, a[0]!, a[1]!]
    expect(computeMastery(a)).toBeCloseTo(computeMastery(b), 12)
  })

  it('returns 0 when total weight is zero', () => {
    expect(
      computeMastery([
        evidence({ id: 'a', score: 1, weight: 0 }),
        evidence({ id: 'b', score: 0, weight: 0 })
      ])
    ).toBe(0)
  })
})
