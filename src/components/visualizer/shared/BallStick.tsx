/**
 * BallStick — shared ball-and-stick primitives for 3D scenes (ADR-0014).
 * Atom (sphere + element label) and Bond (cylinder along the bond vector).
 * Used by both MoleculeScene (single molecules) and CrystalScene (unit cells).
 *
 * Geometry is fed in from the canonical pure-function constants
 * (*Projection.ts); these components only render, never score (ADR-0013/0014).
 */
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { ELEMENT_COLORS } from '../../student/moleculeProjection'

const ATOM_RADIUS: Readonly<Record<string, number>> = {
  C: 0.28,
  O: 0.3,
  H: 0.18,
  Na: 0.26,
  Cl: 0.34
}

const BOND_RADIUS = 0.06

export function Atom({
  position,
  element,
  showLabel = true
}: {
  position: readonly [number, number, number]
  element: string
  showLabel?: boolean
}) {
  const color = ELEMENT_COLORS[element] ?? '#6b7280'
  const radius = ATOM_RADIUS[element] ?? 0.22
  return (
    <mesh position={position}>
      <sphereGeometry args={[radius, 24, 24]} />
      <meshStandardMaterial color={color} roughness={0.4} metalness={0.1} />
      {showLabel && (
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
      )}
    </mesh>
  )
}

/** Bond as a cylinder between two points. Caller resolves the coordinates. */
export function Bond({
  from,
  to
}: {
  from: readonly [number, number, number]
  to: readonly [number, number, number]
}) {
  const mid: [number, number, number] = [
    (from[0] + to[0]) / 2,
    (from[1] + to[1]) / 2,
    (from[2] + to[2]) / 2
  ]
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const dz = to[2] - from[2]
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1
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
