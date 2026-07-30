/**
 * PrimitivesScene — R3F node+edge graph for teacher-authored primitives
 * visualizations (ADR-0015 Phase 7). Circuits / schematics: spheres + Line
 * edges + Html labels. Presentation only; never scored.
 */
import { Canvas } from '@react-three/fiber'
import { Html, Line } from '@react-three/drei'
import { Suspense, useMemo } from 'react'
import * as THREE from 'three'
import type { PrimitivesVisualization } from '../../../../shared/contracts'
import { OrbitRig } from '../shared/OrbitRig'

export interface PrimitivesSceneProps {
  visualization: PrimitivesVisualization
}

const ROLE_COLORS: Readonly<Record<string, string>> = {
  source: '#dc2626',
  battery: '#dc2626',
  resistor: '#2563eb',
  load: '#2563eb',
  switch: '#d97706',
  junction: '#6b7280',
  ground: '#059669',
  default: '#4b5563'
}

function roleColor(role: string | undefined): string {
  if (!role) return ROLE_COLORS.default!
  return ROLE_COLORS[role] ?? ROLE_COLORS.default!
}

function cameraDistanceFromNodes(
  nodes: PrimitivesVisualization['nodes']
): number {
  let maxR = 0
  for (const n of nodes) {
    const r = Math.hypot(n.position[0], n.position[1], n.position[2])
    if (r > maxR) maxR = r
  }
  return Math.max(3.2, maxR * 2.4)
}

function EdgeLine({
  from,
  to,
  label
}: {
  from: readonly [number, number, number]
  to: readonly [number, number, number]
  label?: string
}) {
  const mid = useMemo(
    () =>
      new THREE.Vector3(
        (from[0] + to[0]) / 2,
        (from[1] + to[1]) / 2 + 0.15,
        (from[2] + to[2]) / 2
      ),
    [from, to]
  )
  return (
    <group>
      <Line
        points={[
          new THREE.Vector3(from[0], from[1], from[2]),
          new THREE.Vector3(to[0], to[1], to[2])
        ]}
        color="#9ca3af"
        lineWidth={2}
      />
      {label ? (
        <Html center position={mid} distanceFactor={8}>
          <span
            style={{
              fontSize: 11,
              color: '#4b5563',
              background: 'rgba(255,255,255,0.85)',
              padding: '0 4px',
              borderRadius: 3,
              whiteSpace: 'nowrap'
            }}
          >
            {label}
          </span>
        </Html>
      ) : null}
    </group>
  )
}

export function PrimitivesScene({ visualization }: PrimitivesSceneProps) {
  const { nodes, edges, label } = visualization
  const positionById = useMemo(
    () => new Map(nodes.map((n) => [n.id, n.position])),
    [nodes]
  )
  const cameraDistance = useMemo(
    () => cameraDistanceFromNodes(nodes),
    [nodes]
  )

  return (
    <div className="primitives-canvas" style={{ marginTop: 12 }}>
      <div style={{ fontSize: 13, color: '#374151', marginBottom: 4 }}>
        {label ?? '3D 图元演示（可拖动旋转）'}
        <span style={{ marginLeft: 8, color: '#9ca3af', fontSize: 12 }}>
          教师生成 · 已确认
        </span>
      </div>
      <Canvas
        style={{ width: 380, height: 320 }}
        camera={{
          position: [
            cameraDistance * 0.7,
            cameraDistance * 0.45,
            cameraDistance * 0.9
          ],
          fov: 45
        }}
        role="img"
        aria-label={`${label ?? '教师生成的'} 三维图元，可拖动旋转`}
      >
        <OrbitRig showAxes={false}>
          <Suspense fallback={null}>
            {edges.map((edge, i) => {
              const from = positionById.get(edge.from)
              const to = positionById.get(edge.to)
              if (!from || !to) return null
              return (
                <EdgeLine
                  key={`edge-${i}`}
                  from={from}
                  to={to}
                  label={edge.label}
                />
              )
            })}
            {nodes.map((node) => (
              <mesh key={node.id} position={node.position}>
                <sphereGeometry args={[0.18, 20, 20]} />
                <meshStandardMaterial
                  color={roleColor(node.role)}
                  roughness={0.4}
                  metalness={0.15}
                />
                {node.label ? (
                  <Html
                    center
                    distanceFactor={7}
                    position={[0, 0.32, 0]}
                  >
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: '#111827',
                        background: 'rgba(255,255,255,0.9)',
                        padding: '1px 5px',
                        borderRadius: 4,
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {node.label}
                    </span>
                  </Html>
                ) : null}
              </mesh>
            ))}
          </Suspense>
        </OrbitRig>
      </Canvas>
    </div>
  )
}
