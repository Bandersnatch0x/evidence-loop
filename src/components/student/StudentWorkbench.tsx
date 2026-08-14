import { useEffect, useState } from 'react'
import { GraduationCap, ListChecks } from 'lucide-react'
import type { PracticeSession, SessionMode } from '../../../shared/contracts'
import { listPracticeSessions } from '../../lib/api'
import { MistakeBook } from './MistakeBook'
import { PaperExamShell } from './PaperExamShell'
import { TeacherTipsInbox } from './TeacherTipsInbox'
import { PracticeView } from './PracticeView'
import { TodayPractice } from './TodayPractice'
import { ErrorBanner } from '../../components/Banner'

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

  const paperSessions = sessions.filter((s) => s.shape === 'paper')

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
        <ErrorBanner>{actionError}</ErrorBanner>
      ) : null}

      <TeacherTipsInbox
        refreshKey={refreshKey}
        onStartQuestion={(qid, mode) => {
          void startQuestion(qid, mode)
        }}
      />

      <hr />

      <TodayPractice
        studentId={studentId}
        teachingUnitId={teachingUnitId}
        refreshKey={refreshKey}
        busy={busy}
        onStartQuestion={(qid, mode) => {
          void startQuestion(qid, mode)
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

      {paperSessions.length > 0 ? (
        <section className="paper-exam-section" aria-labelledby="paper-exam-title">
          <h3 id="paper-exam-title">
            <ListChecks size={18} style={{ verticalAlign: 'middle' }} /> 成套测评
          </h3>
          <p className="muted">
            倒计时为仪式壳；交卷由服务端确认（仍不改写分数 / 证据 / 掌握度），各题按 Attempt 评价。
          </p>
          <div className="paper-exam-list">
            {paperSessions.map((session) => (
              <PaperExamShell key={session.id} session={session} />
            ))}
          </div>
          <hr />
        </section>
      ) : null}

      <section className="session-history" aria-labelledby="session-history-title">
        <h3 id="session-history-title">
          <ListChecks size={18} style={{ verticalAlign: 'middle' }} /> 练习场次
        </h3>
        {isLoading ? <p className="muted">加载中…</p> : null}
        {error !== undefined ? (
          <ErrorBanner>{error}</ErrorBanner>
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
