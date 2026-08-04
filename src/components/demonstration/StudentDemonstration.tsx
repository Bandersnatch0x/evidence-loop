/**
 * StudentDemonstration — student-side demonstration presentation (ticket T-J,
 * spec §8 学生侧触点矩阵 (b)).
 *
 * - 做题中: primary demo only (below prompt, above answer area), static cover +
 *   play button, never auto-play.
 * - 解析页: primary + collapsible supplementary list.
 * - 知识点页: primary expanded by default.
 * - Source badge: public library "作者+许可+版本" / teacher-created "我的演示".
 *   Source only affects display, never capability (same player).
 */
import { useEffect, useState } from 'react'
import { StudentPlayer } from '../player/StudentPlayer'
import type { PlayerPayload } from '../../../server/demonstration/playerRoutes'

export interface StudentRef {
  id: string
  role: 'primary' | 'supplementary'
  title: string
  authorName: string
  license: string
  versionSeq: number
  source: 'public' | 'mine'
  demoId: string
  versionId: string
  health: string
}

export interface StudentDemonstrationProps {
  refs: StudentRef[]
  /** false = 做题中 (primary only, no auto-play); true = 解析/知识点页. */
  expanded: boolean
  /** Injected player loader (tests); defaults to fetch. */
  loadPlayer?: (demoId: string, versionId: string) => Promise<{ document: unknown; mediaManifest: PlayerPayload['mediaManifest'] }>
}

export function StudentDemonstration({ refs, expanded, loadPlayer }: StudentDemonstrationProps) {
  const primary = refs.find((r) => r.role === 'primary')
  const supplementary = refs.filter((r) => r.role === 'supplementary')
  const [active, setActive] = useState<{ demoId: string; versionId: string; document: unknown; mediaManifest: PlayerPayload['mediaManifest'] } | null>(null)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    if (!primary) return
    const load = async (): Promise<void> => {
      const data = loadPlayer
        ? await loadPlayer(primary.demoId, primary.versionId)
        : await fetch(`/api/demonstrations/${primary.demoId}/versions/${primary.versionId}/player`).then((r) =>
            r.ok ? (r.json() as Promise<{ document: unknown; mediaManifest: PlayerPayload['mediaManifest'] }>) : { document: null, mediaManifest: [] }
          )
      setActive({ demoId: primary.demoId, versionId: primary.versionId, document: data.document, mediaManifest: data.mediaManifest })
    }
    void load()
  }, [primary, loadPlayer])

  if (!primary) return null

  const badge = (r: StudentRef): string =>
    r.source === 'public' ? `${r.authorName} · ${r.license} · v${r.versionSeq}` : '我的演示'

  return (
    <div className="student-demo" data-role={primary.role}>
      <div className="student-demo-badge" title={badge(primary)}>
        {primary.source === 'public' ? '公共库' : '我的演示'}
        <span className="student-demo-version">v{primary.versionSeq}</span>
        {primary.health !== 'healthy' && <span className="ref-unavailable">源不可用（继续播放）</span>}
      </div>
      {active ? (
        <StudentPlayer
          payload={{
            demonstrationId: active.demoId,
            versionId: active.versionId,
            status: 'approved',
            document: active.document,
            renderLevel: 'full',
            reasons: [],
            mediaManifest: active.mediaManifest,
            coverRef: null,
            subtitleRef: null,
            budget: { ok: true, issues: [], nodes: 0, triangles: 0, durationSeconds: 0, mediaRefs: 0 },
            externalVideos: []
          }}
        />
      ) : (
        <div className="student-demo-loading" role="status">
          正在加载演示…
        </div>
      )}

      {supplementary.length > 0 && expanded && (
        <div className="student-demo-supplementary">
          <button
            type="button"
            className="student-demo-toggle"
            onClick={() => setCollapsed((v) => !v)}
            aria-expanded={!collapsed}
          >
            补充演示（{supplementary.length}）{collapsed ? '▸' : '▾'}
          </button>
          {!collapsed && (
            <ul className="student-demo-supp-list">
              {supplementary.map((r) => (
                <li key={r.id} className="student-demo-supp-item">
                  <span className="student-demo-badge">{badge(r)}</span>
                  {r.health !== 'healthy' && <span className="ref-unavailable">源不可用（继续播放）</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}