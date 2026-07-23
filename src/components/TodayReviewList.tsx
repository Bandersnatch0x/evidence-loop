import { useState } from 'react'
import { CalendarClock, CheckCircle2, Layers } from 'lucide-react'
import type { ReviewCard } from '../../shared/contracts'
import { kpName } from '../lib/masteryView'

interface TodayReviewListProps {
  cards: ReviewCard[]
  kpNames: Map<string, string>
  /** Marks a card complete via FSRS; resolves once the card is rescheduled. */
  onComplete: (cardId: string, rating: 1 | 2 | 3 | 4) => Promise<void>
}

const stateLabels: Record<ReviewCard['scheduling']['state'], string> = {
  new: '新卡',
  learning: '学习中',
  review: '复习',
  relearning: '重新学习'
}

const ratingOptions: Array<{ rating: 1 | 2 | 3 | 4; label: string }> = [
  { rating: 1, label: '忘记' },
  { rating: 2, label: '困难' },
  { rating: 3, label: '一般' },
  { rating: 4, label: '轻松' }
]

function formatDue(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(value))
}

/**
 * Student-facing FSRS review queue (ADR-0007 §5).
 *
 * Cards come from GET /api/review/next; completing one posts a self-graded
 * rating to POST /api/review/:cardId/complete and drops it from the queue.
 */
export function TodayReviewList({
  cards,
  kpNames,
  onComplete
}: TodayReviewListProps) {
  const [pendingId, setPendingId] = useState<string>()

  if (cards.length === 0) {
    return (
      <div className="review-empty">
        <div className="empty-icon"><CheckCircle2 size={24} /></div>
        <h3>今天没有到期的复习</h3>
        <p>FSRS 会在知识点接近遗忘阈值时把卡片重新排入队列。</p>
      </div>
    )
  }

  const handleComplete = async (cardId: string, rating: 1 | 2 | 3 | 4) => {
    if (pendingId) return
    setPendingId(cardId)
    try {
      await onComplete(cardId, rating)
    } finally {
      setPendingId(undefined)
    }
  }

  return (
    <ul className="review-list" aria-label="今日复习卡片">
      {cards.map((card) => {
        const isPending = pendingId === card.id
        return (
          <li key={card.id} className="review-card">
            <div className="review-card-head">
              <div>
                <span className="section-label">
                  <Layers size={13} /> {stateLabels[card.scheduling.state]}
                </span>
                <h3>{kpName(kpNames, card.kpId)}</h3>
              </div>
              <span className="review-card-due">
                <CalendarClock size={13} /> 到期 {formatDue(card.scheduling.dueAt)}
              </span>
            </div>

            <dl className="review-card-stats">
              <div>
                <dt>复习次数</dt>
                <dd>{card.scheduling.reps}</dd>
              </div>
              <div>
                <dt>遗忘次数</dt>
                <dd>{card.scheduling.lapses}</dd>
              </div>
              <div>
                <dt>稳定度</dt>
                <dd>{card.scheduling.stability.toFixed(1)}</dd>
              </div>
            </dl>

            <div className="review-card-actions" role="group" aria-label="复习评分">
              {ratingOptions.map((option) => (
                <button
                  key={option.rating}
                  type="button"
                  className={`review-rating rating-${option.rating}`}
                  disabled={isPending}
                  onClick={() => void handleComplete(card.id, option.rating)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
