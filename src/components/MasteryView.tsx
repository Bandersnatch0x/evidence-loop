import { useEffect, useMemo, useState, lazy, Suspense } from 'react'
import { AlertTriangle, PlayCircle, ShieldCheck, Target } from 'lucide-react'
import type {
  DemonstrationReferenceView,
  InterventionSuggestion,
  KnowledgePoint,
  MasteryProfileMap,
  MasteryTimelineEntry
} from '../../shared/contracts'
import { getNextIntervention, getMasteryProfile, getMasteryTimeline } from '../lib/api'
import { buildKpNameMap, kpName } from '../lib/masteryView'
import { MasteryHeatmap } from './MasteryHeatmap'
import { MasteryTimeline } from './MasteryTimeline'

// StudentDemonstration pulls StudentPlayer; lazy-load so the player chunk
// stays off the mastery page's first paint (spec §8 chunk isolation).
const StudentDemonstration = lazy(() =>
  import('./demonstration/StudentDemonstration').then((m) => ({ default: m.StudentDemonstration }))
)

/** Fetch KP-bound demonstrations (知识点页 expanded mode). */
async function fetchKpDemonstrations(kpId: string): Promise<DemonstrationReferenceView[]> {
  const response = await fetch(`/api/demonstrations/by-kp/${encodeURIComponent(kpId)}`)
  if (!response.ok) return []
  const data = (await response.json()) as { demonstrations?: DemonstrationReferenceView[] }
  return data.demonstrations ?? []
}

interface MasteryViewProps {
  studentId: string
  points: KnowledgePoint[]
  /** P0: open a practice attempt for the intervention's target question. */
  onStartQuestion?: (questionId: string, mode: 'practice' | 'assessment') => void
}

/**
 * Student "我的掌握度" page (ADR-0006 hard-fact view).
 *
 * Loads the evidence-derived profile plus a per-knowledge-point timeline. The
 * heatmap selects which knowledge point the trend chart renders.
 */
export function MasteryView({ studentId, points, onStartQuestion }: MasteryViewProps) {
  const [profile, setProfile] = useState<MasteryProfileMap>({})
  const [selectedKpId, setSelectedKpId] = useState<string>()
  const [timeline, setTimeline] = useState<MasteryTimelineEntry[]>([])
  const [demos, setDemos] = useState<DemonstrationReferenceView[] | null>(null)
  const [demosLoading, setDemosLoading] = useState(false)
  const [intervention, setIntervention] = useState<InterventionSuggestion>()
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

  useEffect(() => {
    if (!selectedKpId) {
      setDemos(null)
      return
    }
    let cancelled = false
    setDemosLoading(true)
    fetchKpDemonstrations(selectedKpId)
      .then((loaded) => {
        if (!cancelled) setDemos(loaded)
      })
      .catch(() => {
        if (!cancelled) setDemos([])
      })
      .finally(() => {
        if (!cancelled) setDemosLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedKpId])

  // P0: fetch the next intervention for the selected knowledge point — closes
  // the "diagnosis → intervention" gap. ADR-0006: suggestions only, never score.
  useEffect(() => {
    if (!selectedKpId) {
      setIntervention(undefined)
      return
    }
    let cancelled = false
    getNextIntervention(studentId, selectedKpId)
      .then((suggestion) => {
        if (!cancelled) setIntervention(suggestion)
      })
      .catch(() => {
        if (!cancelled) setIntervention(undefined)
      })
    return () => {
      cancelled = true
    }
  }, [studentId, selectedKpId])

  if (isLoading) {
    return (
      <div className="view-loading" role="status" aria-live="polite"><span className="loading-bar" />正在读取掌握度证据...</div>
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

      {selectedKpId && intervention && intervention.chain.length > 0 ? (
        <section className="mastery-section" aria-label="干预建议">
          <div className="section-heading">
            <Target size={16} />
            <h2>下一步干预 · {kpName(kpNames, selectedKpId)}</h2>
          </div>
          <div className="intervention-card">
            <p className="intervention-meta">
              薄弱知识点：{kpName(kpNames, intervention.weakKp)} →
              目标：{kpName(kpNames, intervention.targetKp)}
            </p>
            <ol className="intervention-chain">
              {intervention.chain.map((kpId) => (
                <li key={kpId}>{kpName(kpNames, kpId)}</li>
              ))}
            </ol>
            {onStartQuestion ? (
              <button
                type="button"
                className="primary-button intervention-replay"
                onClick={() => onStartQuestion(intervention.targetKp, 'practice')}
              >
                立即再练
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {selectedKpId && demos !== null && demos.length > 0 ? (
        <section className="mastery-section" aria-label="知识点教学演示">
          <div className="section-heading">
            <PlayCircle size={16} />
            <h2>{kpName(kpNames, selectedKpId)} · 教学演示</h2>
          </div>
          <Suspense fallback={<div className="loading-bar" />}>
            <StudentDemonstration refs={demos} expanded />
          </Suspense>
        </section>
      ) : selectedKpId && !demosLoading && demos !== null ? (
        <section className="mastery-section" aria-label="知识点教学演示">
          <p className="muted">该知识点暂无教学演示</p>
        </section>
      ) : null}
    </div>
  )
}
