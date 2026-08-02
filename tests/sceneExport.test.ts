import { describe, expect, it } from 'vitest'
import { buildPublishSnapshot } from '../server/demonstration/sceneExport'
import { parseSceneDocument } from '../server/demonstration/sceneDocumentSchema'

const doc = parseSceneDocument({
  documentMeta: { sceneFormatVersion: '1.0', generator: 'teacher' },
  geometry3D: [
    { id: 'g1', kind: 'gltf', assetHash: 'a'.repeat(64) },
    { id: 'box1', kind: 'box', size: [1, 1, 1] }
  ],
  mediaRefs: [
    { id: 'm1', blobHash: 'b'.repeat(64), purpose: 'texture' },
    { id: 'm2', blobHash: 'c'.repeat(64), purpose: 'video' }
  ],
  timeline: { tracks: [], chapters: [], duration: 5 }
})

describe('sceneExport — publish snapshot', () => {
  it('builds a snapshot with the document deep-cloned (immutable freeze)', () => {
    const snap = buildPublishSnapshot(doc, { mime: 'image/svg+xml', alt: 'ball-stick demo' })
    expect(snap.kind).toBe('demonstration-snapshot')
    expect(snap.sceneFormatVersion).toBe('1.0')
    expect(snap.document).not.toBe(doc)
    expect(snap.document.documentMeta.generator).toBe('teacher')
  })

  it('collects mediaRefs + geometry3D gltf assets into the asset manifest', () => {
    const snap = buildPublishSnapshot(doc, { mime: 'image/svg+xml', alt: 'x' })
    expect(snap.assets.map((a) => a.purpose)).toEqual(
      expect.arrayContaining(['texture', 'video', 'glb'])
    )
    expect(snap.assets.length).toBe(3)
  })

  it('extracts glTF sources with their geometry ids (asset round-trip)', () => {
    const snap = buildPublishSnapshot(doc, { mime: 'image/svg+xml', alt: 'x' })
    expect(snap.gltfSources).toEqual([{ blobHash: 'a'.repeat(64), geometryId: 'g1' }])
  })

  it('carries cover alt text and honest round-trip note', () => {
    const snap = buildPublishSnapshot(doc, { mime: 'image/png', alt: 'static cover' })
    expect(snap.cover.alt).toBe('static cover')
    expect(snap.roundTripNote).toBe('asset-level only')
  })

  it('snapshot mutation does not affect the input document (immutability)', () => {
    const snap = buildPublishSnapshot(doc, { mime: 'image/svg+xml', alt: 'x' })
    snap.document.documentMeta.generator = 'hacked'
    expect(doc.documentMeta.generator).toBe('teacher')
  })

  it('dedupes assets referenced by both mediaRefs and geometry3D gltf', () => {
    const sameHash = 'd'.repeat(64)
    const dedupDoc = parseSceneDocument({
      documentMeta: { sceneFormatVersion: '1.0' },
      geometry3D: [{ id: 'g1', kind: 'gltf', assetHash: sameHash }],
      mediaRefs: [{ id: 'm1', blobHash: sameHash, purpose: 'glb' }]
    })
    const snap = buildPublishSnapshot(dedupDoc, { mime: 'image/svg+xml', alt: 'x' })
    expect(snap.assets.filter((a) => a.blobHash === sameHash).length).toBe(1)
  })
})