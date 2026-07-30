/**
 * registry — assignment id → scene descriptor for the unified Visualizer
 * (ADR-0013). Replaces the scattered `assignment.id === 'xxx' && <Canvas>`
 * blocks in App.tsx with a single registry lookup.
 *
 * Two scene kinds:
 *  - 'r3f': true 3D scene rendered via @react-three/fiber (molecule, cube
 *    section). These need z-axis free observation, so they get OrbitControls.
 *    Loaded lazily (React.lazy) so three/fiber/drei stay out of the first
 *    paint chunk.
 *  - 'canvas2d': 2D canvas scene (projectile parabola). 2D parametric curves
 *    do not need a 3D engine; keeping them on 2D canvas avoids a 600KB gold
 *    hammer (per ADR-0011).
 *
 * The registry is the single routing point; App.tsx just renders
 * <Visualizer assignment={...} submission={...} />.
 */

export type SceneKind = 'r3f' | 'canvas2d'

export interface SceneDescriptor {
  kind: SceneKind
  /** assignment ids that route to this scene */
  assignmentIds: readonly string[]
}

/** All scenes in priority order; first match wins. */
export const SCENES: readonly SceneDescriptor[] = [
  {
    kind: 'r3f',
    assignmentIds: ['chem-vsepr-methane', 'chem-vsepr-water']
  },
  {
    kind: 'r3f',
    assignmentIds: ['cube-section']
  },
  {
    kind: 'r3f',
    assignmentIds: ['chem-crystal-nacl', 'chem-crystal-diamond']
  },
  {
    kind: 'canvas2d',
    assignmentIds: ['physics-projectile-xy', 'physics-projectile-y']
  }
]

/** Look up the scene kind for an assignment id, or null if none registered. */
export function lookupScene(assignmentId: string): SceneKind | null {
  for (const scene of SCENES) {
    if (scene.assignmentIds.includes(assignmentId)) return scene.kind
  }
  return null
}
