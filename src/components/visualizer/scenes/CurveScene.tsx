/**
 * CurveScene — R3F polyline renderer for teacher-authored curve visualizations
 * (ADR-0015 Phase 4/8). Pre-sampled points via drei `<Line>` + OrbitRig.
 * Optional secondaryPoints (DNA strand) and crossBars (base-pair rungs).
 *
 * Presentation only; never enters the scoring evidence chain.
 */
import { Canvas } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import { Suspense, useMemo } from 'react'
import * as THREE from 'three'
import type { CurveVisualization } from '../../../../shared/contracts'
import { OrbitRig } from '../shared/OrbitRig'

export interface CurveSceneProps {
  visualization: CurveVisualization
}

function toVectors(points: readonly (readonly [number, number, number])[]) {
  return points.map((p) => new THREE.Vector3(p[0], p[1], p[2]))
}

/** Max radius from origin across polylines and cross-bar endpoints. */
function cameraDistanceFromPoints(
  ...polylines: Array<readonly (readonly [number, number, number])[] | undefined>
): number {
  let maxR = 0
  for (const poly of polylines) {
    if (!poly) continue
    for (const p of poly) {
      const r = Math.hypot(p[0], p[1], p[2])
      if (r > maxR) maxR = r
    }
  }
  return Math.max(3.2, maxR * 2.4)
}

export function CurveScene({ visualization }: CurveSceneProps) {
  const { points, secondaryPoints, crossBars, label } = visualization

  const barEndpoints = useMemo(() => {
    if (!crossBars || crossBars.length === 0) return undefined
    return crossBars.flatMap((bar) => [bar[0], bar[1]])
  }, [crossBars])

  const cameraDistance = useMemo(
    () => cameraDistanceFromPoints(points, secondaryPoints, barEndpoints),
    [points, secondaryPoints, barEndpoints]
  )

  const primaryLine = useMemo(() => toVectors(points), [points])
  const secondaryLine = useMemo(
    () =>
      secondaryPoints && secondaryPoints.length >= 2
        ? toVectors(secondaryPoints)
        : null,
    [secondaryPoints]
  )

  return (
    <div className="curve-canvas" style={{ marginTop: 12 }}>
      <div style={{ fontSize: 13, color: '#374151', marginBottom: 4 }}>
        {label ?? '3D 曲线演示（可拖动旋转）'}
        <span style={{ marginLeft: 8, color: '#9ca3af', fontSize: 12 }}>
          教师生成 · 已确认
        </span>
      </div>
      <Canvas
        style={{ width: 380, height: 320 }}
        camera={{
          position: [
            cameraDistance * 0.7,
            cameraDistance * 0.5,
            cameraDistance * 0.8
          ],
          fov: 45
        }}
        role="img"
        aria-label={`${label ?? '教师生成的'} 三维曲线，可拖动旋转`}
      >
        <OrbitRig showAxes={false}>
          <Suspense fallback={null}>
            <Line points={primaryLine} color="#2563eb" lineWidth={2.5} />
            {secondaryLine ? (
              <Line points={secondaryLine} color="#dc2626" lineWidth={2.5} />
            ) : null}
            {crossBars?.map((bar, i) => (
              <Line
                key={`bar-${i}`}
                points={[
                  new THREE.Vector3(bar[0][0], bar[0][1], bar[0][2]),
                  new THREE.Vector3(bar[1][0], bar[1][1], bar[1][2])
                ]}
                color="#a3a3a3"
                lineWidth={1.5}
              />
            ))}
          </Suspense>
        </OrbitRig>
      </Canvas>
    </div>
  )
}
