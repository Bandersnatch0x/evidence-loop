/**
 * CurveScene — R3F polyline renderer for teacher-authored curve visualizations
 * (ADR-0015 Phase 4). Takes pre-sampled points from props and draws them with
 * drei `<Line>` + OrbitRig. Optional secondaryPoints draws a second strand
 * (DNA double helix) without a multi-strand schema.
 *
 * Presentation only; never enters the scoring evidence chain.
 *
 * Camera fit copies BallStickScene's bounding-sphere heuristic (ponytail:
 * two small copies beat a shared abstraction until a third scene needs it).
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

/** Max radius from origin across one or more polylines (same idea as BallStickScene). */
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
  const { points, secondaryPoints, label } = visualization

  const cameraDistance = useMemo(
    () => cameraDistanceFromPoints(points, secondaryPoints),
    [points, secondaryPoints]
  )

  const primaryLine = useMemo(() => toVectors(points), [points])
  const secondaryLine = useMemo(
    () => (secondaryPoints && secondaryPoints.length >= 2 ? toVectors(secondaryPoints) : null),
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
          </Suspense>
        </OrbitRig>
      </Canvas>
    </div>
  )
}
