/**
 * player/videoOrchestration — video orchestration (spec §6.1 #3, §6.6).
 *
 * Covers / chapters / playback segments + ExternalVideoRef (YouTube/Vimeo
 * official embed whitelist). The external iframe loads ONLY after user click
 * (spec §6.6: 外链 iframe 点击后才加载). No transcoding, no HLS generation.
 * The player never requests arbitrary URLs — only the allowlisted official
 * player domains from the version snapshot.
 */
import type { PlayerPayload } from '../../../server/demonstration/playerRoutes'
import type { ChapterDescriptor } from './lazyLoad'
import { embedUrl, isPlayableHealth } from './externalVideo'

export interface VideoOrchestrationProps {
  chapters: ChapterDescriptor[]
  payload: PlayerPayload
  /** mediaRefIds clicked so far (lazy iframe load). */
  requested: string[]
  onRequestVideo: (mediaRefId: string) => void
  currentChapter: number
}

export function VideoOrchestration({
  chapters,
  payload,
  requested,
  onRequestVideo,
  currentChapter
}: VideoOrchestrationProps) {
  const chapter = chapters[currentChapter]
  if (!chapter) return null
  if (chapter.kind !== 'video' || !chapter.mediaRefId) return null

  const ext = payload.externalVideos.find((e) => e.id === chapter.mediaRefId)
  const url = ext ? embedUrl(ext.provider, ext.providerVideoId) : null

  if (!ext || !isPlayableHealth(ext.health) || !url) {
    return (
      <div className="player-video-unavailable" role="status">
        该视频源当前不可用（来源健康状态：{ext?.health ?? '未知'}）
      </div>
    )
  }

  if (!requested.includes(chapter.mediaRefId)) {
    return (
      <button
        type="button"
        className="player-video-launch"
        onClick={() => onRequestVideo(chapter.mediaRefId!)}
      >
        ▶ 播放视频（{chapter.title}）
      </button>
    )
  }

  return (
    <div className="player-video-frame">
      <iframe
        src={url}
        title={chapter.title}
        className="player-video-iframe"
        loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        sandbox="allow-scripts allow-same-origin allow-presentation"
      />
    </div>
  )
}
