/**
 * player/playerState — mutable scene runtime state (spec §6.2/§6.3).
 *
 * The document is immutable; the player keeps a small runtime overlay that
 * interactions and the deterministic animation clock write into, and the
 * renderers read. Kept pure-data so rendering stays deterministic.
 */
import type { Transform } from '../../../server/demonstration/sceneDocumentSchema'

export interface SceneRuntimeState {
  /** Node transforms sampled from animation tracks (nodeId → transform). */
  nodeTransforms: Map<string, Transform>
  /** Visible node ids after step-visibility; null = all visible. */
  visibleNodeIds: Set<string> | null
  /** Node highlighted by pick-highlight interaction. */
  highlightNodeId: string | null
  /** Current view-switch viewpoint index. */
  viewIndex: number
  /** Orbit rotation angle (radians) applied by the orbit interaction. */
  orbitAngle: number
}

export function initialRuntimeState(): SceneRuntimeState {
  return {
    nodeTransforms: new Map(),
    visibleNodeIds: null,
    highlightNodeId: null,
    viewIndex: 0,
    orbitAngle: 0
  }
}
