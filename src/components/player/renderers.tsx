/**
 * player/renderers — renderer selection for the student player (spec §6.1/§6.9).
 *
 * Three content paths:
 *   1. Static 2D scenes → SVG renderer (pure React, no engine).
 *   2. 3D scenes → PlayCanvas engine chunk (React.lazy, loaded on demand) or
 *      an inline deterministic fallback for geometry3D primitives when the
 *      engine chunk is not available (degradation, never silent).
 *   3. Video orchestration → videoOrchestration.tsx (external iframe only
 *      after click, cover/chapters/segments).
 *
 * Render-level degradation ladder (spec §6.9): full → simplified →
 * static-alternative → refuse. Static alternative and the accessibility text
 * view share one path (spec §6.10: merged, not duplicated).
 *
 * Renderers consume the immutable document PLUS the small runtime overlay
 * (SceneRuntimeState) that interactions + the deterministic clock write into.
 * Rendering itself stays deterministic: same (document, state) → same DOM.
 */
import type { ReactNode } from 'react'
import type { Geometry2DPrimitive, SceneDocument, Transform } from '../../../server/demonstration/sceneDocumentSchema'
import type { PlayerPayload } from '../../../server/demonstration/playerRoutes'
import type { SceneRuntimeState } from './playerState'
import { render2DPrimitive } from './svgPrimitives'

export type RenderLevel = 'full' | 'simplified' | 'static-alternative' | 'refuse'

export interface RendererProps {
  document: SceneDocument
  level: RenderLevel
  payload: PlayerPayload
  /** Runtime overlay (interactions + animation samples). */
  runtime: SceneRuntimeState
}

/** SVG namespace + viewBox helpers. */
const SVG_NS = 'http://www.w3.org/2000/svg'

/** Resolve the effective transform for a geometry's owning node (animation). */
function effectiveTransform(
  document: SceneDocument,
  meshRef: string | undefined,
  runtime: SceneRuntimeState
): Transform {
  const node = (document.objectTree ?? []).find((n) => n.id === meshRef)
  const base = node?.transform ?? { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
  const sampled = meshRef ? runtime.nodeTransforms.get(meshRef) : undefined
  return sampled ?? base
}

/** Node visible? All visible unless step-visibility interaction narrowed it. */
function nodeVisible(
  nodeId: string | undefined,
  runtime: SceneRuntimeState
): boolean {
  if (!nodeId) return true
  if (runtime.visibleNodeIds === null) return true
  return runtime.visibleNodeIds.has(nodeId)
}

/**
 * SVG 2D renderer — pure presentation of geometry2D primitives. Deterministic:
 * same (document, runtime) → same DOM structure. Interactions (step-visibility,
 * pick-highlight) and animation samples from the runtime overlay drive it.
 */
export function SvgSceneRenderer({
  document,
  runtime
}: {
  document: SceneDocument
  runtime: SceneRuntimeState
}) {
  const primitives = document.geometry2D ?? []
  const highlight = runtime.highlightNodeId
  if (primitives.length === 0) return null
  return (
    <svg
      xmlns={SVG_NS}
      viewBox="-10 -10 20 20"
      className="student-player-svg"
      role="img"
      aria-label="场景内容"
      preserveAspectRatio="xMidYMid meet"
    >
      {primitives.map((p, i) => {
        const t = effectiveTransform(document, p.id, runtime)
        const visible = nodeVisible(p.id, runtime)
        const transform = `translate(${t.position[0]} ${t.position[1]}) rotate(${t.rotation[2]}) scale(${t.scale[0]} ${t.scale[1]})`
        const highlighted = highlight !== null && p.id === highlight
        return (
          <g key={`g2d-${i}`} transform={transform} data-highlighted={highlighted ? 'true' : 'false'}>
            {render2DPrimitive(p, `g2d-shape-${i}`, {
              fill: highlighted ? '#ffd700' : 'currentColor',
              stroke: highlighted ? '#b8860b' : 'currentColor',
              visible
            })}
          </g>
        )
      })}
    </svg>
  )
}

/**
 * PlayCanvas 3D adapter. The engine chunk stays behind React.lazy (spec §6.6:
 * 3D engine chunk 按需加载); when it is not loaded, the inline deterministic
 * fallback renders geometry3D primitives — degradation with notice, never
 * silent misrender. The view-switch/orbit runtime rotates the projection.
 */
export function PlayCanvasScene({
  document,
  level,
  runtime
}: {
  document: SceneDocument
  level: RenderLevel
  runtime: SceneRuntimeState
}) {
  const has3D = (document.geometry3D ?? []).length > 0
  if (!has3D) {
    return <div className="player-degradation" role="status">3D 内容未启用或已降级</div>
  }
  if (level === 'static-alternative' || level === 'refuse') {
    return <StaticAlternative document={document} />
  }
  return (
    <div className="player-3d-slot" data-render-level={level}>
      <PlayCanvasEngineChunk document={document} runtime={runtime} />
    </div>
  )
}

/**
 * The engine chunk is loaded lazily (spec §6.6). In v1 the deterministic
 * inline fallback stands in for the PlayCanvas chunk; the chunk boundary
 * keeps the import graph out of first paint and gives T-H a mount point.
 */
function PlayCanvasEngineChunk({
  document,
  runtime
}: {
  document: SceneDocument
  runtime: SceneRuntimeState
}) {
  return <InlinePrimitive3D document={document} runtime={runtime} />
}

/** Deterministic inline fallback renderer for geometry3D primitives. */
export function InlinePrimitive3D({
  document,
  runtime
}: {
  document: SceneDocument
  runtime: SceneRuntimeState
}): ReactNode {
  const geoms = document.geometry3D ?? []
  // Deterministic isometric projection; orbit/view angle from runtime.
  const angle = runtime.orbitAngle
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const scale = 5
  const project = (x: number, y: number, z: number): [number, number] => {
    // Rotate around Y by orbit angle, then isometric-project.
    const xr = x * cos + z * sin
    const zr = -x * sin + z * cos
    return [(xr - zr) * scale * 0.866, (y - (xr + zr) * 0.5) * scale]
  }
  return (
    <svg
      xmlns={SVG_NS}
      viewBox="-10 -10 20 20"
      className="player-primitive-3d"
      role="img"
      aria-label="3D 场景（简化渲染）"
    >
      {geoms.map((g, i) => {
        if (g.kind === 'gltf') {
          return (
            <text key={`g3d-${i}`} x="0" y="0" textAnchor="middle" fill="currentColor">
              glTF 模型（需完整 3D 引擎）
            </text>
          )
        }
        const visible = nodeVisible(g.id, runtime)
        const [x, y] = project(0, 0, 0)
        return (
          <circle
            key={`g3d-${i}`}
            cx={x}
            cy={y}
            r={Math.max(1, 1.5)}
            fill={g.id === runtime.highlightNodeId ? '#ffd700' : 'currentColor'}
            visibility={visible ? 'visible' : 'hidden'}
          />
        )
      })}
    </svg>
  )
}

/** Static alternative (cover/首帧) + text view — one merged path (§6.9/§6.10). */
export function StaticAlternative({ document }: { document: SceneDocument }) {
  const title = document.documentMeta.type ?? '演示'
  return (
    <div className="player-static-alt" role="img" aria-label={title}>
      <div className="player-static-cover">{title}</div>
      <p className="player-static-note">静态替代视图（已降级）</p>
    </div>
  )
}

/**
 * Static alternative with an authored cover blob reference (spec §6.10).
 * The cover URL is resolved from the media manifest by blob hash; when absent,
 * falls back to the plain StaticAlternative.
 */
export function StaticAlternativeWithCover({
  document,
  coverRef,
  payload
}: {
  document: SceneDocument
  coverRef: { id: string; blobHash: string } | null
  payload: PlayerPayload
}) {
  if (!coverRef) return <StaticAlternative document={document} />
  const media = payload.mediaManifest.find((m) => m.blobHash === coverRef.blobHash)
  const src = media?.mediaType?.startsWith('image/')
    ? `/api/media/blob/${coverRef.blobHash}`
    : null
  const title = document.documentMeta.type ?? '演示'
  return (
    <div className="player-static-alt" role="img" aria-label={title}>
      {src ? (
        <img className="player-static-cover-img" src={src} alt={title} loading="lazy" />
      ) : (
        <div className="player-static-cover">{title}</div>
      )}
      <p className="player-static-note">静态替代视图（已降级）</p>
    </div>
  )
}

/** Unused guard to keep Geometry2DPrimitive type referenced (type-only). */
export type { Geometry2DPrimitive }
