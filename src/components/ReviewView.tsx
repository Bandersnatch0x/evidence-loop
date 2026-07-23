import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CalendarClock } from 'lucide-react'
import type { KnowledgePoint, ReviewCard } from '../../shared/contracts'
import { completeReview, listDueReviews } from '../lib/api'
import { buildKpNameMap } from '../lib/masteryView'
import { TodayReviewList } from './TodayReviewList'

interface ReviewViewProps {
  studentId: string
  points: KnowledgePoint[]
}

/**
 * Student "今日复习" page (ADR-0007 §5).
 *
 * Loads FSRS-due cards from GET /api/review/next and reschedules a card on
 * completion via POST /api/review/:cardId/complete.
 */
export function ReviewView({ studentId, points }: ReviewViewProps) {
  const [cards, setCards] = useState<ReviewCard[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string>()

  const kpNames = useMemo(() => buildKpNameMap(points), [points])

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(undefined)
    listDueReviews(studentId)
      .then((loaded) => {
        if (!cancelled) setCards(loaded)
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : '复习队列加载失败')
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [studentId])

  const handleComplete = async (cardId: string, rating: 1 | 2 | 3 | 4) => {
    try {
      await completeReview(cardId, rating)
      setCards((current) => current.filter((card) => card.id !== cardId))
    } catch (completeError) {
      setError(
        completeError instanceof Error
          ? completeError.message
          : '复习完成未能保存，请重试'
      )
    }
  }

  if (isLoading) {
    return (
      <div className="view-loading"><span className="loading-bar" />正在读取复习队列...</div>
    )
  }

  return (
    <div className="page-view review-view">
      <header className="page-heading">
        <div>
          <h1>今日复习</h1>
          <p>FSRS 依据掌握度证据安排复习节奏 · 完成后自动重新排期</p>
        </div>
        <div className="updated-at"><CalendarClock size={15} />{cards.length} 张到期卡片</div>
      </header>

      {error && (
        <div className="inline-error" role="alert">
          <AlertTriangle size={16} />{error}
        </div>
      )}

      <section className="review-section" aria-label="复习卡片">
        <TodayReviewList
          cards={cards}
          kpNames={kpNames}
          onComplete={handleComplete}
        />
      </section>
    </div>
  )
}
