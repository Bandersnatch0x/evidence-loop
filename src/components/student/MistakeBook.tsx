import { useEffect, useState } from 'react'
import { AlertTriangle, BookOpen, CheckCircle2 } from 'lucide-react'
import type { MistakeBookView } from '../../../shared/contracts'
import { getMistakeBook } from '../../lib/api'

interface MistakeBookProps {
  /** Refresh trigger — parent bumps this after a re-attempt to reload. */
  refreshKey: number
}

/**
 * T07 student mistake book (D1 mastery rule).
 *
 * Shows incorrectly-answered questions grouped active vs mastered. Practice
 * passes do NOT clear a mistake (D1); only consecutive assessment passes do.
 * Each row carries a "重练" button that re-enters practice mode.
 */
export function MistakeBook({ refreshKey }: MistakeBookProps) {
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
    <section className="mistake-book">
      <header>
        <h3>错题本</h3>
        <span className="muted">
          活跃 {book.activeCount} · 已掌握 {book.masteredCount}
        </span>
      </header>
      <ul className="mistake-list">
        {book.entries.map((entry) => (
          <li
            key={entry.questionId}
            className={entry.mastered ? 'mistake-row mastered' : 'mistake-row'}
          >
            <div className="mistake-meta">
              <span className="subject-tag">{entry.subject}</span>
              {entry.mastered ? (
                <CheckCircle2 size={16} className="mastered-icon" />
              ) : null}
            </div>
            <div className="mistake-body">
              <div>题 {entry.questionId}</div>
              <div className="muted">
                最近得分 {entry.lastScore} · 连续测评通过 {entry.consecutiveAssessmentPasses} 次
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
