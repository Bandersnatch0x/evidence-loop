/**
 * CrystalScene — true 3D unit-cell ball-and-stick via @react-three/fiber
 * (ADR-0014). First subject-matter extension of the Phase 1 visualizer suite.
 *
 * Geometry source: NACL_GEOMETRY / DIAMOND_GEOMETRY from crystalProjection.ts
 * (guarded by tests/crystalProjection.test.ts — coordination, bond angles).
 * R3F feeds those fractional [0,1]³ coordinates to Three.js, mapped to a
 * centred ±1 box so the default camera frames the cell.
 *
 * Per ADR 0009/0014: renders the canonical crystal structure for the
 * assignment, NOT the student's submitted text. Scoring rests on the
 * fill_blank text match; render params are not evidence.
 */
import { Canvas } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import { Suspense } from 'react'
import * as THREE from 'three'
import {
  CELL_CORNERS,
  CELL_EDGES,
  CRYSTAL_GEOMETRIES
} from '../../student/crystalProjection'
import { Atom, Bond } from '../shared/BallStick'
import { OrbitRig } from '../shared/OrbitRig'

// Map fractional [0,1]³ to a centred ±1 box.
const toView = (p: readonly [number, number, number]): [number, number, number] => [
  p[0] * 2 - 1,
  p[1] * 2 - 1,
  p[2] * 2 - 1
]

const LABELS: Readonly<Record<string, string>> = {
  'chem-crystal-nacl': '晶体结构（3D 球棍，可拖动旋转；绿=Cl，紫=Na）',
  'chem-crystal-diamond': '金刚石晶胞（3D 球棍，可拖动旋转）'
}

export interface CrystalSceneProps {
  assignmentId: string
}

export function CrystalScene({ assignmentId }: CrystalSceneProps) {
  const geometry = CRYSTAL_GEOMETRIES[assignmentId]
  if (!geometry) return null
  const positionById = new Map(geometry.atoms.map((a) => [a.id, toView(a.position)]))
  const corners = CELL_CORNERS.map(toView)

  return (
    <div className="crystal-canvas" style={{ marginTop: 12 }}>
      <div style={{ fontSize: 13, color: '#374151', marginBottom: 4 }}>
        {LABELS[assignmentId] ?? '晶体结构（3D 球棍，可拖动旋转）'}
      </div>
      <Canvas
        style={{ width: 420, height: 340 }}
        camera={{ position: [3.5, 2.8, 3.5], fov: 45 }}
        role="img"
        aria-label={`${assignmentId} 晶胞的三维球棍模型，可拖动旋转`}
      >
        <OrbitRig showAxes={false}>
          <Suspense fallback={null}>
            {/* Unit-cell wireframe (dashed, faint). */}
            {CELL_EDGES.map(([a, b], i) => (
              <Line
                key={`cell-${i}`}
                points={[new THREE.Vector3(...corners[a]!), new THREE.Vector3(...corners[b]!)]}
                color="#9ca3af"
                lineWidth={1}
                dashed
                dashScale={4}
              />
            ))}
            {geometry.bonds.map((bond, i) => {
              const from = positionById.get(bond.from)
              const to = positionById.get(bond.to)
              if (!from || !to) return null
              return <Bond key={`bond-${i}`} from={from} to={to} />
            })}
            {geometry.atoms.map((atom) => (
              <Atom
                key={atom.id}
                position={toView(atom.position)}
                element={atom.element}
                showLabel={false}
              />
            ))}
          </Suspense>
        </OrbitRig>
      </Canvas>
    </div>
  )
}
