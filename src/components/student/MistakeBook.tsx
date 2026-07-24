import { useEffect, useState } from 'react'
import { AlertTriangle, BookOpen, CheckCircle2, RotateCcw } from 'lucide-react'
import type { MistakeBookView } from '../../../shared/contracts'
import { getMistakeBook } from '../../lib/api'

interface MistakeBookProps {
  /** Refresh trigger — parent bumps this after a re-attempt to reload. */
  refreshKey: number
  /**
   * T07 重练: open a new practice-mode attempt for this question id.
   * Only active (non-mastered) rows expose the button.
   */
  onRepractice?: (questionId: string) => void
  /** Disable repractice while a start is in flight. */
  repracticeBusy?: boolean
}

/**
 * T07 student mistake book (D1 mastery rule).
 *
 * Shows incorrectly-answered questions grouped active vs mastered. Practice
 * passes do NOT clear a mistake (D1); only consecutive assessment passes do.
 * Each active row carries a "重练" button that re-enters practice mode.
 */
export function MistakeBook({
  refreshKey,
  onRepractice,
  repracticeBusy = false
}: MistakeBookProps) {
  const [book, setBook] = useState<MistakeBookView>()
  const [error, setError] = useState<string>()
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(undefined)
    getMistakeBook()
      .then((loaded) => {
        if (!cancelled) setBook(loaded)
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : '错题本加载失败')
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  if (isLoading) return <p className="muted">加载错题本…</p>
  if (error !== undefined) {
    return (
      <div className="error-banner">
        <AlertTriangle size={18} /> {error}
      </div>
    )
  }
  if (!book || book.entries.length === 0) {
    return (
      <p className="muted">
        <BookOpen size={18} style={{ verticalAlign: 'middle' }} /> 还没有错题记录。
      </p>
    )
  }

  return (
    <section className="mistake-book" aria-labelledby="mistake-book-title">
      <header className="mistake-book-header">
        <h3 id="mistake-book-title">错题本</h3>
        <span className="muted">
          活跃 {book.activeCount} · 已掌握 {book.masteredCount}
        </span>
      </header>
      <p className="muted mistake-book-hint">
        仅连续测评态通过才移出活跃本；练习态重练可巩固，不计入正式掌握度（D1）。
      </p>
      <ul className="mistake-list">
        {book.entries.map((entry) => (
          <li
            key={entry.questionId}
            className={entry.mastered ? 'mistake-row mastered' : 'mistake-row'}
          >
            <div className="mistake-meta">
              <span className="subject-tag">{entry.subject}</span>
              {entry.mastered ? (
                <CheckCircle2 size={16} className="mastered-icon" aria-label="已掌握" />
              ) : null}
            </div>
            <div className="mistake-body">
              <div>题 {entry.questionId}</div>
              <div className="muted">
                最近得分 {entry.lastScore} · 连续测评通过{' '}
                {entry.consecutiveAssessmentPasses} 次
              </div>
            </div>
            {!entry.mastered && onRepractice !== undefined ? (
              <button
                type="button"
                className="secondary-button repractice-button"
                disabled={repracticeBusy}
                onClick={() => onRepractice(entry.questionId)}
              >
                <RotateCcw size={14} aria-hidden="true" /> 重练
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}
