/**
 * player/controls — unified playback controls (spec §6.7/§6.8).
 *
 * Play/pause, timeline scrub, chapter jump, fullscreen — one control set on
 * every device, keyboard-reachable (Tab order + Enter/Space). Fullscreen uses
 * the native Fullscreen API on the same document/scene (deterministic
 * re-evaluation, state preserved on exit).
 */
import { useEffect, useRef, useState } from 'react'

export interface PlayerControlsProps {
  playing: boolean
  onTogglePlay: () => void
  currentTime: number
  duration: number
  onSeek: (t: number) => void
  chapters: Array<{ title: string }>
  currentChapter: number
  onChapter: (index: number) => void
  /** Accessibility text view toggle. */
  showTextView: boolean
  onToggleTextView: () => void
  /** Player root ref for fullscreen. */
  containerRef: React.RefObject<HTMLElement | null>
}

function formatTime(t: number): string {
  if (!Number.isFinite(t) || t < 0) t = 0
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function PlayerControls(props: PlayerControlsProps) {
  const {
    playing,
    onTogglePlay,
    currentTime,
    duration,
    onSeek,
    chapters,
    currentChapter,
    onChapter,
    showTextView,
    onToggleTextView,
    containerRef
  } = props
  const [fullscreen, setFullscreen] = useState(false)
  const fsChangeRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const onFsChange = (): void => {
      setFullscreen(Boolean(document.fullscreenElement))
    }
    fsChangeRef.current = onFsChange
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  const toggleFullscreen = (): void => {
    const el = containerRef.current
    if (!el) return
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {})
    } else {
      void el.requestFullscreen().catch(() => {})
    }
  }

  return (
    <div className="player-controls" role="toolbar" aria-label="播放控制">
      <button
        type="button"
        className="player-btn"
        onClick={onTogglePlay}
        aria-label={playing ? '暂停' : '播放'}
      >
        {playing ? '⏸' : '▶'}
      </button>
      <input
        type="range"
        className="player-scrub"
        min={0}
        max={Math.max(duration, 1)}
        step={0.1}
        value={Math.min(currentTime, Math.max(duration, 1))}
        onChange={(e) => onSeek(Number(e.target.value))}
        aria-label="时间轴"
      />
      <span className="player-time">
        {formatTime(currentTime)} / {formatTime(duration)}
      </span>
      {chapters.length > 1 && (
        <select
          className="player-chapter"
          value={currentChapter}
          onChange={(e) => onChapter(Number(e.target.value))}
          aria-label="章节"
        >
          {chapters.map((c, i) => (
            <option key={i} value={i}>
              {c.title}
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        className="player-btn"
        onClick={onToggleTextView}
        aria-pressed={showTextView}
        aria-label="文字替代视图"
      >
        文字
      </button>
      <button
        type="button"
        className="player-btn"
        onClick={toggleFullscreen}
        aria-label={fullscreen ? '退出全屏' : '全屏'}
      >
        {fullscreen ? '⛶退出' : '⛶'}
      </button>
    </div>
  )
}
