import { useEffect, useState } from 'react'
import { AlertTriangle, GraduationCap, ListChecks } from 'lucide-react'
import type { PracticeSession, SessionMode } from '../../../shared/contracts'
import { listPracticeSessions } from '../../lib/api'
import { MistakeBook } from './MistakeBook'
import { TeacherTipsInbox } from './TeacherTipsInbox'
import { PracticeView } from './PracticeView'
import { TodayPractice } from './TodayPractice'

interface StudentWorkbenchProps {
  /** Current assignment id used as the question for free practice. */
  questionId?: string
  teachingUnitId?: string
  termId?: string
  studentId?: string
  /**
   * Called when the student opens a new practice/assessment attempt.
   * Parent should store attemptId and route to the workspace for submission.
   */
  onAttemptStarted?: (attemptId: string, mode: SessionMode, questionId: string) => void
  /** Parent-driven start for a bank question (今日该练 / 错题重练). */
  onStartQuestion?: (questionId: string, mode: SessionMode) => Promise<void> | void
}

/**
 * T07 student workbench — landing that ties 今日该练, dual-mode free practice,
 * session history, and the mistake book into one student surface.
 */
export function StudentWorkbench({
  questionId,
  teachingUnitId = 'tu-demo',
  termId = 'term-demo',
  studentId = 'learner-demo',
  onAttemptStarted,
  onStartQuestion
}: StudentWorkbenchProps) {
  const [sessions, setSessions] = useState<PracticeSession[]>([])
  const [error, setError] = useState<string>()
  const [isLoading, setIsLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string>()

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

  const startQuestion = async (qid: string, mode: SessionMode = 'practice') => {
    if (onStartQuestion === undefined) return
    setBusy(true)
    setActionError(undefined)
    try {
      await onStartQuestion(qid, mode)
      setRefreshKey((k) => k + 1)
    } catch (startError: unknown) {
      setActionError(
        startError instanceof Error ? startError.message : '无法开始该题'
      )
    } finally {
      setBusy(false)
    }
  }

  const handleRepractice = (qid: string) => {
    void startQuestion(qid, 'practice')
  }

  return (
    <div className="student-workbench">
      <header className="workbench-header">
        <h2>
          <GraduationCap size={22} style={{ verticalAlign: 'middle' }} /> 我的练习
        </h2>
        <p className="muted">
          练习态开启 AI 辅导（不计入正式掌握度）；测评态独立完成（计入正式掌握度）。
          不会做时先点「求助」，不要直接看答案。
        </p>
      </header>

      {actionError !== undefined ? (
        <div className="error-banner">
          <AlertTriangle size={18} /> {actionError}
        </div>
      ) : null}

      <TeacherTipsInbox refreshKey={refreshKey} />

      <hr />

      <TodayPractice
        studentId={studentId}
        teachingUnitId={teachingUnitId}
        refreshKey={refreshKey}
        busy={busy}
        onStartQuestion={(qid) => {
          void startQuestion(qid, 'practice')
        }}
      />

      <hr />

      {questionId !== undefined ? (
        <>
          <PracticeView
            questionId={questionId}
            teachingUnitId={teachingUnitId}
            termId={termId}
            onAttemptStarted={(attemptId, mode) => {
              setRefreshKey((k) => k + 1)
              onAttemptStarted?.(attemptId, mode, questionId)
            }}
          />
          <hr />
        </>
      ) : null}

      <section className="session-history" aria-labelledby="session-history-title">
        <h3 id="session-history-title">
          <ListChecks size={18} style={{ verticalAlign: 'middle' }} /> 练习场次
        </h3>
        {isLoading ? <p className="muted">加载中…</p> : null}
        {error !== undefined ? (
          <div className="error-banner">
            <AlertTriangle size={18} /> {error}
          </div>
        ) : null}
        {!isLoading && error === undefined && sessions.length === 0 ? (
          <p className="muted">还没有练习记录，从「今日该练」或双模入口开始第一题吧。</p>
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

      <MistakeBook
        refreshKey={refreshKey}
        repracticeBusy={busy}
        onRepractice={handleRepractice}
      />
    </div>
  )
}
