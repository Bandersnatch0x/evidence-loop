/**
 * seedPresets — create built-in preset demonstrations for the seed question bank
 * (ticket #32). Replaces the deleted legacy visualization migration (#30/#31):
 * the demonstration studio is the new authoring path, but seed questions need
 * pre-built demonstrations so students see content out of the box.
 *
 * Idempotent: a preset is identified by a deterministic id keyed on the seed
 * question id. Re-runs skip questions whose seed question already has a primary
 * demonstration reference. Writes demo + approved version + primary reference
 * in one transaction so a crash never leaves an orphan demo without a link.
 */
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { DemonstrationService } from './DemonstrationService'
import { visualizationToSceneDocument } from './migration'
import type { Visualization } from '../../shared/contracts'

const SEED_DEMO_OWNER = 'system-builtin'

interface PresetSeed {
  questionId: string
  subject: string
  visualization: Visualization
}

/** Magnetic helix curve (physics). */
function magneticHelixViz(): Visualization {
  const points: Array<[number, number, number]> = []
  const turns = 3
  const steps = 48
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * turns * Math.PI * 2
    points.push([Math.cos(t), i / steps * 4, Math.sin(t)])
  }
  return { kind: 'curve', points, label: '磁场螺旋' }
}

/** DNA double helix (biology). */
function dnaHelixViz(): Visualization {
  const points: Array<[number, number, number]> = []
  const secondaryPoints: Array<[number, number, number]> = []
  const turns = 2.5
  const steps = 50
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * turns * Math.PI * 2
    points.push([Math.cos(t), i / steps * 4, Math.sin(t)])
    secondaryPoints.push([Math.cos(t + Math.PI), i / steps * 4, Math.sin(t + Math.PI)])
  }
  const crossBars: Array<[[number, number, number], [number, number, number]]> = []
  for (let i = 0; i < steps; i += 4) {
    crossBars.push([points[i]!, secondaryPoints[i]!])
  }
  return { kind: 'curve', points, secondaryPoints, crossBars, label: 'DNA 双螺旋' }
}

/** Series circuit primitives (physics/electricity). */
function circuitViz(): Visualization {
  return {
    kind: 'primitives',
    nodes: [
      { id: 'V', label: '电源', position: [-3, 0, 0], role: 'source' },
      { id: 'R1', label: 'R1', position: [0, 0, 0], role: 'resistor' },
      { id: 'R2', label: 'R2', position: [3, 0, 0], role: 'resistor' }
    ],
    edges: [
      { from: 'V', to: 'R1', label: '导线' },
      { from: 'R1', to: 'R2', label: '导线' },
      { from: 'R2', to: 'V', label: '回路' }
    ],
    label: '串联电路'
  }
}

const PRESETS: readonly PresetSeed[] = [
  { questionId: 'seed:physics-magnetic-helix', subject: 'physics', visualization: magneticHelixViz() },
  { questionId: 'seed:bio-dna-double-helix', subject: 'biology', visualization: dnaHelixViz() },
  { questionId: 'seed:numeric-ohm-law', subject: 'physics', visualization: circuitViz() }
]

export interface SeedPresetResult {
  created: number
  skipped: number
}

/**
 * Ensure every preset seed question has a primary demonstration reference.
 * Idempotent: skips questions that already have a primary reference.
 */
export function seedPresetDemonstrations(
  db: Database.Database,
  ownerId: string = SEED_DEMO_OWNER
): SeedPresetResult {
  const audit = (() => {}) as never
  const demo = new DemonstrationService({ db, audit })

  const hasPrimary = db.prepare(
    `SELECT id FROM demonstration_references WHERE question_id = ? AND role = 'primary'`
  )
  const insertReference = db.prepare(
    `INSERT INTO demonstration_references
       (id, question_id, kp_id, demo_version_id, role, ord)
     VALUES (?, ?, NULL, ?, 'primary', 0)`
  )
  const approve = db.prepare(`UPDATE demonstration_versions SET status = 'approved' WHERE id = ?`)

  let created = 0
  let skipped = 0

  for (const preset of PRESETS) {
    if (hasPrimary.get(preset.questionId) !== undefined) {
      skipped += 1
      continue
    }
    const document = visualizationToSceneDocument(preset.visualization)
    const isBallStick = preset.visualization.kind === 'ball_stick'
    const title =
      preset.visualization.kind === 'curve'
        ? preset.subject === 'physics'
          ? '磁场螺旋'
          : 'DNA 双螺旋'
        : '串联电路'
    const meta = {
      title,
      description: `内置预设演示（${preset.visualization.kind}）`,
      subject: preset.subject,
      grade: 'grade9',
      format: 'scene',
      space: isBallStick ? '3d' : '2d',
      behavior: 'interactive',
      source: 'preset'
    }
    db.transaction(() => {
      const demoId = demo.createDemonstration(ownerId, meta)
      demo.saveDraft(demoId, ownerId, document)
      const versionId = demo.submit(demoId, ownerId, {
        classification: preset.subject,
        license: 'CC-BY-4.0',
        aiDisclosure: 'none'
      })
      approve.run(versionId)
      insertReference.run(randomUUID(), preset.questionId, versionId)
    })()
    created += 1
  }

  return { created, skipped }
}
