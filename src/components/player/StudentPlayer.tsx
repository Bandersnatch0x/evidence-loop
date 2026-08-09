/**
 * StudentPlayer — the ONLY read-only consumer of demonstration snapshots
 * (spec §6, ticket T-G). Iron laws:
 *   - reads immutable approved snapshots only (via the player payload API)
 *   - never parses drafts
 *   - executes zero script from the scene (no eval/Function/dynamic import)
 *   - never receives or forwards student submissions
 *   - produces no evidence/score/Attempt/MasteryProfile; playback behavior is
 *     at most anonymous display stats (not implemented in v1)
 *   - render level is negotiated BEFORE any asset load (capabilities)
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PlayerPayload } from '../../../server/demonstration/playerRoutes'
import { safeParseSceneDocument } from '../../../server/demonstration/sceneDocumentSchema'
import { negotiateCapabilities, type DeviceCapability, type RenderLevel } from '../../../server/demonstration/capabilities'
import { checkPlayerBudget, chapterOverBudget } from './budget'
import { probeDevice } from './capabilityProbe'
import {
  chaptersFromTimeline,
  emptyLoadState,
  requestChapter,
  requestEngine,
  requestVideo,
  requiresEngine,
  type PlayerLoadState
} from './lazyLoad'
import { initialState, nextStep, nextView, togglePick, type InteractionState } from './interactions'
import { sampleTrack } from './determinism'
import { initialRuntimeState, type SceneRuntimeState } from './playerState'
import { SvgSceneRenderer, PlayCanvasScene, StaticAlternative, StaticAlternativeWithCover } from './renderers'
import { VideoOrchestration } from './videoOrchestration'
import { PlayerControls } from './controls'

export interface StudentPlayerProps {
  payload: PlayerPayload
  /** Optional injected device probe (tests); defaults to real probe. */
  device?: DeviceCapability
  /** Optional injected animation clock (tests); defaults to rAF. */
  play?: boolean
}

export function StudentPlayer({ payload, device, play = false }: StudentPlayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const runtimeRef = useRef<SceneRuntimeState>(initialRuntimeState())
  const currentTimeRef = useRef(0)

  // Render level negotiated BEFORE asset load (spec §6.9).
  const probe = useMemo<DeviceCapability>(() => device ?? probeDevice(), [device])
  const scene = useMemo(() => {
    if (payload.document === null || payload.document === undefined) return null
    const parsed = safeParseSceneDocument(payload.document)
    return parsed.success ? parsed.document : null
  }, [payload.document])
  const renderLevel = useMemo<RenderLevel>(() => {
    if (!scene) return 'refuse'
    return negotiateCapabilities(scene, probe)
  }, [scene, probe])

  // Budget second gate (spec §6.5): refuse to load over-budget content.
  // Trust the server preflight (payload.budget) and layer the client-side
  // check on top (never silently truncate).
  const budgetIssues = useMemo(() => {
    if (!scene) return ['snapshot unavailable']
    const local = checkPlayerBudget(scene).map((i) => i.message)
    if (!payload.budget.ok) {
      return [...payload.budget.issues, ...local]
    }
    return local
  }, [scene, payload.budget])

  const [loadState, setLoadState] = useState<PlayerLoadState>(() =>
    scene && requiresEngine(scene) ? requestEngine(emptyLoadState()) : emptyLoadState()
  )
  const [interactionStates, setInteractionStates] = useState<InteractionState[]>(() =>
    (scene?.interactions ?? []).map((i) => initialState(i))
  )
  const [playing, setPlaying] = useState(play)
  const [currentTime, setCurrentTime] = useState(0)
  const [currentChapter, setCurrentChapter] = useState(0)
  const [showTextView, setShowTextView] = useState(false)
  const [chapterOverBudgetFlag, setChapterOverBudget] = useState(false)
  const [runtime, setRuntime] = useState<SceneRuntimeState>(initialRuntimeState)

  const chapters = useMemo(() => chaptersFromTimeline(scene?.timeline), [scene])
  const duration = scene?.timeline?.duration ?? 0

  // Deterministic animation clock: rAF advances currentTime and samples the
  // animation tracks into the runtime overlay (spec §6.1 #2/§6.3). Pausing
  // freezes state; resuming continues deterministically from the same time.
  useEffect(() => {
    if (!playing || !scene?.timeline || scene.timeline.tracks.length === 0) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number): void => {
      const dt = (now - last) / 1000
      last = now
      // Advance the authoritative clock ref BEFORE sampling (the overlay must
      // sample the same time the scrubber displays — spec §6.3 determinism).
      const next = Math.min(currentTimeRef.current + dt, scene.timeline?.duration ?? Number.MAX_SAFE_INTEGER)
      currentTimeRef.current = next
      setCurrentTime(next)
      if (scene.timeline?.duration !== undefined && next >= scene.timeline.duration) {
        setPlaying(false)
        return
      }
      // Sample deterministic keyframe interpolation into the runtime overlay.
      const nextRuntime: SceneRuntimeState = {
        ...runtimeRef.current,
        nodeTransforms: new Map(runtimeRef.current.nodeTransforms)
      }
      const visible = new Set(nextRuntime.visibleNodeIds ?? [])
      for (const track of scene.timeline?.tracks ?? []) {
        const sample = sampleTrack(track.keyframes, next)
        if (sample.value === undefined) continue
        const base = nextRuntime.nodeTransforms.get(track.nodeId) ?? {
          position: [0, 0, 0] as [number, number, number],
          rotation: [0, 0, 0] as [number, number, number],
          scale: [1, 1, 1] as [number, number, number]
        }
        const property = track.keyframes[0]?.property ?? ''
        if (property.startsWith('transform.position') && Array.isArray(sample.value)) {
          nextRuntime.nodeTransforms.set(track.nodeId, { ...base, position: sample.value })
        } else if (property.startsWith('transform.rotation') && Array.isArray(sample.value)) {
          nextRuntime.nodeTransforms.set(track.nodeId, { ...base, rotation: sample.value })
        } else if (property.startsWith('transform.scale') && Array.isArray(sample.value)) {
          nextRuntime.nodeTransforms.set(track.nodeId, { ...base, scale: sample.value })
        } else if (property === 'visible' && typeof sample.value === 'boolean') {
          if (sample.value) visible.add(track.nodeId)
          else visible.delete(track.nodeId)
        }
      }
      nextRuntime.visibleNodeIds = visible.size > 0 ? visible : null
      runtimeRef.current = nextRuntime
      setRuntime(nextRuntime)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, scene])

  // visibilitychange: stop the animation loop and release background render.
  useEffect(() => {
    const onVis = (): void => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        setPlaying(false)
      }
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVis)
    }
    return () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVis)
      }
    }
  }, [])

  const handleSeek = (t: number): void => {
    currentTimeRef.current = t
    setCurrentTime(t)
  }

  // P2-1 重播：回到起点（时间 + 章节）并从首段重新播放。分段原则优于连续动画。
  const handleReplay = (): void => {
    currentTimeRef.current = 0
    setCurrentTime(0)
    setCurrentChapter(0)
    setLoadState((s) => requestChapter(s, 0))
    setPlaying(true)
  }

  const handleChapter = (index: number): void => {
    setCurrentChapter(index)
    setLoadState((s) => requestChapter(s, index))
    const chapter = chapters[index]
    const mediaRefId = chapter?.mediaRefId
    if (chapter?.kind === 'video' && mediaRefId) {
      // Spec §6.5: 单章素材清单字节数 gate before pulling the chapter's video.
      const manifest = payload.mediaManifest.find((m) => m.assetId === mediaRefId)
      if (chapterOverBudget(manifest?.byteSize)) {
        setChapterOverBudget(true)
        return
      }
      setLoadState((s) => requestVideo(s, mediaRefId))
    }
  }

  const handleRequestVideo = (mediaRefId: string): void => {
    setLoadState((s) => requestVideo(s, mediaRefId))
  }

  const advanceInteraction = (type: string): void => {
    setInteractionStates((states) =>
      states.map((s) => {
        if (type === 'step-visibility') return nextStep(s)
        if (type === 'view-switch') return nextView(s)
        if (type === 'pick-highlight') return togglePick(s)
        return s
      })
    )
    // Apply the interaction to the runtime overlay (spec §6.2).
    setRuntime((r) => {
      const next: SceneRuntimeState = { ...r, nodeTransforms: new Map(r.nodeTransforms) }
      if (type === 'orbit') {
        next.orbitAngle = r.orbitAngle + Math.PI / 8
      } else if (type === 'view-switch') {
        const interaction = (scene?.interactions ?? []).find((i) => i.type === 'view-switch')
        const count = interaction?.type === 'view-switch' ? interaction.viewpoints.length : 1
        next.viewIndex = (r.viewIndex + 1) % Math.max(count, 1)
      } else if (type === 'step-visibility') {
        const idx = (scene?.interactions ?? []).findIndex((i) => i.type === 'step-visibility')
        const state = interactionStates[idx]
        const interaction = scene?.interactions?.find((i) => i.type === 'step-visibility')
        if (state && state.type === 'step-visibility' && interaction?.type === 'step-visibility') {
          const show = interaction.steps[state.stepIndex]?.show ?? []
          const visible = new Set(show)
          next.visibleNodeIds = visible
        }
      } else if (type === 'pick-highlight') {
        const idx = (scene?.interactions ?? []).findIndex((i) => i.type === 'pick-highlight')
        const state = interactionStates[idx]
        if (state && state.type === 'pick-highlight') {
          const toggled = togglePick(state)
          if (toggled.type === 'pick-highlight') {
            next.highlightNodeId = toggled.picked ? toggled.nodeId : null
          } else {
            next.highlightNodeId = null
          }
        } else {
          next.highlightNodeId = null
        }
      }
      runtimeRef.current = next
      return next
    })
  }

  // Render paths: refuse/static → text view OR static alternative; else 2D SVG
  // / 3D / video by content type.
  const showStatic = renderLevel === 'static-alternative' || renderLevel === 'refuse' || budgetIssues.length > 0
  const has3D = (scene?.geometry3D ?? []).length > 0
  const has2D = (scene?.geometry2D ?? []).length > 0
  const hasVideoChapters = chapters.some((c) => c.kind === 'video')

  return (
    <div className="student-player" ref={containerRef} data-render-level={renderLevel}>
      {budgetIssues.length > 0 && (
        <div className="player-warning" role="alert">
          资源超预算：{budgetIssues[0]}
        </div>
      )}
      {renderLevel === 'simplified' && budgetIssues.length === 0 && (
        <div className="player-degradation" role="status">
          已启用简化渲染（设备性能）
        </div>
      )}
      {chapterOverBudgetFlag && (
        <div className="player-warning" role="alert">
          该章节素材超过预算，已拒绝加载
        </div>
      )}
      {showStatic || showTextView ? (
        <div className="player-text-view" role="region" aria-label="文字替代视图">
          {scene ? (
            <StaticAlternativeWithCover document={scene} coverRef={payload.coverRef} payload={payload} />
          ) : (
            <div className="player-static-alt">快照不可用</div>
          )}
          {scene?.timeline?.chapters.map((c, i) => (
            <p key={i} className="player-text-line">
              {i + 1}. {c.title}
            </p>
          ))}
        </div>
      ) : (
        <div className="player-stage">
          {has3D ? (
            <PlayCanvasScene document={scene!} level={renderLevel} runtime={runtime} />
          ) : hasVideoChapters ? (
            <VideoOrchestration
              chapters={chapters}
              payload={payload}
              requested={loadState.videoRequested}
              onRequestVideo={handleRequestVideo}
              currentChapter={currentChapter}
            />
          ) : has2D ? (
            <SvgSceneRenderer document={scene!} runtime={runtime} />
          ) : (
            <StaticAlternative document={scene!} />
          )}
        </div>
      )}

      {scene && (
        <div className="player-interactions" role="group" aria-label="场景互动">
          {(scene.interactions ?? []).map((interaction, i) => {
            const state = interactionStates[i]
            if (!state) return null
            if (interaction.type === 'orbit') {
              return (
                <button
                  key={i}
                  type="button"
                  className="player-interact-btn"
                  onClick={() => advanceInteraction('orbit')}
                  aria-label="旋转/缩放"
                >
                  {interaction.enabled ? '🔄' : '🔄（不可用）'}
                </button>
              )
            }
            if (interaction.type === 'step-visibility') {
              const stepLabel =
                state.type === 'step-visibility' ? `步骤 ${state.stepIndex + 1}/${state.total}` : '步骤'
              return (
                <button
                  key={i}
                  type="button"
                  className="player-interact-btn"
                  onClick={() => advanceInteraction('step-visibility')}
                  aria-label="下一步骤"
                >
                  {stepLabel}
                </button>
              )
            }
            if (interaction.type === 'view-switch') {
              return (
                <button
                  key={i}
                  type="button"
                  className="player-interact-btn"
                  onClick={() => advanceInteraction('view-switch')}
                  aria-label="切换视角"
                >
                  视角
                </button>
              )
            }
            if (interaction.type === 'pick-highlight') {
              return (
                <button
                  key={i}
                  type="button"
                  className="player-interact-btn"
                  onClick={() => advanceInteraction('pick-highlight')}
                  aria-pressed={state.type === 'pick-highlight' ? state.picked : false}
                  aria-label={interaction.label ?? '对象高亮'}
                >
                  {interaction.label ?? '高亮'}
                </button>
              )
            }
            return null
          })}
        </div>
      )}

      {scene && (
        <PlayerControls
          playing={playing}
          onTogglePlay={() => setPlaying((p) => !p)}
          currentTime={currentTime}
          duration={duration}
          onSeek={handleSeek}
          chapters={chapters}
          currentChapter={currentChapter}
          onChapter={handleChapter}
          onReplay={handleReplay}
          showTextView={showTextView}
          onToggleTextView={() => setShowTextView((v) => !v)}
          containerRef={containerRef}
        />
      )}
    </div>
  )
}
