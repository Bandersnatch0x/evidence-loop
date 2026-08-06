/**
 * BallStickScene — generic 3D ball-and-stick renderer for a teacher-authored
 * visualization (ADR-0015). Unlike MoleculeScene/CrystalScene (which read
 * hardcoded constants), this scene takes its geometry from props — whatever
 * the teacher generated + confirmed.
 *
 * Reuses the shared BallStick (Atom/Bond) + OrbitRig. The geometry is
 * presentation only; scoring is untouched (ADR-0013/0015).
 *
 * Auto-fits the camera to the geometry's bounding box so arbitrary atom
 * counts/scaling stay framed.
 */
import { Canvas } from '@react-three/fiber'
import { Suspense, useMemo } from 'react'
import type { BallStickVisualization } from '../../../../shared/contracts'
import { Atom, Bond } from '../shared/BallStick'
import { OrbitRig } from '../shared/OrbitRig'

export interface BallStickSceneProps {
  visualization: BallStickVisualization
}

export function BallStickScene({ visualization }: BallStickSceneProps) {
  const { atoms, bonds, label } = visualization
  const positionById = useMemo(
    () => new Map(atoms.map((a) => [a.id, a.position])),
    [atoms]
  )

  // Camera distance from the geometry's bounding-sphere radius, so the scene
  // stays framed regardless of how the LLM scaled the coordinates.
  const cameraDistance = useMemo(() => {
    if (atoms.length === 0) return 4
    let maxR = 0
    for (const a of atoms) {
      const r = Math.hypot(a.position[0], a.position[1], a.position[2])
      if (r > maxR) maxR = r
    }
    return Math.max(3.2, maxR * 2.4)
  }, [atoms])

  return (
    <div className="viz-scene ball-stick-canvas">
      <div className="viz-scene-caption">
        {label ?? '3D 演示（可拖动旋转）'}
        <span className="viz-scene-hint">
          教师生成 · 已确认
        </span>
      </div>
      <Canvas
        style={{ width: 380, height: 320 }}
        camera={{ position: [cameraDistance * 0.7, cameraDistance * 0.5, cameraDistance * 0.8], fov: 45 }}
        role="img"
        aria-label={`${label ?? '教师生成的'} 三维球棍模型，可拖动旋转`}
      >
        <OrbitRig showAxes={false}>
          <Suspense fallback={null}>
            {bonds.map((bond, i) => {
              const from = positionById.get(bond.from)
              const to = positionById.get(bond.to)
              if (!from || !to) return null
              return <Bond key={`bond-${i}`} from={from} to={to} />
            })}
            {atoms.map((atom) => (
              <Atom key={atom.id} position={atom.position} element={atom.element} />
            ))}
          </Suspense>
        </OrbitRig>
      </Canvas>
    </div>
  )
}
