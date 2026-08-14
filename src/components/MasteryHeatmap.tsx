import type { CSSProperties } from 'react'
import { Grid2x2Check } from 'lucide-react'
import type { KnowledgePoint, MasteryProfileMap } from '../../shared/contracts'
import { EvidenceShieldBadge } from './EvidenceShieldBadge'
import {
  masteryBand,
  masteryCellColor,
  masteryCellInk,
  toPercent
} from '../lib/masteryView'

interface MasteryHeatmapProps {
  points: KnowledgePoint[]
  profile: MasteryProfileMap
  selectedKpId?: string
  onSelectKp: (kpId: string) => void
}

/**
 * Student-facing knowledge-point heatmap (ADR-0006 hard-fact view).
 *
 * Each cell colours by evidence-derived mastery score and carries an evidence
 * shield so a learner can trace any tile back to the concrete evidence. Clicking
 * a tile selects it for the paired timeline trend.
 */
export function MasteryHeatmap({
  points,
  profile,
  selectedKpId,
  onSelectKp
}: MasteryHeatmapProps) {
  if (points.length === 0) {
    return (
      <div className="mastery-heatmap is-empty">
        <Grid2x2Check size={18} />
        <p>知识图谱暂未加载知识点。</p>
      </div>
    )
  }

  return (
    <div className="mastery-heatmap" role="list" aria-label="知识点掌握度热力图">
      {points.map((point) => {
        const snapshot = profile[point.id]
        const score = snapshot?.score
        const band = masteryBand(score)
        const isSelected = point.id === selectedKpId
        const style = {
          '--cell-bg': masteryCellColor(score),
          '--cell-ink': masteryCellInk(score)
        } as CSSProperties

        return (
          <div
            key={point.id}
            role="listitem"
            className={`mastery-cell band-${band.id} ${isSelected ? 'is-selected' : ''}`}
            style={style}
          >
            <button
              type="button"
              className="mastery-cell-select"
              aria-pressed={isSelected}
              onClick={() => onSelectKp(point.id)}
            >
              <span className="mastery-cell-name">{point.name}</span>
              <span className="mastery-cell-score">
                {score === undefined ? '—' : `${toPercent(score)}%`}
              </span>
              <span className="mastery-cell-band">{band.label}</span>
            </button>
            {snapshot && (
              <span className="mastery-cell-evidence">
                <EvidenceShieldBadge
                  evidenceIds={snapshot.evidenceIds}
                  algorithm={snapshot.algorithmVersion}
                  size={13}
                />
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
