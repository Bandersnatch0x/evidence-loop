/**
 * Visualizer — unified entry for all visualizations (ADR-0013/0015).
 *
 * Routing precedence:
 *  1. If the assignment carries a teacher-authored `visualization` (ADR-0015),
 *     dispatch by `kind` (ball_stick / curve / primitives).
 *     This wins over any hardcoded registry scene so a teacher's confirmed
 *     geometry overrides the default.
 *  2. Otherwise route by assignment id via the registry (built-in scenes).
 *  3. No match → render nothing.
 *
 * R3F scenes are React.lazy-loaded so three/fiber/drei (~600KB) stay out of
 * the first-paint chunk. The 2D projectile canvas is static-imported.
 *
 * 3D is presentation only; it never enters the scoring evidence chain
 * (ADR-0001/0009/0010/0012/0015).
 */
import { Suspense, lazy } from 'react'
import type { Assignment } from '../../../shared/contracts'
import { lookupScene } from './registry'

const BallStickScene = lazy(() =>
  import('./scenes/BallStickScene').then((m) => ({ default: m.BallStickScene }))
)
const CurveScene = lazy(() =>
  import('./scenes/CurveScene').then((m) => ({ default: m.CurveScene }))
)
const PrimitivesScene = lazy(() =>
  import('./scenes/PrimitivesScene').then((m) => ({ default: m.PrimitivesScene }))
)
const MoleculeScene = lazy(() =>
  import('./scenes/MoleculeScene').then((m) => ({ default: m.MoleculeScene }))
)
const CubeSectionScene = lazy(() =>
  import('./scenes/CubeSectionScene').then((m) => ({ default: m.CubeSectionScene }))
)
const CrystalScene = lazy(() =>
  import('./scenes/CrystalScene').then((m) => ({ default: m.CrystalScene }))
)
// 2D canvas — no lazy split needed (no 3D engine cost), but keep the same
// registry-driven dispatch. Import statically.
import { ProjectileScene } from './scenes/ProjectileScene'

export interface VisualizerProps {
  assignment: Assignment
  submission: string
}

const SCENE_FALLBACK = (
  <div className="viz-scene viz-scene-caption">
    正在加载 3D 场景...
  </div>
)

export function Visualizer({ assignment, submission }: VisualizerProps) {
  // ADR-0015: a teacher-authored visualization overrides everything.
  if (assignment.visualization) {
    const viz = assignment.visualization
    return (
      <Suspense fallback={SCENE_FALLBACK}>
        {viz.kind === 'curve' ? (
          <CurveScene visualization={viz} />
        ) : viz.kind === 'primitives' ? (
          <PrimitivesScene visualization={viz} />
        ) : (
          <BallStickScene visualization={viz} />
        )}
      </Suspense>
    )
  }

  const kind = lookupScene(assignment.id)
  if (kind === null) return null

  if (kind === 'canvas2d') {
    return <ProjectileScene assignmentId={assignment.id} submission={submission} />
  }

  // kind === 'r3f' — lazy-load the 3D engine chunk.
  return (
    <Suspense fallback={SCENE_FALLBACK}>
      {assignment.id === 'cube-section' ? (
        <CubeSectionScene submission={submission} />
      ) : assignment.id === 'chem-crystal-nacl' ||
        assignment.id === 'chem-crystal-diamond' ? (
        <CrystalScene assignmentId={assignment.id} />
      ) : (
        <MoleculeScene assignmentId={assignment.id} />
      )}
    </Suspense>
  )
}
