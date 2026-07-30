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
import { Html } from '@react-three/drei'
import { Suspense } from 'react'
import * as THREE from 'three'
import {
  ELEMENT_COLORS,
  MOLECULE_GEOMETRIES,
  type MoleculeGeometry
} from '../../student/moleculeProjection'
import { OrbitRig } from '../shared/OrbitRig'

const ATOM_RADIUS: Readonly<Record<string, number>> = { C: 0.28, O: 0.3, H: 0.18 }
const BOND_RADIUS = 0.06

function Atom({
  position,
  element
}: {
  position: readonly [number, number, number]
  element: string
}) {
  const color = ELEMENT_COLORS[element] ?? '#6b7280'
  const radius = ATOM_RADIUS[element] ?? 0.22
  return (
    <mesh position={position}>
      <sphereGeometry args={[radius, 24, 24]} />
      <meshStandardMaterial color={color} roughness={0.4} metalness={0.1} />
      <Html center distanceFactor={6} position={[0, radius + 0.12, 0]}>
        <span
          style={{
            color: '#374151',
            fontSize: 13,
            fontWeight: 600,
            userSelect: 'none',
            pointerEvents: 'none'
          }}
        >
          {element}
        </span>
      </Html>
    </mesh>
  )
}

function Bond({
  from,
  to,
  geometry
}: {
  from: string
  to: string
  geometry: MoleculeGeometry
}) {
  const a = geometry.atoms.find((x) => x.id === from)
  const b = geometry.atoms.find((x) => x.id === to)
  if (!a || !b) return null
  const mid: [number, number, number] = [
    (a.position[0] + b.position[0]) / 2,
    (a.position[1] + b.position[1]) / 2,
    (a.position[2] + b.position[2]) / 2
  ]
  const dx = b.position[0] - a.position[0]
  const dy = b.position[1] - a.position[1]
  const dz = b.position[2] - a.position[2]
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1
  // Cylinder default axis is +Y. Rotate +Y onto the bond direction.
  const quat = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(dx / len, dy / len, dz / len)
  )
  const euler = new THREE.Euler().setFromQuaternion(quat)
  return (
    <mesh position={mid} rotation={[euler.x, euler.y, euler.z]}>
      <cylinderGeometry args={[BOND_RADIUS, BOND_RADIUS, len, 12]} />
      <meshStandardMaterial color="#9ca3af" roughness={0.6} />
    </mesh>
  )
}

export interface MoleculeSceneProps {
  assignmentId: string
}

export function MoleculeScene({ assignmentId }: MoleculeSceneProps) {
  const molecule = MOLECULE_GEOMETRIES[assignmentId]
  if (!molecule) return null
  return (
    <div className="molecule-canvas" style={{ marginTop: 12 }}>
      <div style={{ fontSize: 13, color: '#374151', marginBottom: 4 }}>
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
            {molecule.bonds.map((bond) => (
              <Bond
                key={`${bond.from}-${bond.to}`}
                from={bond.from}
                to={bond.to}
                geometry={molecule}
              />
            ))}
            {molecule.atoms.map((atom) => (
              <Atom key={atom.id} position={atom.position} element={atom.element} />
            ))}
          </Suspense>
        </OrbitRig>
      </Canvas>
    </div>
  )
}
