import type {
  Geometry3DPrimitive,
  ObjectNode,
  SceneDocument
} from '../../../server/demonstration/sceneDocumentSchema'

export interface Renderable3DNode {
  id: string
  name: string
  parentId?: string
  transform: ObjectNode['transform']
  visible: boolean
  geometry: Geometry3DPrimitive
  assetUrl?: string
}

/** Pure SceneDocument -> viewport projection. Never accepts external asset URLs. */
export function getRenderable3DNodes(document: SceneDocument): Renderable3DNode[] {
  const geometries = new Map((document.geometry3D ?? []).map((geometry) => [geometry.id, geometry]))
  const renderable: Renderable3DNode[] = []

  const visit = (nodes: readonly ObjectNode[], inheritedParentId?: string): void => {
    for (const node of nodes) {
      const geometry = node.meshRef ? geometries.get(node.meshRef) : undefined
      if (geometry) {
        renderable.push({
          id: node.id,
          name: node.name ?? node.id,
          parentId: node.parentId ?? inheritedParentId,
          transform: node.transform,
          visible: node.visible,
          geometry,
          ...(geometry.kind === 'gltf' ? { assetUrl: `/api/media/blobs/${geometry.assetHash}` } : {})
        })
      }
      visit(node.children, node.id)
    }
  }

  visit(document.objectTree ?? [])
  return renderable
}
