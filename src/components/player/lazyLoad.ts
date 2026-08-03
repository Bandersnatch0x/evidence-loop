/**
 * player/lazyLoad — lazy-load orchestration (spec §6.6).
 *
 * The entry loads only the entrance scene + required assets. Chapters, videos
 * and 3D models load on demand (chapter jump pulls that chapter's resources;
 * external-video iframes load only after click). Pure state machine — the
 * React layer renders per state and fetches per action.
 */
import type { SceneDocument, Timeline } from '../../../server/demonstration/sceneDocumentSchema'

export type ChapterKind = 'scene' | 'video'

export interface ChapterDescriptor {
  index: number
  kind: ChapterKind
  title: string
  mediaRefId?: string
  startTime: number
  endTime?: number
}

export interface PlayerLoadState {
  /** Chapters resolved so far (lazy). */
  loadedChapters: number[]
  /** True once the 3D engine chunk has been requested (React.lazy). */
  engineRequested: boolean
  engineLoaded: boolean
  /** True once an external video iframe has been requested (click-gated). */
  videoRequested: string[]
}

export function emptyLoadState(): PlayerLoadState {
  return { loadedChapters: [], engineRequested: false, engineLoaded: false, videoRequested: [] }
}

/** Resolve the chapter list from the timeline (declarative, deterministic). */
export function chaptersFromTimeline(timeline: Timeline | undefined): ChapterDescriptor[] {
  if (!timeline) return []
  return timeline.chapters.map((c, index) => ({
    index,
    kind: c.mediaRefId ? 'video' : 'scene',
    title: c.title,
    mediaRefId: c.mediaRefId,
    startTime: c.startTime,
    endTime: c.endTime
  }))
}

/** Request a chapter load; returns the next load state (pure). */
export function requestChapter(state: PlayerLoadState, chapterIndex: number): PlayerLoadState {
  if (state.loadedChapters.includes(chapterIndex)) return state
  return { ...state, loadedChapters: [...state.loadedChapters, chapterIndex] }
}

export function requestEngine(state: PlayerLoadState): PlayerLoadState {
  if (state.engineRequested) return state
  return { ...state, engineRequested: true }
}

export function markEngineLoaded(state: PlayerLoadState): PlayerLoadState {
  return { ...state, engineLoaded: true }
}

export function requestVideo(state: PlayerLoadState, mediaRefId: string): PlayerLoadState {
  if (state.videoRequested.includes(mediaRefId)) return state
  return { ...state, videoRequested: [...state.videoRequested, mediaRefId] }
}

/**
 * Does the document require the 3D engine at all? (glTF refs or 3D primitives
 * or webgl capability). The entry stays lightweight when false.
 */
export function requiresEngine(doc: SceneDocument): boolean {
  if ((doc.geometry3D ?? []).length > 0) return true
  if (doc.runtimeVersion.capabilities.some((c) => c === 'webgl2' || c === 'webgl1' || c === 'webgpu')) {
    return true
  }
  return false
}
