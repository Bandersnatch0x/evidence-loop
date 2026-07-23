import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ShieldCheck } from 'lucide-react'
import type {
  KnowledgePoint,
  MasteryProfileMap,
  MasteryTimelineEntry
} from '../../shared/contracts'
import { getMasteryProfile, getMasteryTimeline } from '../lib/api'
import { buildKpNameMap, kpName } from '../lib/masteryView'
import { MasteryHeatmap } from './MasteryHeatmap'
import { MasteryTimeline } from './MasteryTimeline'

interface MasteryViewProps {
  studentId: string
  points: KnowledgePoint[]
}

/**
 * Student "我的掌握度" page (ADR-0006 hard-fact view).
 *
 * Loads the evidence-derived profile plus a per-knowledge-point timeline. The
 * heatmap selects which knowledge point the trend chart renders.
 */
export function MasteryView({ studentId, points }: MasteryViewProps) {
  const [profile, setProfile] = useState<MasteryProfileMap>({})
  const [selectedKpId, setSelectedKpId] = useState<string>()
  const [timeline, setTimeline] = useState<MasteryTimelineEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string>()

  const kpNames = useMemo(() => buildKpNameMap(points), [points])

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(undefined)
    getMasteryProfile(studentId)
      .then((loaded) => {
        if (cancelled) return
        setProfile(loaded)
        const firstTracked = points.find((point) => loaded[point.id])
        setSelectedKpId(firstTracked?.id ?? points[0]?.id)
      })
      .catch((loadError: unknown) => {
        if (cancelled) return
        setError(loadError instanceof Error ? loadError.message : '掌握度加载失败')
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [studentId, points])

  useEffect(() => {
    if (!selectedKpId) {
      setTimeline([])
      return
    }
    let cancelled = false
    getMasteryTimeline(studentId, selectedKpId)
      .then((entries) => {
        if (!cancelled) setTimeline(entries)
      })
      .catch(() => {
        if (!cancelled) setTimeline([])
      })
    return () => {
      cancelled = true
    }
  }, [studentId, selectedKpId])

  if (isLoading) {
    return (
      <div className="view-loading"><span className="loading-bar" />正在读取掌握度证据...</div>
    )
  }

  return (
    <div className="page-view mastery-view">
      <header className="page-heading">
        <div>
          <h1>我的掌握度</h1>
          <p>分数由测试与静态检查证据确定性聚合 · 点击盾牌可溯源到具体证据</p>
        </div>
        <div className="updated-at"><ShieldCheck size={15} />仅显示证据层事实</div>
      </header>

      {error && (
        <div className="inline-error" role="alert">
          <AlertTriangle size={16} />{error}
        </div>
      )}

      <section className="mastery-section" aria-label="知识点掌握度">
        <MasteryHeatmap
          points={points}
          profile={profile}
          selectedKpId={selectedKpId}
          onSelectKp={setSelectedKpId}
        />
      </section>

      <section className="mastery-section" aria-label="掌握度趋势">
        <MasteryTimeline
          kpLabel={selectedKpId ? kpName(kpNames, selectedKpId) : '选择一个知识点'}
          entries={timeline}
        />
      </section>
    </div>
  )
}
