/**
 * MoleculeScene — true 3D ball-and-stick via @react-three/fiber (ADR-0013).
 * Replaces the isometric MoleculeCanvas with an orbitable model.
 *
 * Geometry source: the same METHANE_GEOMETRY/WATER_GEOMETRY constants from
 * moleculeProjection.ts that the unit tests assert (109.47°, 104.5°). R3F
 * just feeds those 3D coordinates to Three.js; the canonical geometry is
 * unchanged and still guarded by tests/moleculeCanvas.test.ts.
 *
 * Per ADR 0009/0012: renders the molecule's canonical shape for the
 * assignment, NOT the student's submitted text. Scoring rests on the text
 * match (ObjectiveValidator); render params are not evidence.
 */
import { Canvas } from '@react-three/fiber'
import { Suspense } from 'react'
import { MOLECULE_GEOMETRIES } from '../../student/moleculeProjection'
import { Atom, Bond } from '../shared/BallStick'
import { OrbitRig } from '../shared/OrbitRig'

export interface MoleculeSceneProps {
  assignmentId: string
}

export function MoleculeScene({ assignmentId }: MoleculeSceneProps) {
  const molecule = MOLECULE_GEOMETRIES[assignmentId]
  if (!molecule) return null
  const positionById = new Map(molecule.atoms.map((a) => [a.id, a.position]))
  return (
    <div className="viz-scene molecule-canvas">
      <div className="viz-scene-caption">
        分子空间构型（3D 球棍，可拖动旋转）
      </div>
      <Canvas
        style={{ width: 360, height: 300 }}
        camera={{ position: [3, 2, 4], fov: 45 }}
        role="img"
        aria-label={`${assignmentId} 分子的三维球棍模型，可拖动旋转`}
      >
        <OrbitRig showAxes={false}>
          <Suspense fallback={null}>
            {molecule.bonds.map((bond) => {
              const from = positionById.get(bond.from)
              const to = positionById.get(bond.to)
              if (!from || !to) return null
              return <Bond key={`${bond.from}-${bond.to}`} from={from} to={to} />
            })}
            {molecule.atoms.map((atom) => (
              <Atom key={atom.id} position={atom.position} element={atom.element} />
            ))}
          </Suspense>
        </OrbitRig>
      </Canvas>
    </div>
  )
}
