import type { KnowledgePoint } from '../../shared/contracts'

/** Mastered gate mirrors server MASTERY_THRESHOLD (ADR-0007 §4). */
export const MASTERY_THRESHOLD = 0.6

export interface MasteryBand {
  id: 'strong' | 'developing' | 'weak' | 'untracked'
  label: string
}

/**
 * Map an evidence-derived score in [0, 1] onto a qualitative band.
 * `undefined` means the knowledge point has no mastery record yet.
 */
export function masteryBand(score: number | undefined): MasteryBand {
  if (score === undefined) return { id: 'untracked', label: '暂无证据' }
  if (score >= 0.85) return { id: 'strong', label: '已掌握' }
  if (score >= MASTERY_THRESHOLD) return { id: 'developing', label: '巩固中' }
  return { id: 'weak', label: '薄弱' }
}

/**
 * Indigo-to-pass colour gradient for a mastery cell. Untracked points render as
 * a neutral wash so the grid stays legible even with sparse data.
 */
export function masteryCellColor(score: number | undefined): string {
  if (score === undefined) return 'var(--surface-sunken)'
  const clamped = Math.max(0, Math.min(1, score))
  // Lightness drops as mastery rises: pale wash → saturated indigo.
  const lightness = 96 - clamped * 44
  const chroma = 0.02 + clamped * 0.11
  return `oklch(${lightness.toFixed(1)}% ${chroma.toFixed(3)} 252)`
}

/** Choose readable ink for a given cell background. */
export function masteryCellInk(score: number | undefined): string {
  if (score === undefined) return 'var(--ink-faint)'
  return score >= 0.55 ? 'oklch(98% 0.01 252)' : 'var(--ink)'
}

/** Build a kpId → display name lookup from the knowledge graph. */
export function buildKpNameMap(points: KnowledgePoint[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const point of points) {
    map.set(point.id, point.name)
  }
  return map
}

/** Resolve a kp display name, falling back to the raw id. */
export function kpName(names: Map<string, string>, kpId: string): string {
  return names.get(kpId) ?? kpId
}

/** Format a [0, 1] score as an integer percentage for display. */
export function toPercent(score: number): number {
  return Math.round(Math.max(0, Math.min(1, score)) * 100)
}
