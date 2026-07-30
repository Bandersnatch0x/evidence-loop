/**
 * Visualizer — unified entry for all demo visualizations (ADR-0013).
 * Replaces the scattered `assignment.id === 'xxx' && <Canvas>` blocks in
 * App.tsx with a single component that routes by assignment id via the
 * registry.
 *
 * R3F scenes (molecule, cube section) are React.lazy-loaded so three /
 * @react-three/fiber / @react-three/drei (~600KB) stay out of the first-paint
 * chunk — they only download when the learner opens a 3D assignment. The 2D
 * projectile canvas is static-imported (no 3D engine cost).
 *
 * 3D is presentation only; it never enters the scoring evidence chain
 * (ADR-0001/0009/0010/0012). Render data comes from the same canonical
 * constants the runners/tests use — no hidden second source.
 */
import { Suspense, lazy } from 'react'
import type { Assignment } from '../../../shared/contracts'
import { lookupScene } from './registry'

const MoleculeScene = lazy(() =>
  import('./scenes/MoleculeScene').then((m) => ({ default: m.MoleculeScene }))
)
const CubeSectionScene = lazy(() =>
  import('./scenes/CubeSectionScene').then((m) => ({ default: m.CubeSectionScene }))
)
// 2D canvas — no lazy split needed (no 3D engine cost), but keep the same
// registry-driven dispatch. Import statically.
import { ProjectileScene } from './scenes/ProjectileScene'

export interface VisualizerProps {
  assignment: Assignment
  submission: string
}

const SCENE_FALLBACK = (
  <div style={{ marginTop: 12, fontSize: 13, color: '#6b7280' }}>
    正在加载 3D 场景...
  </div>
)

export function Visualizer({ assignment, submission }: VisualizerProps) {
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
      ) : (
        <MoleculeScene assignmentId={assignment.id} />
      )}
    </Suspense>
  )
}
