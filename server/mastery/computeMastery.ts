import type { MasteryEvidence } from '../../shared/contracts'

export const MASTERY_ALGORITHM_VERSION = 'simple.v1' as const

/**
 * Pure mastery aggregation (simple.v1).
 * Weighted average of evidence scores; empty input yields 0.
 * Order-independent for equal weights (commutative sum).
 */
export function computeMastery(evidences: readonly MasteryEvidence[]): number {
  if (evidences.length === 0) return 0

  let totalWeight = 0
  let weightedSum = 0

  for (const evidence of evidences) {
    totalWeight += evidence.weight
    weightedSum += evidence.score * evidence.weight
  }

  if (totalWeight <= 0) return 0
  return weightedSum / totalWeight
}
