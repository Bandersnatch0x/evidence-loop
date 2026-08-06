/**
 * T-K Phase E migration tests — lossless Visualization → SceneDocument mapping
 * (pure functions). The legacy question-facing migration runner was removed in
 * #31: the visualization_json column is gone, so there is no legacy source to
 * migrate. These pure conversions remain as documented historical mappings and
 * are validated against the T-C schema.
 */
import { describe, it, expect } from 'vitest'
import { visualizationToSceneDocument, curveToSceneDocument, ballStickToSceneDocument, primitivesToSceneDocument } from '../server/demonstration/migration'
import { parseSceneDocument } from '../server/demonstration/sceneDocumentSchema'
import type { Visualization } from '../shared/contracts'

const HELIX: Visualization = {
  kind: 'curve',
  points: [
    [0, 0, 0], [0.5, 0.2, 0.3], [1, 0.5, 0.6], [1.5, 0.8, 0.9]
  ],
  label: '磁场螺旋'
}

const METHANE: Visualization = {
  kind: 'ball_stick',
  atoms: [
    { id: 'C', element: 'C', position: [0, 0, 0] },
    { id: 'H1', element: 'H', position: [1, 0, 0] }
  ],
  bonds: [{ from: 'C', to: 'H1' }],
  label: '甲烷'
}

const CIRCUIT: Visualization = {
  kind: 'primitives',
  nodes: [
    { id: 'V', label: '电源', position: [-2, 0, 0], role: 'source' },
    { id: 'R', label: 'R', position: [2, 0, 0], role: 'resistor' }
  ],
  edges: [{ from: 'V', to: 'R', label: '导线' }],
  label: '串联电路'
}

describe('T-K lossless mapping (3 kinds → valid SceneDocument)', () => {
  it('curve maps to projected 2D polylines that pass the T-C schema', () => {
    const doc = curveToSceneDocument(HELIX)
    expect(doc.geometry2D?.length).toBe(1)
    expect(doc.geometry2D?.[0]?.shape).toBe('polyline')
    expect(doc.documentMeta.sceneFormatVersion).toBe('1.0')
    // Re-parse proves schema validity.
    expect(() => parseSceneDocument(doc)).not.toThrow()
  })

  it('ball_stick maps atoms to spheres + bonds to cylinders', () => {
    const doc = ballStickToSceneDocument(METHANE)
    expect(doc.geometry3D?.length).toBe(3) // 2 atoms + 1 bond
    expect(doc.geometry3D?.some((g) => g.kind === 'sphere')).toBe(true)
    expect(doc.geometry3D?.some((g) => g.kind === 'cylinder')).toBe(true)
    expect(() => parseSceneDocument(doc)).not.toThrow()
  })

  it('primitives maps nodes to circles + edges to lines', () => {
    const doc = primitivesToSceneDocument(CIRCUIT)
    expect(doc.geometry2D?.some((g) => g.shape === 'circle')).toBe(true)
    expect(doc.geometry2D?.some((g) => g.shape === 'line')).toBe(true)
    expect(() => parseSceneDocument(doc)).not.toThrow()
  })

  it('dispatcher routes all three kinds', () => {
    expect(visualizationToSceneDocument(HELIX).geometry2D?.length).toBeGreaterThan(0)
    expect(visualizationToSceneDocument(METHANE).geometry3D?.length).toBeGreaterThan(0)
    expect(visualizationToSceneDocument(CIRCUIT).geometry2D?.length).toBeGreaterThan(0)
  })
})

describe('T-K CI dual-read consistency', () => {
  it('legacy visualization and migrated SceneDocument carry the same identity', () => {
    const doc = visualizationToSceneDocument(HELIX)
    expect(doc.editorMetadata?.migratedFrom).toBe('curve')
    expect(doc.runtimeVersion.sceneFormatVersion).toBe('1.0')
    // Deterministic: same input → same output (CI re-run stability).
    const again = visualizationToSceneDocument(HELIX)
    expect(JSON.stringify(again)).toBe(JSON.stringify(doc))
  })

  it('the conversion function is the single source for preset SceneDocuments', () => {
    // Phase C (#30): the legacy column is deleted, so the conversion function
    // is no longer driven by stored question data — it is the pure mapping
    // used by the (now historical) migration and by scene import/export.
    const doc = visualizationToSceneDocument(HELIX)
    expect(() => parseSceneDocument(doc)).not.toThrow()
    expect(doc.editorMetadata?.migratedFrom).toBe('curve')
  })
})
