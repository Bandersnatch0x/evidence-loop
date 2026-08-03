/**
 * TeacherStudio templates — preset scenes for the wizard's first step
 * (spec §8 预置模板). Separate file so fast refresh only tracks components.
 */
import type { SceneDocument } from '../../../server/demonstration/sceneDocumentSchema'
import { parseSceneDocument } from '../../../server/demonstration/sceneDocumentSchema'

/** Seed a minimal empty scene document (author starts here). */
export function seedScene(): SceneDocument {
  return parseSceneDocument({
    documentMeta: { sceneFormatVersion: '1.0', type: 'demonstration' },
    runtimeVersion: { sceneFormatVersion: '1.0', capabilities: [] },
    viewerConfig: { camera: { position: [3, 2, 5], target: [0, 0, 0], fov: 50 } },
    objectTree: [],
    geometry2D: [],
    geometry3D: [],
    materials: [],
    interactions: [],
    mediaRefs: [],
    timeline: { tracks: [], chapters: [], duration: 10 },
    editorMetadata: {}
  })
}

/** Template library — presets for the wizard's first step (spec §8 预置模板). */
export const TEMPLATES: Array<{ id: string; label: string; make: () => SceneDocument }> = [
  {
    id: 'empty-2d',
    label: '空白 2D 场景',
    make: () => seedScene()
  },
  {
    id: 'empty-3d',
    label: '空白 3D 场景',
    make: () =>
      parseSceneDocument({
        documentMeta: { sceneFormatVersion: '1.0', type: 'demonstration' },
        runtimeVersion: { sceneFormatVersion: '1.0', capabilities: ['webgl2'] },
        viewerConfig: { camera: { position: [3, 2, 5], target: [0, 0, 0], fov: 50 } },
        objectTree: [
          {
            id: 'base',
            name: '地面',
            transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
            visible: true,
            meshRef: 'ground',
            children: []
          }
        ],
        geometry3D: [{ id: 'ground', kind: 'box', size: [2, 0.1, 2] }],
        materials: [{ kind: 'pbr', baseColorFactor: '#999999', metallicFactor: 0, roughnessFactor: 1 }],
        interactions: [{ type: 'orbit', nodeId: 'base', enabled: true }],
        mediaRefs: [],
        timeline: { tracks: [], chapters: [], duration: 10 },
        editorMetadata: {}
      })
  },
  {
    id: 'demo-dna',
    label: 'DNA 双螺旋模板',
    make: () =>
      parseSceneDocument({
        documentMeta: { sceneFormatVersion: '1.0', type: 'demonstration' },
        runtimeVersion: { sceneFormatVersion: '1.0', capabilities: [] },
        viewerConfig: { camera: { position: [3, 2, 5], target: [0, 0, 0], fov: 50 } },
        objectTree: [
          {
            id: 'strand',
            name: 'DNA 链',
            transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
            visible: true,
            meshRef: 'helix',
            children: []
          }
        ],
        geometry3D: [{ id: 'helix', kind: 'cylinder', radius: 0.3, height: 3, radialSegments: 12 }],
        materials: [{ kind: 'pbr', baseColorFactor: '#2266cc', metallicFactor: 0.1, roughnessFactor: 0.6 }],
        interactions: [
          { type: 'orbit', nodeId: 'strand', enabled: true },
          {
            type: 'step-visibility',
            nodeId: 'strand',
            steps: [
              { label: '碱基对', show: ['strand'] },
              { label: '双链', show: ['strand'] }
            ]
          }
        ],
        mediaRefs: [],
        timeline: { tracks: [], chapters: [], duration: 10 },
        editorMetadata: {}
      })
  }
]

