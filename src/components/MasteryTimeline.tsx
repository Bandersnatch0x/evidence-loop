import { useMemo } from 'react'
import { TrendingUp } from 'lucide-react'
import type { MasteryTimelineEntry } from '../../shared/contracts'
import { EvidenceShieldBadge } from './EvidenceShieldBadge'
import { toPercent } from '../lib/masteryView'

interface MasteryTimelineProps {
  kpLabel: string
  entries: MasteryTimelineEntry[]
}

const VIEW_WIDTH = 320
const VIEW_HEIGHT = 96
const PADDING = 8

function formatPoint(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric'
  }).format(new Date(value))
}

/**
 * Single knowledge-point mastery trend (ADR-0006 hard-fact view).
 *
 * Every plotted point is an evidence-derived score, so the latest value carries
 * an evidence shield that traces back to the concrete evidence ids.
 */
export function MasteryTimeline({ kpLabel, entries }: MasteryTimelineProps) {
  const path = useMemo(() => buildLinePath(entries), [entries])
  const latest = entries.at(-1)

  if (entries.length === 0) {
    return (
      <div className="mastery-timeline is-empty">
        <TrendingUp size={18} />
        <p>该知识点还没有历史证据，完成一次相关提交后即可查看趋势。</p>
      </div>
    )
  }

  return (
    <div className="mastery-timeline">
      <header className="mastery-timeline-head">
        <div>
          <span className="section-label">历史趋势</span>
          <h3>{kpLabel}</h3>
        </div>
        {latest && (
          <div className="mastery-timeline-latest">
            <strong>{toPercent(latest.score)}%</strong>
            <EvidenceShieldBadge
              evidenceIds={latest.evidenceIds}
              algorithm={latest.algorithmVersion}
            />
          </div>
        )}
      </header>

      <svg
        className="mastery-timeline-chart"
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        role="img"
        aria-label={`${kpLabel} 掌握度趋势，共 ${entries.length} 个数据点`}
        preserveAspectRatio="none"
      >
        <line
          x1={PADDING}
          y1={VIEW_HEIGHT - PADDING}
          x2={VIEW_WIDTH - PADDING}
          y2={VIEW_HEIGHT - PADDING}
          className="mastery-timeline-axis"
        />
        {path.area && <path d={path.area} className="mastery-timeline-fill" />}
        {path.line && <path d={path.line} className="mastery-timeline-line" />}
        {path.points.map((point) => (
          <circle
            key={point.key}
            cx={point.x}
            cy={point.y}
            r={2.5}
            className="mastery-timeline-dot"
          />
        ))}
      </svg>

      <ol className="mastery-timeline-legend">
        {entries.map((entry) => (
          <li key={entry.id}>
            <span>{formatPoint(entry.computedAt)}</span>
            <b>{toPercent(entry.score)}%</b>
          </li>
        ))}
      </ol>
    </div>
  )
}

interface LinePath {
  line: string
  area: string
  points: Array<{ key: string; x: number; y: number }>
}

function buildLinePath(entries: MasteryTimelineEntry[]): LinePath {
  if (entries.length === 0) return { line: '', area: '', points: [] }

  const usableWidth = VIEW_WIDTH - PADDING * 2
  const usableHeight = VIEW_HEIGHT - PADDING * 2
  const step = entries.length > 1 ? usableWidth / (entries.length - 1) : 0

  const points = entries.map((entry, index) => {
    const clamped = Math.max(0, Math.min(1, entry.score))
    const x = entries.length > 1 ? PADDING + step * index : VIEW_WIDTH / 2
    const y = PADDING + (1 - clamped) * usableHeight
    return { key: String(entry.id), x, y }
  })

  const line = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ')

  const first = points[0]
  const last = points.at(-1)
  const baseline = VIEW_HEIGHT - PADDING
  const area =
    first && last
      ? `${line} L ${last.x.toFixed(2)} ${baseline} L ${first.x.toFixed(2)} ${baseline} Z`
      : ''

  return { line, area, points }
}
