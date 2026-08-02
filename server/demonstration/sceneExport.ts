/**
 * sceneExport — publish snapshot construction (spec §4.7).
 *
 * A published snapshot bundles:
 *   - the immutable SceneDocument (never mutated)
 *   - references to the packaged glTF source (when geometry3D gltf assets exist)
 *   - static cover metadata (SVG/PNG) for alt text / thumbnails / no-access
 *     static degradation (spec §6.10).
 *
 * Only asset-level round-trip is promised: product orchestration semantics
 * (timeline, interactions, viewer config) are authored in the document, not
 * reconstructable from the glTF export.
 */
import type { SceneDocument } from './sceneDocumentSchema'

export interface PublishSnapshot {
  kind: 'demonstration-snapshot'
  sceneFormatVersion: string
  document: SceneDocument
  /** Asset manifests for all blob hashes referenced (mediaRefs + geometry3D gltf). */
  assets: Array<{
    blobHash: string
    purpose: 'image' | 'glb' | 'video' | 'subtitle' | 'texture' | 'audio' | 'thumbnail'
  }>
  /** glTF source references extracted from geometry3D (for round-trip). */
  gltfSources: Array<{ blobHash: string; geometryId: string }>
  cover: {
    /** Static cover markup — SVG fragment or PNG bytes (base64) hint. */
    mime: 'image/svg+xml' | 'image/png'
    /** Alt text for accessibility (WCAG AA, spec §6.10). */
    alt: string
    placeholder?: string
  }
  /** Honest record: product semantics not round-trip promised through glTF. */
  roundTripNote: 'asset-level only'
}

/**
 * Build the publish snapshot for a validated document. Pure — clones the doc
 * so the caller's working copy is untouched.
 */
export function buildPublishSnapshot(
  doc: SceneDocument,
  cover: PublishSnapshot['cover']
): PublishSnapshot {
  const document = structuredClone(doc)

  const assets: PublishSnapshot['assets'] = []
  const gltfSources: PublishSnapshot['gltfSources'] = []
  const seenAssets = new Set<string>()

  for (const ref of doc.mediaRefs ?? []) {
    const key = `${ref.blobHash}:${ref.purpose}`
    if (seenAssets.has(key)) continue
    seenAssets.add(key)
    assets.push({ blobHash: ref.blobHash, purpose: ref.purpose })
  }
  for (const g of doc.geometry3D ?? []) {
    if (g.kind === 'gltf') {
      const key = `${g.assetHash}:glb`
      if (!seenAssets.has(key)) {
        seenAssets.add(key)
        assets.push({ blobHash: g.assetHash, purpose: 'glb' })
      }
      gltfSources.push({ blobHash: g.assetHash, geometryId: g.id })
    }
  }

  return {
    kind: 'demonstration-snapshot',
    sceneFormatVersion: document.documentMeta.sceneFormatVersion,
    document,
    assets,
    gltfSources,
    cover,
    roundTripNote: 'asset-level only'
  }
}