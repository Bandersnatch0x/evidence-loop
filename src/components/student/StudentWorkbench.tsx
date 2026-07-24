import { useEffect, useState } from 'react'
import { AlertTriangle, GraduationCap, ListChecks } from 'lucide-react'
import type { PracticeSession, SessionMode } from '../../../shared/contracts'
import { listPracticeSessions } from '../../lib/api'
import { MistakeBook } from './MistakeBook'
import { PracticeView } from './PracticeView'

interface StudentWorkbenchProps {
  /** Current assignment id used as the question for free practice. */
  questionId?: string
  teachingUnitId?: string
  termId?: string
  /**
   * Called when the student opens a new practice/assessment attempt.
   * Parent should store attemptId and route to the workspace for submission.
   */
  onAttemptStarted?: (attemptId: string, mode: SessionMode) => void
}

/**
 * T07 student workbench — the student-side landing that ties the mistake book
 * to the practice-session history and the D1 dual-mode starter.
 */
export function StudentWorkbench({
  questionId,
  teachingUnitId = 'tu-demo',
  termId = 'term-demo',
  onAttemptStarted
}: StudentWorkbenchProps) {
  const [sessions, setSessions] = useState<PracticeSession[]>([])
  const [error, setError] = useState<string>()
  const [isLoading, setIsLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(undefined)
    listPracticeSessions()
      .then((loaded) => {
        if (!cancelled) setSessions(loaded)
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : '练习记录加载失败')
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  return (
    <div className="student-workbench">
      <header className="workbench-header">
        <h2>
          <GraduationCap size={22} style={{ verticalAlign: 'middle' }} /> 我的练习
        </h2>
        <p className="muted">
          练习态开启 AI 辅导（不计入正式掌握度）；测评态独立完成（计入正式掌握度）。
        </p>
      </header>

      {questionId !== undefined ? (
        <>
          <PracticeView
            questionId={questionId}
            teachingUnitId={teachingUnitId}
            termId={termId}
            onAttemptStarted={(attemptId, mode) => {
              setRefreshKey((k) => k + 1)
              onAttemptStarted?.(attemptId, mode)
            }}
          />
          <hr />
        </>
      ) : null}

      <section className="session-history">
        <h3>
          <ListChecks size={18} style={{ verticalAlign: 'middle' }} /> 练习场次
        </h3>
        {isLoading ? <p className="muted">加载中…</p> : null}
        {error !== undefined ? (
          <div className="error-banner">
            <AlertTriangle size={18} /> {error}
          </div>
        ) : null}
        {!isLoading && error === undefined && sessions.length === 0 ? (
          <p className="muted">还没有练习记录，去工作台开始第一题吧。</p>
        ) : null}
        {sessions.length > 0 ? (
          <ul className="session-list">
            {sessions.map((session) => (
              <li key={session.id} className="session-row">
                <span
                  className={
                    session.mode === 'practice'
                      ? 'mode-badge practice'
                      : 'mode-badge assessment'
                  }
                >
                  {session.mode === 'practice' ? '练习态' : '测评态'}
                </span>
                <span className="session-shape">
                  {session.shape === 'paper' ? '成套' : '单题'}（
                  {session.attemptIds.length} 题）
                </span>
                <span className="muted session-time">{session.lastActiveAt}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <hr />

      <MistakeBook refreshKey={refreshKey} />
    </div>
  )
}
