import { useEffect, useState } from 'react'
import { AlertTriangle, CalendarCheck, Play } from 'lucide-react'
import type { NextPracticeItem, NextPracticePlan } from '../../../shared/contracts'
import { getNextPracticePlan } from '../../lib/api'

interface TodayPracticeProps {
  studentId: string
  teachingUnitId: string
  refreshKey: number
  /** Start a practice attempt for a bank question (may be seed:assignmentId). */
  onStartQuestion: (questionId: string) => void
  busy?: boolean
}

/**
 * T07 "今日该练" — student-facing exit of the T06 adaptive loop.
 *
 * Renders NextPracticePlan items (FSRS due ∩ dependency gaps ∩ D4 taught).
 * Empty plan is a valid cold-start state, not an error.
 */
export function TodayPractice({
  studentId,
  teachingUnitId,
  refreshKey,
  onStartQuestion,
  busy = false
}: TodayPracticeProps) {
  const [plan, setPlan] = useState<NextPracticePlan>()
  const [error, setError] = useState<string>()
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(undefined)
    getNextPracticePlan(studentId, teachingUnitId)
      .then((loaded) => {
        if (!cancelled) setPlan(loaded)
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : '今日练习加载失败'
          )
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [studentId, teachingUnitId, refreshKey])

  return (
    <section className="today-practice" aria-labelledby="today-practice-title">
      <header className="today-practice-header">
        <h3 id="today-practice-title">
          <CalendarCheck size={18} style={{ verticalAlign: 'middle' }} /> 今日该练
        </h3>
        <span className="muted">FSRS 到期 ∩ 依赖薄弱 ∩ 已教进度</span>
      </header>

      {isLoading ? <p className="muted">正在生成今日队列…</p> : null}
      {error !== undefined ? (
        <div className="error-banner">
          <AlertTriangle size={18} /> {error}
        </div>
      ) : null}

      {!isLoading && error === undefined && (plan?.items.length ?? 0) === 0 ? (
        <p className="muted">
          今日暂无推荐题。可从下方双模入口自由练，或等测评后形成薄弱点再回来。
        </p>
      ) : null}

      {plan !== undefined && plan.items.length > 0 ? (
        <ul className="today-list">
          {plan.items.map((item) => (
            <TodayItemRow
              key={item.kpId}
              item={item}
              busy={busy}
              onStartQuestion={onStartQuestion}
            />
          ))}
        </ul>
      ) : null}
    </section>
  )
}

function TodayItemRow({
  item,
  busy,
  onStartQuestion
}: {
  item: NextPracticeItem
  busy: boolean
  onStartQuestion: (questionId: string) => void
}) {
  const firstQuestion = item.questions[0]
  const sourceLabel =
    item.source === 'fsrs_due' ? '到期复习' : '薄弱补链'

  return (
    <li className="today-row">
      <div className="today-body">
        <div className="today-kp">
          <span className="subject-tag">{sourceLabel}</span>
          <strong>{item.kpId}</strong>
        </div>
        <p className="muted">{item.reason}</p>
        {firstQuestion !== undefined ? (
          <p className="today-stem muted">
            {firstQuestion.stem.slice(0, 80)}
            {firstQuestion.stem.length > 80 ? '…' : ''}
          </p>
        ) : (
          <p className="muted">该知识点暂无可用题（题库空或已近期做过）。</p>
        )}
      </div>
      {firstQuestion !== undefined ? (
        <button
          type="button"
          className="primary-button today-start"
          disabled={busy}
          onClick={() => onStartQuestion(firstQuestion.id)}
        >
          <Play size={14} aria-hidden="true" /> 开始练
        </button>
      ) : null}
    </li>
  )
}
