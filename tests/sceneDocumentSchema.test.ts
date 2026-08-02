import { describe, expect, it } from 'vitest'
import {
  SCENE_FORMAT_VERSION,
  parseSceneDocument,
  safeParseSceneDocument
} from '../server/demonstration/sceneDocumentSchema'

const baseDoc = {
  documentMeta: { sceneFormatVersion: SCENE_FORMAT_VERSION }
}

describe('SceneDocument schema S1 — trust boundary gate', () => {
  it('accepts a minimal document with only documentMeta (defaults applied)', () => {
    const doc = parseSceneDocument(baseDoc)
    expect(doc.documentMeta.sceneFormatVersion).toBe(SCENE_FORMAT_VERSION)
    expect(doc.documentMeta.type).toBe('demonstration')
    expect(doc.documentMeta.unit).toBe('meters')
    expect(doc.runtimeVersion.sceneFormatVersion).toBe(SCENE_FORMAT_VERSION)
    expect(doc.runtimeVersion.capabilities).toEqual([])
    expect(doc.viewerConfig.camera.position).toEqual([3, 2, 5])
    expect(doc.viewerConfig.background).toBe('#1a1a2e')
  })

  it('rejects a document missing documentMeta', () => {
    expect(() => parseSceneDocument({})).toThrow()
  })

  it('rejects an invalid sceneFormatVersion (not semver-ish)', () => {
    expect(() =>
      parseSceneDocument({ documentMeta: { sceneFormatVersion: 'v1' } })
    ).toThrow()
  })

  it('rejects non-finite coordinate', () => {
    expect(() =>
      parseSceneDocument({
        ...baseDoc,
        viewerConfig: { camera: { position: [Infinity, 0, 0] } }
      })
    ).toThrow()
  })

  it('rejects fov out of range', () => {
    expect(() =>
      parseSceneDocument({
        ...baseDoc,
        viewerConfig: { camera: { fov: 5 } }
      })
    ).toThrow()
  })

  it('rejects unknown capability flag', () => {
    expect(() =>
      parseSceneDocument({
        ...baseDoc,
        runtimeVersion: { sceneFormatVersion: SCENE_FORMAT_VERSION, capabilities: ['telepathy'] }
      })
    ).toThrow()
  })

  it('rejects an invalid hex background', () => {
    expect(() =>
      parseSceneDocument({ ...baseDoc, viewerConfig: { background: '#abc' } })
    ).toThrow()
  })

  it('accepts a valid PBR 0..1 color tuple as background', () => {
    const doc = parseSceneDocument({
      ...baseDoc,
      viewerConfig: { background: [0.2, 0.3, 0.4] }
    })
    expect(doc.viewerConfig.background).toEqual([0.2, 0.3, 0.4])
  })

  it('safeParse returns structured failure (read-time tolerance)', () => {
    const r = safeParseSceneDocument({ documentMeta: { sceneFormatVersion: 'nope' } })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.issues.length).toBeGreaterThan(0)
      expect(r.error).toContain('failed validation')
    }
  })

  it('safeParse returns the document on success', () => {
    const r = safeParseSceneDocument(baseDoc)
    expect(r.success).toBe(true)
    if (r.success) expect(r.document.documentMeta.type).toBe('demonstration')
  })

  it('rejects an unknown top-level section (strict — no silent drift)', () => {
    expect(() =>
      parseSceneDocument({ ...baseDoc, hologramConfig: {} })
    ).toThrow(/unrecognized/i)
  })

  it('rejects a future sceneFormatVersion at parse time', () => {
    expect(() =>
      parseSceneDocument({ documentMeta: { sceneFormatVersion: '2.0' } })
    ).toThrow(/newer/)
  })

  it('rejects an older-than-floor version at parse time', () => {
    expect(() =>
      parseSceneDocument({ documentMeta: { sceneFormatVersion: '0.8' } })
    ).toThrow(/N-2/)
  })

  it('maxTriangles budget cap rejects absurd values', () => {
    expect(() =>
      parseSceneDocument({ ...baseDoc, viewerConfig: { maxTriangles: 99_999_999 } })
    ).toThrow()
  })
})

describe('SceneDocument schema S2 — objectTree / materials / geometry2D / geometry3D', () => {
  it('rejects objectTree with duplicate node ids', () => {
    expect(() =>
      parseSceneDocument({
        ...baseDoc,
        objectTree: [
          { id: 'a' },
          { id: 'a' }
        ]
      })
    ).toThrow(/duplicate node id/)
  })

  it('rejects objectTree node referencing unknown parent', () => {
    expect(() =>
      parseSceneDocument({
        ...baseDoc,
        objectTree: [{ id: 'a', parentId: 'ghost' }]
      })
    ).toThrow(/unknown parent/)
  })

  it('accepts a valid 3-node hierarchy with transforms', () => {
    const doc = parseSceneDocument({
      ...baseDoc,
      objectTree: [
        { id: 'root', transform: { position: [0, 1, 0] } },
        { id: 'child', parentId: 'root' },
        { id: 'grandchild', parentId: 'child', visible: false }
      ]
    })
    expect(doc.objectTree).toBeDefined()
    expect(doc.objectTree?.[0]?.id).toBe('root')
    expect(doc.objectTree?.[2]?.visible).toBe(false)
  })

  it('rejects non-finite position in transform', () => {
    expect(() =>
      parseSceneDocument({
        ...baseDoc,
        objectTree: [{ id: 'a', transform: { position: [NaN, 0, 0] } }]
      })
    ).toThrow()
  })

  it('accepts PBR material with defaults', () => {
    const doc = parseSceneDocument({
      ...baseDoc,
      materials: [{ kind: 'pbr' }]
    })
    expect(doc.materials?.[0]).toMatchObject({
      kind: 'pbr',
      metallicFactor: 0,
      roughnessFactor: 1,
      alphaMode: 'OPAQUE'
    })
  })

  it('rejects PBR metallicFactor > 1', () => {
    expect(() =>
      parseSceneDocument({
        ...baseDoc,
        materials: [{ kind: 'pbr', metallicFactor: 2 }]
      })
    ).toThrow()
  })

  it('accepts fill2d + stroke2d materials', () => {
    const doc = parseSceneDocument({
      ...baseDoc,
      materials: [
        { kind: 'fill2d', fill: '#ff0000' },
        { kind: 'stroke2d', stroke: [0, 0, 1], strokeWidth: 2 }
      ]
    })
    expect(doc.materials?.[0]?.kind).toBe('fill2d')
    const second = doc.materials?.[1]
    if (second?.kind === 'stroke2d') {
      expect(second.strokeWidth).toBe(2)
    } else {
      expect.fail('expected stroke2d material')
    }
  })

  it('rejects unknown material kind', () => {
    expect(() =>
      parseSceneDocument({ ...baseDoc, materials: [{ kind: 'phong' }] })
    ).toThrow()
  })

  it('accepts all SVG-subset 2D shapes', () => {
    const doc = parseSceneDocument({
      ...baseDoc,
      geometry2D: [
        { id: 'r', shape: 'rect', x: 0, y: 0, width: 10, height: 5 },
        { id: 'c', shape: 'circle', cx: 1, cy: 1, r: 2 },
        { id: 'e', shape: 'ellipse', cx: 0, cy: 0, rx: 3, ry: 2 },
        { id: 'l', shape: 'line', x1: 0, y1: 0, x2: 1, y2: 1 },
        { id: 'pl', shape: 'polyline', points: [[0, 0], [1, 1]] },
        { id: 'pg', shape: 'polygon', points: [[0, 0], [1, 0], [1, 1]] },
        { id: 'p', shape: 'path', d: 'M0 0L10 10Z' },
        { id: 't', shape: 'text', x: 0, y: 0, text: 'hello' }
      ]
    })
    expect(doc.geometry2D?.length).toBe(8)
  })

  it('rejects SVG path with disallowed commands (Q/A/S — no eval surface)', () => {
    expect(() =>
      parseSceneDocument({
        ...baseDoc,
        geometry2D: [{ id: 'p', shape: 'path', d: 'M0 0Q1 1 2 2' }]
      })
    ).toThrow()
  })

  it('rejects polygon with < 3 points', () => {
    expect(() =>
      parseSceneDocument({
        ...baseDoc,
        geometry2D: [{ id: 'pg', shape: 'polygon', points: [[0, 0], [1, 1]] }]
      })
    ).toThrow()
  })

  it('accepts all inline 3D primitives + a glTF reference', () => {
    const hash = 'a'.repeat(64)
    const doc = parseSceneDocument({
      ...baseDoc,
      geometry3D: [
        { id: 'b', kind: 'box', size: [2, 2, 2] },
        { id: 's', kind: 'sphere', radius: 1.5 },
        { id: 'c', kind: 'cylinder', radius: 1, height: 2 },
        { id: 'co', kind: 'cone', radius: 1, height: 2 },
        { id: 'pl', kind: 'plane', size: [4, 4, 0] },
        { id: 'to', kind: 'torus', radius: 2, tube: 0.4 },
        { id: 'ri', kind: 'ring', innerRadius: 0.5, outerRadius: 1 },
        { id: 'g', kind: 'gltf', assetHash: hash }
      ]
    })
    expect(doc.geometry3D?.length).toBe(8)
  })

  it('rejects glTF reference with malformed hash', () => {
    expect(() =>
      parseSceneDocument({
        ...baseDoc,
        geometry3D: [{ id: 'g', kind: 'gltf', assetHash: 'not-a-hash' }]
      })
    ).toThrow()
  })

  it('rejects sphere with negative radius', () => {
    expect(() =>
      parseSceneDocument({
        ...baseDoc,
        geometry3D: [{ id: 's', kind: 'sphere', radius: -1 }]
      })
    ).toThrow()
  })

  it('enforces per-section array size caps (objectTree > 500 rejects)', () => {
    const nodes = Array.from({ length: 501 }, (_, i) => ({ id: `n${i}` }))
    expect(() =>
      parseSceneDocument({ ...baseDoc, objectTree: nodes })
    ).toThrow()
  })

  it('rejects duplicate ids in NESTED children (recursive tree validation)', () => {
    expect(() =>
      parseSceneDocument({
        ...baseDoc,
        objectTree: [
          { id: 'a', children: [{ id: 'b' }, { id: 'b' }] }
        ]
      })
    ).toThrow(/duplicate node id/)
  })

  it('rejects a parentId cycle (a→b→a)', () => {
    expect(() =>
      parseSceneDocument({
        ...baseDoc,
        objectTree: [
          { id: 'a', parentId: 'b' },
          { id: 'b', parentId: 'a' }
        ]
      })
    ).toThrow(/cycle/)
  })

  it('rejects nested children referencing unknown parent', () => {
    expect(() =>
      parseSceneDocument({
        ...baseDoc,
        objectTree: [
          { id: 'a', children: [{ id: 'b', parentId: 'ghost' }] }
        ]
      })
    ).toThrow(/unknown parent/)
  })
})

describe('SceneDocument schema S3 — timeline / interactions / particles / mediaRefs / fonts', () => {
  it('accepts a timeline with one animation track', () => {
    const doc = parseSceneDocument({
      ...baseDoc,
      timeline: {
        tracks: [
          {
            nodeId: 'cube',
            keyframes: [
              { time: 0, property: 'transform.position.x', value: 0 },
              { time: 1, property: 'transform.position.x', value: 5 }
            ]
          }
        ],
        duration: 2
      }
    })
    expect(doc.timeline?.tracks.length).toBe(1)
    expect(doc.timeline?.duration).toBe(2)
  })

  it('rejects timeline keyframe with negative time', () => {
    expect(() =>
      parseSceneDocument({
        ...baseDoc,
        timeline: {
          tracks: [{ nodeId: 'a', keyframes: [{ time: -1, property: 'x', value: 0 }] }]
        }
      })
    ).toThrow()
  })

  it('accepts all four interaction types', () => {
    const doc = parseSceneDocument({
      ...baseDoc,
      interactions: [
        { type: 'orbit', nodeId: 'cam' },
        {
          type: 'view-switch',
          nodeId: 'cam',
          viewpoints: [{ label: 'Front', position: [0, 0, 5], target: [0, 0, 0] }]
        },
        {
          type: 'step-visibility',
          nodeId: 'root',
          steps: [{ show: ['a'], hide: ['b'] }, { show: ['b'], hide: ['a'] }]
        },
        { type: 'pick-highlight', nodeId: 'button', highlightColor: '#ff0000', label: 'Click me' }
      ]
    })
    expect(doc.interactions?.length).toBe(4)
  })

  it('rejects unknown interaction type', () => {
    expect(() =>
      parseSceneDocument({
        ...baseDoc,
        interactions: [{ type: 'drag', nodeId: 'a' }]
      })
    ).toThrow()
  })

  it('accepts a particle emitter with deterministic seed', () => {
    const doc = parseSceneDocument({
      ...baseDoc,
      particles: [
        { id: 'p1', kind: 'sphere', count: 500, seed: 42, lifespan: 3, speed: 2 }
      ]
    })
    expect(doc.particles?.[0]?.seed).toBe(42)
  })

  it('rejects particle count > 10,000', () => {
    expect(() =>
      parseSceneDocument({
        ...baseDoc,
        particles: [{ id: 'p', kind: 'point', count: 50000 }]
      })
    ).toThrow()
  })

  it('accepts a skeleton with bones and morph target', () => {
    const doc = parseSceneDocument({
      ...baseDoc,
      skeletons: [
        {
          id: 'sk',
          bones: [
            { id: 'root' },
            { id: 'child', parentId: 'root', transform: { position: [0, 1, 0] } }
          ],
          skinRef: 'mesh-g'}
      ]
    })
    expect(doc.skeletons?.[0]?.bones.length).toBe(2)
  })

  it('accepts mediaRefs with valid blob hash', () => {
    const hash = 'b'.repeat(64)
    const doc = parseSceneDocument({
      ...baseDoc,
      mediaRefs: [
        { id: 'tex', blobHash: hash, purpose: 'texture' },
        { id: 'sub', blobHash: hash, purpose: 'subtitle', label: 'English' }
      ]
    })
    expect(doc.mediaRefs?.length).toBe(2)
  })

  it('rejects mediaRef with invalid blob hash', () => {
    expect(() =>
      parseSceneDocument({
        ...baseDoc,
        mediaRefs: [{ id: 'bad', blobHash: 'xyz', purpose: 'texture' }]
      })
    ).toThrow()
  })

  it('accepts fontsAndFormulas with web-safe fonts', () => {
    const doc = parseSceneDocument({
      ...baseDoc,
      fontsAndFormulas: {
        fonts: ['Arial', 'Times New Roman'],
        formulas: [{ id: 'f1', tex: 'E=mc^2' }]
      }
    })
    expect(doc.fontsAndFormulas?.fonts).toContain('Arial')
  })

  it('rejects non-web-safe font', () => {
    expect(() =>
      parseSceneDocument({
        ...baseDoc,
        fontsAndFormulas: { fonts: ['Comic Sans'] }
      })
    ).toThrow()
  })

  it('accepts editorMetadata as free-form object', () => {
    const doc = parseSceneDocument({
      ...baseDoc,
      editorMetadata: { cameraState: { zoom: 1.5 }, selectedNodeIds: ['a', 'b'] }
    })
    expect(doc.editorMetadata?.cameraState).toBeDefined()
  })

  it('rejects a video chapter with negative startTime', () => {
    expect(() =>
      parseSceneDocument({
        ...baseDoc,
        timeline: { chapters: [{ title: 'intro', startTime: -1 }] }
      })
    ).toThrow()
  })

  it('rejects timeline with a track having no keyframes', () => {
    expect(() =>
      parseSceneDocument({
        ...baseDoc,
        timeline: { tracks: [{ nodeId: 'a', keyframes: [] }] }
      })
    ).toThrow()
  })
})
