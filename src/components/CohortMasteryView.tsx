import { useEffect, useState } from 'react'
import { AlertTriangle, Grid3x3, ShieldCheck } from 'lucide-react'
import type { KnowledgePoint } from '../../shared/contracts'
import {
  getKnowledgeGraph,
  getMasteryProfile
} from '../lib/api'
import {
  CohortMasteryMatrix,
  type CohortMatrixLearner
} from './CohortMasteryMatrix'

interface CohortMasteryViewProps {
  /** Cohort learner identities to chart (id + display name). */
  learners: Array<{ id: string; displayName: string }>
}

interface LoadedMatrix {
  points: KnowledgePoint[]
  rows: CohortMatrixLearner[]
}

/**
 * Teacher-facing class mastery page (ADR-0006 hard-fact view).
 *
 * Pulls the knowledge graph plus each learner's evidence-derived profile and
 * renders them as a class × knowledge-point grid.
 */
export function CohortMasteryView({ learners }: CohortMasteryViewProps) {
  const [data, setData] = useState<LoadedMatrix>()
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string>()

  useEffect(() => {
    let active = true
    setIsLoading(true)
    setError(undefined)

    void (async () => {
      try {
        const graph = await getKnowledgeGraph()
        const profiles = await Promise.all(
          learners.map(async (learner) => {
            try {
              const profile = await getMasteryProfile(learner.id)
              return { ...learner, profile }
            } catch {
              return { ...learner, profile: {} }
            }
          })
        )
        if (!active) return
        setData({ points: graph.points, rows: profiles })
      } catch (loadError) {
        if (!active) return
        setError(
          loadError instanceof Error ? loadError.message : '班级掌握度加载失败'
        )
      } finally {
        if (active) setIsLoading(false)
      }
    })()

    return () => {
      active = false
    }
  }, [learners])

  return (
    <div className="page-view mastery-page">
      <header className="page-heading">
        <div>
          <h1>班级学情 · 掌握度矩阵</h1>
          <p>横轴为知识点，纵轴为学员，单元格颜色越深表示掌握度越高 · 全部基于可复现证据</p>
        </div>
        <div className="updated-at">
          <ShieldCheck size={15} />仅展示证据层
        </div>
      </header>

      {error && (
        <div className="inline-error" role="alert">
          <AlertTriangle size={16} />{error}
        </div>
      )}

      {isLoading || !data ? (
        <div className="view-loading"><span className="loading-bar" />正在汇总班级掌握度证据...</div>
      ) : (
        <section className="mastery-section">
          <div className="mastery-section-head">
            <Grid3x3 size={16} />
            <h2>班级 × 知识点</h2>
          </div>
          <CohortMasteryMatrix points={data.points} learners={data.rows} />
        </section>
      )}
    </div>
  )
}
