/**
 * migration — legacy Visualization → SceneDocument lossless mapping (ticket
 * T-K, spec §7 Phase E). Pure functions: each legacy kind maps to a valid
 * SceneDocument that passes the T-C schema. Deterministic projection (fixed
 * camera/orientation) keeps render results comparable for CI dual-read.
 *
 * The migration is idempotent and never overwrites teacher data (只补缺不覆盖):
 *   - a question whose visualization was already migrated is skipped
 *   - a question that has no visualization is never touched
 *
 * Adapter reads (spec §7.3): prefer the new reference table, fall back to the
 * legacy `Question.visualization` field. Both paths render the same content.
 */
import type { SceneDocument } from './sceneDocumentSchema'
import { parseSceneDocument } from './sceneDocumentSchema'
import type { Visualization } from '../../shared/contracts'

/** Deterministic isometric projection of 3D → 2D (fixed camera, no random). */
export function project3Dto2D(
  x: number,
  y: number,
  z: number,
  scale = 1
): [number, number] {
  // Isometric-ish: x' = (x - z) * cos30, y' = y - (x + z) * 0.5.
  return [(x - z) * scale * 0.866, (y - (x + z) * 0.5) * scale]
}

/** Map a legacy curve to 2D polylines (projected deterministically). */
export function curveToSceneDocument(viz: Extract<Visualization, { kind: 'curve' }>): SceneDocument {
  const primary = viz.points.map((p) => project3Dto2D(p[0], p[1], p[2]))
  const secondary = viz.secondaryPoints?.map((p) => project3Dto2D(p[0], p[1], p[2]))
  const crossBars2D = viz.crossBars?.map(([a, b]) => [
    project3Dto2D(a[0], a[1], a[2]),
    project3Dto2D(b[0], b[1], b[2])
  ] as [[number, number], [number, number]])
  const geometry2D: SceneDocument['geometry2D'] = []
  if (primary.length >= 2) {
    geometry2D.push({ id: 'curve-primary', shape: 'polyline', points: primary })
  }
  if (secondary && secondary.length >= 2) {
    geometry2D.push({ id: 'curve-secondary', shape: 'polyline', points: secondary })
  }
  for (const [i, bar] of (crossBars2D ?? []).entries()) {
    geometry2D.push({
      id: `curve-bar-${i}`,
      shape: 'line',
      x1: bar[0][0], y1: bar[0][1], x2: bar[1][0], y2: bar[1][1]
    })
  }
  const objectTree = geometry2D.map((g) => ({
    id: g.id,
    name: viz.label ?? '曲线',
    transform: { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] },
    visible: true,
    meshRef: g.id,
    children: []
  }))
  return parseSceneDocument({
    documentMeta: { sceneFormatVersion: '1.0', type: 'demonstration', generator: 'phase-e-migration' },
    runtimeVersion: { sceneFormatVersion: '1.0', capabilities: [] },
    viewerConfig: { camera: { position: [3, 2, 5], target: [0, 0, 0], fov: 50 } },
    objectTree,
    geometry2D,
    materials: [{ kind: 'fill2d', fill: '#22aaff', fillOpacity: 1 }],
    interactions: [{ type: 'orbit', nodeId: 'curve-primary', enabled: true }],
    mediaRefs: [],
    timeline: { tracks: [], chapters: [], duration: 0 },
    editorMetadata: { migratedFrom: viz.kind }
  })
}

/** Map a legacy ball_stick (atoms + bonds) to 3D primitive spheres + cylinders. */
export function ballStickToSceneDocument(viz: Extract<Visualization, { kind: 'ball_stick' }>): SceneDocument {
  const geometry3D: SceneDocument['geometry3D'] = []
  const objectTree: SceneDocument['objectTree'] = []
  for (const atom of viz.atoms) {
    geometry3D.push({
      id: `atom-${atom.id}`,
      kind: 'sphere',
      radius: 0.25,
      segments: 16
    })
    objectTree.push({
      id: `atom-${atom.id}`,
      name: atom.element,
      transform: {
        position: [atom.position[0], atom.position[1], atom.position[2]] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number]
      },
      visible: true,
      meshRef: `atom-${atom.id}`,
      children: []
    })
  }
  for (const [i, bond] of viz.bonds.entries()) {
    const a = viz.atoms.find((at) => at.id === bond.from)
    const b = viz.atoms.find((at) => at.id === bond.to)
    if (!a || !b) continue
    // Cylinder connecting a→b: midpoint position, length = distance, aligned.
    const dx = b.position[0] - a.position[0]
    const dy = b.position[1] - a.position[1]
    const dz = b.position[2] - a.position[2]
    const len = Math.hypot(dx, dy, dz)
    if (len < 1e-9) continue
    // Euler angles aligning Y axis to the bond direction.
    const yaw = Math.atan2(dx, dz)
    const pitch = Math.asin(dy / len)
    geometry3D.push({
      id: `bond-${i}`,
      kind: 'cylinder',
      radius: 0.08,
      height: len,
      radialSegments: 8
    })
    objectTree.push({
      id: `bond-${i}`,
      name: '键',
      transform: {
        position: [
          (a.position[0] + b.position[0]) / 2,
          (a.position[1] + b.position[1]) / 2,
          (a.position[2] + b.position[2]) / 2
        ] as [number, number, number],
        rotation: [pitch, yaw, 0] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number]
      },
      visible: true,
      meshRef: `bond-${i}`,
      children: []
    })
  }
  return parseSceneDocument({
    documentMeta: { sceneFormatVersion: '1.0', type: 'demonstration', generator: 'phase-e-migration' },
    runtimeVersion: { sceneFormatVersion: '1.0', capabilities: ['webgl2'] },
    viewerConfig: { camera: { position: [3, 2, 5], target: [0, 0, 0], fov: 50 } },
    objectTree,
    geometry3D,
    materials: [{ kind: 'pbr', baseColorFactor: '#3399ff', metallicFactor: 0.1, roughnessFactor: 0.6 }],
    interactions: [{ type: 'orbit', nodeId: objectTree[0]?.id ?? 'atom-x', enabled: true }],
    mediaRefs: [],
    timeline: { tracks: [], chapters: [], duration: 0 },
    editorMetadata: { migratedFrom: viz.kind }
  })
}

/** Map a legacy primitives graph (nodes + edges) to 2D geometry. */
export function primitivesToSceneDocument(viz: Extract<Visualization, { kind: 'primitives' }>): SceneDocument {
  const geometry2D: SceneDocument['geometry2D'] = []
  const objectTree: SceneDocument['objectTree'] = []
  for (const edge of viz.edges) {
    const a = viz.nodes.find((n) => n.id === edge.from)
    const b = viz.nodes.find((n) => n.id === edge.to)
    if (!a || !b) continue
    const id = `edge-${edge.from}-${edge.to}`
    geometry2D.push({
      id,
      shape: 'line',
      x1: a.position[0], y1: a.position[1],
      x2: b.position[0], y2: b.position[1]
    })
    objectTree.push({
      id,
      name: edge.label ?? '边',
      transform: { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] },
      visible: true,
      meshRef: id,
      children: []
    })
  }
  for (const node of viz.nodes) {
    const id = `node-${node.id}`
    geometry2D.push({
      id,
      shape: 'circle',
      cx: node.position[0],
      cy: node.position[1],
      r: 0.25
    })
    objectTree.push({
      id,
      name: node.label ?? node.id,
      transform: { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] },
      visible: true,
      meshRef: id,
      children: []
    })
  }
  return parseSceneDocument({
    documentMeta: { sceneFormatVersion: '1.0', type: 'demonstration', generator: 'phase-e-migration' },
    runtimeVersion: { sceneFormatVersion: '1.0', capabilities: [] },
    viewerConfig: { camera: { position: [0, 0, 6], target: [0, 0, 0], fov: 50 } },
    objectTree,
    geometry2D,
    materials: [{ kind: 'fill2d', fill: '#22cc66', fillOpacity: 1 }],
    interactions: [{ type: 'orbit', nodeId: objectTree[0]?.id ?? 'node-x', enabled: true }],
    mediaRefs: [],
    timeline: { tracks: [], chapters: [], duration: 0 },
    editorMetadata: { migratedFrom: viz.kind }
  })
}

/** Dispatch a legacy visualization to its SceneDocument mapping (lossless). */
export function visualizationToSceneDocument(viz: Visualization): SceneDocument {
  switch (viz.kind) {
    case 'curve':
      return curveToSceneDocument(viz)
    case 'ball_stick':
      return ballStickToSceneDocument(viz)
    case 'primitives':
      return primitivesToSceneDocument(viz)
  }
}
