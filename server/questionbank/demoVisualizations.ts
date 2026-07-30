/**
 * Pre-seeded curve visualizations for demo assignments (ADR-0015 Phase 4/6).
 * No LLM required — pure math point sampling for magnetic helix / DNA.
 */
import type { Visualization } from '../../shared/contracts'
import type { QuestionStore } from './QuestionStore'
import { SEED_AUTHOR_ID, seedQuestionId } from './seedFromAssignments'

/** Sample a magnetic-field helix: constant radius, uniform advance along z. */
export function sampleMagneticHelix(
  turns = 2.5,
  samples = 120,
  radius = 1.2
): Array<readonly [number, number, number]> {
  const points: Array<readonly [number, number, number]> = []
  const total = Math.max(2, samples)
  for (let i = 0; i < total; i++) {
    const t = (i / (total - 1)) * turns * Math.PI * 2
    points.push([radius * Math.cos(t), radius * Math.sin(t), t * 0.35])
  }
  return points
}

/** Sample a DNA-like double helix (two strands, phase offset π). */
export function sampleDnaDoubleHelix(
  turns = 2,
  samples = 100,
  radius = 1
): {
  points: Array<readonly [number, number, number]>
  secondaryPoints: Array<readonly [number, number, number]>
} {
  const points: Array<readonly [number, number, number]> = []
  const secondaryPoints: Array<readonly [number, number, number]> = []
  const total = Math.max(2, samples)
  for (let i = 0; i < total; i++) {
    const t = (i / (total - 1)) * turns * Math.PI * 2
    const z = t * 0.4
    points.push([radius * Math.cos(t), radius * Math.sin(t), z])
    secondaryPoints.push([
      radius * Math.cos(t + Math.PI),
      radius * Math.sin(t + Math.PI),
      z
    ])
  }
  return { points, secondaryPoints }
}

export const MAGNETIC_HELIX_VISUALIZATION: Visualization = {
  kind: 'curve',
  points: sampleMagneticHelix(),
  label: '磁场螺旋轨迹'
}

const dna = sampleDnaDoubleHelix()
export const DNA_DOUBLE_HELIX_VISUALIZATION: Visualization = {
  kind: 'curve',
  points: dna.points,
  secondaryPoints: dna.secondaryPoints,
  label: 'DNA 双螺旋'
}

/** assignmentId → visualization applied to seed:<assignmentId> on boot. */
const DEMO_CURVE_VISUALIZATIONS: Readonly<Record<string, Visualization>> = {
  'physics-magnetic-helix': MAGNETIC_HELIX_VISUALIZATION,
  'bio-dna-double-helix': DNA_DOUBLE_HELIX_VISUALIZATION
}

/**
 * Ensure demo seed questions carry pre-sampled curve visualizations.
 * Idempotent: only writes when missing or kind differs (never clobber a
 * teacher-confirmed different geometry if somehow stored under seed id).
 * Seed rows are system-owned; safe to refresh demo curve defaults when empty.
 */
export function ensureDemoCurveVisualizations(store: QuestionStore): number {
  let updated = 0
  for (const [assignmentId, visualization] of Object.entries(
    DEMO_CURVE_VISUALIZATIONS
  )) {
    const id = seedQuestionId(assignmentId)
    const existing = store.get(id)
    if (!existing) continue
    if (existing.authorId !== SEED_AUTHOR_ID) continue
    if (existing.visualization?.kind === 'curve') continue
    store.save({ ...existing, visualization })
    updated += 1
  }
  return updated
}
