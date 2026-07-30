/**
 * Pre-seeded visualizations for demo assignments (ADR-0015).
 * No LLM required — pure data for magnetic helix / DNA / circuit graph.
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

/** Simple series circuit: source → switch → resistor → back to source. */
export function sampleSeriesCircuit(): Visualization {
  return {
    kind: 'primitives',
    label: '串联电路示意',
    nodes: [
      { id: 'V', label: '电源', position: [-2, 0, 0], role: 'source' },
      { id: 'S', label: '开关', position: [0, 1.2, 0], role: 'switch' },
      { id: 'R', label: 'R', position: [2, 0, 0], role: 'resistor' },
      { id: 'G', label: '地', position: [0, -1.2, 0], role: 'ground' }
    ],
    edges: [
      { from: 'V', to: 'S', label: '导线' },
      { from: 'S', to: 'R' },
      { from: 'R', to: 'G' },
      { from: 'G', to: 'V', label: '回路' }
    ]
  }
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

export const SERIES_CIRCUIT_VISUALIZATION: Visualization = sampleSeriesCircuit()

/** assignmentId → visualization applied to seed:<assignmentId> on boot. */
const DEMO_VISUALIZATIONS: Readonly<Record<string, Visualization>> = {
  'physics-magnetic-helix': MAGNETIC_HELIX_VISUALIZATION,
  'bio-dna-double-helix': DNA_DOUBLE_HELIX_VISUALIZATION,
  // Attach circuit schematic to the existing Ohm-law numeric demo.
  'numeric-ohm-law': SERIES_CIRCUIT_VISUALIZATION
}

/**
 * Ensure demo seed questions carry pre-built visualizations.
 * Idempotent: only writes when visualization is missing (never clobber
 * teacher-or-prior data under the seed id).
 */
export function ensureDemoCurveVisualizations(store: QuestionStore): number {
  let updated = 0
  for (const [assignmentId, visualization] of Object.entries(DEMO_VISUALIZATIONS)) {
    const id = seedQuestionId(assignmentId)
    const existing = store.get(id)
    if (!existing) continue
    if (existing.authorId !== SEED_AUTHOR_ID) continue
    if (existing.visualization !== undefined) continue
    store.save({ ...existing, visualization })
    updated += 1
  }
  return updated
}

/** Alias — covers curve + primitives demo seeds. */
export const ensureDemoVisualizations = ensureDemoCurveVisualizations
