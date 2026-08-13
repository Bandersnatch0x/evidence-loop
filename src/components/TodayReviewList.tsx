import { useState, lazy, Suspense } from 'react'
import { CalendarClock, CheckCircle2, Layers, PlayCircle } from 'lucide-react'
import type { DemonstrationReferenceView, ReviewCard } from '../../shared/contracts'
import { kpName } from '../lib/masteryView'

// StudentDemonstration pulls StudentPlayer; lazy-load so the player chunk
// stays off the review queue's first paint (spec §8 chunk isolation).
const StudentDemonstration = lazy(() =>
  import('./demonstration/StudentDemonstration').then((m) => ({ default: m.StudentDemonstration }))
)

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

/** Fetch KP-bound demonstrations (知识点页 解析模式). */
async function fetchKpDemonstrations(kpId: string): Promise<DemonstrationReferenceView[]> {
  const response = await fetch(`/api/demonstrations/by-kp/${encodeURIComponent(kpId)}`)
  if (!response.ok) return []
  const data = (await response.json()) as { demonstrations?: DemonstrationReferenceView[] }
  return data.demonstrations ?? []
}

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
            <ReviewCardBody
              card={card}
              kpNames={kpNames}
              isPending={isPending}
              onComplete={handleComplete}
            />
          </li>
        )
      })}
    </ul>
  )
}

/** Card body + on-demand KP demonstration (解析页 expanded mode). */
function ReviewCardBody({
  card,
  kpNames,
  isPending,
  onComplete
}: {
  card: ReviewCard
  kpNames: Map<string, string>
  isPending: boolean
  onComplete: (cardId: string, rating: 1 | 2 | 3 | 4) => Promise<void>
}) {
  const [demoOpen, setDemoOpen] = useState(false)
  const [demos, setDemos] = useState<DemonstrationReferenceView[] | null>(null)

  const toggleDemo = async (): Promise<void> => {
    if (demoOpen) {
      setDemoOpen(false)
      return
    }
    setDemoOpen(true)
    if (demos === null) {
      try {
        setDemos(await fetchKpDemonstrations(card.kpId))
      } catch {
        setDemos([])
      }
    }
  }

  return (
    <>
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

      <button
        type="button"
        className="ghost-button review-demo-toggle"
        aria-expanded={demoOpen}
        onClick={() => void toggleDemo()}
      >
        <PlayCircle size={15} /> {demoOpen ? '收起教学演示' : '查看教学演示'}
      </button>
      {demoOpen && demos !== null && demos.length > 0 ? (
        <div className="review-demo-slot" role="region" aria-label="知识点教学演示">
          <Suspense fallback={<div className="loading-bar" />}>
            <StudentDemonstration refs={demos} expanded />
          </Suspense>
        </div>
      ) : demoOpen && demos !== null ? (
        <p className="review-demo-empty">该知识点暂无教学演示</p>
      ) : null}

      <div className="review-card-actions" role="group" aria-label="复习评分">
        {ratingOptions.map((option) => (
          <button
            key={option.rating}
            type="button"
            className={`ghost-button review-rating rating-${option.rating}`}
            disabled={isPending}
            onClick={() => void onComplete(card.id, option.rating)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </>
  )
}
