/**
 * sceneWarnings — soft advisories for SceneDocument (spec §4.4 hard/soft split,
 * mirroring questionbank/geometrySanity.ts). Hard fails reject via the zod
 * schema; soft warnings are returned alongside saves for the author to review
 * but never block. Pure functions.
 */
import type { SceneDocument } from './sceneDocumentSchema'

export function softSceneWarnings(doc: SceneDocument): string[] {
  const warnings: string[] = []

  // Unlinked nodes: a node with no meshRef and no children is inert.
  const walk = (nodes: readonly unknown[], path: string): void => {
    for (const n of nodes) {
      const node = n as { id?: unknown; meshRef?: unknown; children?: readonly unknown[] } | null
      const id = typeof node?.id === 'string' ? node.id : ''
      const children = node?.children ?? []
      if (node && typeof node === 'object' && !node.meshRef && children.length === 0) {
        warnings.push(`${path}${id}: no meshRef and no children (inert node)`)
      }
      walk(children, `${path}${id}/`)
    }
  }
  walk(doc.objectTree ?? [], '')

  // No geometry at all: a doc that references nothing is likely incomplete.
  if ((doc.geometry2D ?? []).length === 0 && (doc.geometry3D ?? []).length === 0) {
    warnings.push('document has no geometry2D or geometry3D content')
  }

  // Timeline with tracks but no duration hint.
  const tracks = doc.timeline?.tracks ?? []
  if (tracks.length > 0 && doc.timeline?.duration === undefined) {
    warnings.push('timeline has tracks but no duration hint')
  }

  // Particles with high count — suggests device-tier risk.
  const particleCount = (doc.particles ?? []).reduce((sum, p) => sum + p.count, 0)
  if (particleCount > 5000) {
    warnings.push(`particle count ${particleCount} is high (>5000); consider degradable flags`)
  }

  // mediaRefs whose blobHash is not referenced by any geometry/material.
  const usedHashes = new Set<string>()
  for (const m of doc.materials ?? []) {
    if (m.kind === 'pbr' && m.baseColorTexture) usedHashes.add(m.baseColorTexture)
  }
  for (const g of doc.geometry3D ?? []) {
    if (g.kind === 'gltf') usedHashes.add(g.assetHash)
  }
  for (const ref of doc.mediaRefs ?? []) {
    if (!usedHashes.has(ref.blobHash) && ref.purpose !== 'subtitle') {
      warnings.push(`mediaRef ${ref.id} hash not referenced by any geometry/material`)
    }
  }

  return warnings
}