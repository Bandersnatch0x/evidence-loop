/**
 * CubeSectionScene — true 3D cube + learner section polygon via
 * @react-three/fiber (ADR-0013). Replaces the isometric CubeSectionCanvas
 * with an orbitable model.
 *
 * Geometry source: UNIT_CUBE_VERTICES + CUBE_EDGES from cubeProjection.ts,
 * the same constants shared (by value) with the GeometryRunnerSpec on the
 * server and guarded by tests/cubeSectionCanvas.test.ts. R3F feeds those 3D
 * coordinates to Three.js; the canonical vertex table is unchanged.
 *
 * Per ADR-0010: renders the LEARNER'S submitted section polygon (blue
 * highlight), never the standard answer. The render-artifact evidence
 * (weight=0) records the params a teacher replays; the scene is presentation.
 */
import { Canvas } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import { Suspense } from 'react'
import * as THREE from 'three'
import {
  CUBE_EDGES,
  UNIT_CUBE_VERTICES,
  parseVertexIds,
  type Vec3
} from '../../student/cubeProjection'
import { OrbitRig } from '../shared/OrbitRig'

const VERTEX_IDS = Object.keys(UNIT_CUBE_VERTICES)

function CubeEdges() {
  const points: number[] = []
  for (const [a, b] of CUBE_EDGES) {
    const pa = UNIT_CUBE_VERTICES[a]
    const pb = UNIT_CUBE_VERTICES[b]
    if (!pa || !pb) continue
    points.push(pa[0], pa[1], pa[2], pb[0], pb[1], pb[2])
  }
  const positions = new Float32Array(points)
  return (
    <lineSegments>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
      </bufferGeometry>
      <lineBasicMaterial color="#9ca3af" linewidth={1} />
    </lineSegments>
  )
}

function VertexLabels() {
  return (
    <>
      {VERTEX_IDS.map((id) => {
        const v = UNIT_CUBE_VERTICES[id]!
        return (
          <mesh key={id} position={[v[0], v[1] + 0.12, v[2]]}>
            <sphereGeometry args={[0.05, 12, 12]} />
            <meshBasicMaterial color="#6b7280" />
          </mesh>
        )
      })}
    </>
  )
}

function SectionPolygon({ submission }: { submission: string }) {
  const submittedIds = parseVertexIds(submission)
  const known = new Set(VERTEX_IDS)
  const pts: Vec3[] = submittedIds
    .filter((id) => known.has(id))
    .map((id) => UNIT_CUBE_VERTICES[id]!)
    .filter((v): v is Vec3 => v !== undefined)
  // De-duplicate while preserving order.
  const unique = [...new Map(pts.map((p) => [p.join(','), p])).values()]
  if (unique.length < 3) return null
  const positions = new Float32Array(unique.flatMap((p) => [p[0], p[1], p[2]]))
  // Build polygon triangulation as a triangle fan from vertex 0.
  const indices: number[] = []
  for (let i = 1; i < unique.length - 1; i++) {
    indices.push(0, i, i + 1)
  }
  return (
    <group>
      <mesh>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          <bufferAttribute attach="index" args={[new Uint16Array(indices), 1]} />
        </bufferGeometry>
        <meshStandardMaterial
          color="#2563eb"
          transparent
          opacity={0.28}
          side={THREE.DoubleSide}
          roughness={0.5}
        />
      </mesh>
      <Line
        points={unique.map((p) => new THREE.Vector3(p[0], p[1], p[2]))}
        color="#2563eb"
        lineWidth={2.5}
      />
    </group>
  )
}

export interface CubeSectionSceneProps {
  submission: string
}

export function CubeSectionScene({ submission }: CubeSectionSceneProps) {
  return (
    <div className="cube-section-canvas" style={{ marginTop: 12 }}>
      <div style={{ fontSize: 13, color: '#374151', marginBottom: 4 }}>
        你的截面（蓝色高亮，3D 可拖动旋转，实时反映当前提交）
      </div>
      <Canvas
        style={{ width: 420, height: 320 }}
        camera={{ position: [3.5, 2.8, 3.5], fov: 45 }}
        role="img"
        aria-label="正方体与当前提交截面的三维示意图，可拖动旋转"
      >
        <OrbitRig>
          <Suspense fallback={null}>
            <CubeEdges />
            <VertexLabels />
            <SectionPolygon submission={submission} />
          </Suspense>
        </OrbitRig>
      </Canvas>
    </div>
  )
}
