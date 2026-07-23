import type { CSSProperties } from 'react'
import { Grid3x3 } from 'lucide-react'
import type { KnowledgePoint, MasteryProfileMap } from '../../shared/contracts'
import {
  masteryCellColor,
  masteryCellInk,
  toPercent
} from '../lib/masteryView'

export interface CohortMatrixLearner {
  id: string
  displayName: string
  profile: MasteryProfileMap
}

interface CohortMasteryMatrixProps {
  points: KnowledgePoint[]
  learners: CohortMatrixLearner[]
}

/**
 * Teacher-facing class × knowledge-point mastery grid (ADR-0006 hard-fact view).
 *
 * Every cell is an evidence-derived score, colour-graded from pale wash to
 * saturated indigo. Only the evidence layer is rendered — grey/green/orange
 * provenance shading is out of scope for this milestone.
 */
export function CohortMasteryMatrix({
  points,
  learners
}: CohortMasteryMatrixProps) {
  if (points.length === 0 || learners.length === 0) {
    return (
      <div className="cohort-matrix is-empty">
        <Grid3x3 size={18} />
        <p>暂无可展示的班级掌握度证据。</p>
      </div>
    )
  }

  return (
    <div className="cohort-matrix-scroll">
      <table className="cohort-matrix" aria-label="班级知识点掌握度矩阵">
        <thead>
          <tr>
            <th scope="col" className="cohort-matrix-corner">
              学员 \ 知识点
            </th>
            {points.map((point) => (
              <th key={point.id} scope="col" title={point.name}>
                <span>{point.name}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {learners.map((learner) => (
            <tr key={learner.id}>
              <th scope="row">{learner.displayName}</th>
              {points.map((point) => {
                const snapshot = learner.profile[point.id]
                const score = snapshot?.score
                const style = {
                  '--cell-bg': masteryCellColor(score),
                  '--cell-ink': masteryCellInk(score)
                } as CSSProperties
                return (
                  <td
                    key={point.id}
                    className="cohort-matrix-cell"
                    style={style}
                    title={`${learner.displayName} · ${point.name}`}
                  >
                    {score === undefined ? '—' : `${toPercent(score)}%`}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
