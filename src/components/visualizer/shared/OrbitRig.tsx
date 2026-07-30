/**
 * OrbitRig — shared base for 3D R3F scenes (ADR-0013): ambient + directional
 * lighting, an optional axis triad, and OrbitControls for free z-axis
 * inspection.
 *
 * Rotation is an enhancement, not a dependency: each scene sets a default
 * camera position (via <Canvas camera=...>) that shows the structure clearly
 * at first paint (PRODUCT.md 老旧设备/键盘操作画像 — orbit is mouse-optional).
 * OrbitControls does not capture keyboard focus (Tab still leaves the canvas).
 */
import { OrbitControls } from '@react-three/drei'
import type { ReactNode } from 'react'

export interface OrbitRigProps {
  children: ReactNode
  /** show a faint axis triad for orientation (default true) */
  showAxes?: boolean
}

export function OrbitRig({ children, showAxes = true }: OrbitRigProps) {
  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 8, 5]} intensity={0.8} />
      <directionalLight position={[-6, -4, -6]} intensity={0.3} />
      {showAxes && <axesHelper args={[2.2]} />}
      {children}
      <OrbitControls
        enableDamping
        dampingFactor={0.1}
        minDistance={2}
        maxDistance={20}
        makeDefault
      />
    </>
  )
}
