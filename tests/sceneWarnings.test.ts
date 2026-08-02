import { describe, expect, it } from 'vitest'
import { softSceneWarnings } from '../server/demonstration/sceneWarnings'
import { parseSceneDocument } from '../server/demonstration/sceneDocumentSchema'

describe('softSceneWarnings (hard/soft split, §4.4)', () => {
  it('returns no warnings for a complete doc', () => {
    const doc = parseSceneDocument({
      documentMeta: { sceneFormatVersion: '1.0' },
      objectTree: [{ id: 'a', meshRef: 'g1' }],
      geometry3D: [{ id: 'g1', kind: 'box' }],
      timeline: { tracks: [], chapters: [], duration: 5 }
    })
    expect(softSceneWarnings(doc)).toEqual([])
  })

  it('warns about inert nodes (no meshRef, no children)', () => {
    const doc = parseSceneDocument({
      documentMeta: { sceneFormatVersion: '1.0' },
      objectTree: [{ id: 'a' }, { id: 'b', children: [{ id: 'c' }] }]
    })
    const warnings = softSceneWarnings(doc)
    expect(warnings.some((w) => w.includes('a: no meshRef'))).toBe(true)
    expect(warnings.some((w) => w.includes('c: no meshRef'))).toBe(true)
  })

  it('warns about empty geometry', () => {
    const doc = parseSceneDocument({ documentMeta: { sceneFormatVersion: '1.0' } })
    expect(softSceneWarnings(doc).some((w) => w.includes('no geometry2D'))).toBe(true)
  })

  it('warns about tracks without duration hint', () => {
    const doc = parseSceneDocument({
      documentMeta: { sceneFormatVersion: '1.0' },
      timeline: {
        tracks: [{ nodeId: 'a', keyframes: [{ time: 0, property: 'x', value: 0 }] }],
        chapters: []
      }
    })
    expect(softSceneWarnings(doc).some((w) => w.includes('no duration hint'))).toBe(true)
  })

  it('warns about high particle count', () => {
    const doc = parseSceneDocument({
      documentMeta: { sceneFormatVersion: '1.0' },
      particles: [{ id: 'p', kind: 'point', count: 6000 }]
    })
    expect(softSceneWarnings(doc).some((w) => w.includes('particle count'))).toBe(true)
  })

  it('warns about unreferenced mediaRef', () => {
    const doc = parseSceneDocument({
      documentMeta: { sceneFormatVersion: '1.0' },
      mediaRefs: [
        { id: 'm', blobHash: 'a'.repeat(64), purpose: 'texture' }
      ]
    })
    expect(softSceneWarnings(doc).some((w) => w.includes('not referenced'))).toBe(true)
  })
})