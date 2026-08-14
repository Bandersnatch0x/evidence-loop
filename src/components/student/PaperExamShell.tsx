import { useEffect, useMemo, useState } from 'react'
import { Clock3, FileStack, Flag } from 'lucide-react'
import type { PracticeSession } from '../../../shared/contracts'
import { submitPaperExam } from '../mockExam/mockExamApi'

interface PaperExamShellProps {
  session: PracticeSession
}

type ShellStatus = 'running' | 'submitted' | 'expired'

type SubmitState =
  | { phase: 'idle' }
  | { phase: 'submitting' }
  | { phase: 'done'; answeredCount: number; totalQuestions: number; unanswered: number }
  | { phase: 'error'; message: string }

const STORAGE_PREFIX = 'evidenceloop.paper-exam-submitted.'

/** Demo default: 3 minutes per item, clamped to 5–30 minutes. */
function durationMsFor(session: PracticeSession): number {
  const minutes = Math.min(30, Math.max(5, session.attemptIds.length * 3))
  return minutes * 60_000
}

function storageKey(sessionId: string): string {
  return `${STORAGE_PREFIX}${sessionId}`
}

function readSubmitted(sessionId: string): boolean {
  try {
    return window.localStorage.getItem(storageKey(sessionId)) === '1'
  } catch {
    return false
  }
}

function writeSubmitted(sessionId: string): void {
  try {
    window.localStorage.setItem(storageKey(sessionId), '1')
  } catch {
    // Demo shell: storage may be unavailable; in-memory state still works.
  }
}

function formatRemaining(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/**
 * T07 ceremonial shell for paper (成套) sessions — countdown + unified 交卷.
 * UI-only: does not mutate score / evidence / mastery. Attempt scoring stays
 * on the existing per-question evaluate path.
 */
export function PaperExamShell({ session }: PaperExamShellProps) {
  const durationMs = useMemo(() => durationMsFor(session), [session])
  const endsAt = useMemo(() => {
    const started = Date.parse(session.startedAt)
    const base = Number.isFinite(started) ? started : Date.now()
    return base + durationMs
  }, [session.startedAt, durationMs])

  const [now, setNow] = useState(() => Date.now())
  const [submitted, setSubmitted] = useState(() => readSubmitted(session.id))
  const [submitState, setSubmitState] = useState<SubmitState>({ phase: 'idle' })

  useEffect(() => {
    setSubmitted(readSubmitted(session.id))
  }, [session.id])

  useEffect(() => {
    if (submitted) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [submitted])

  const remainingMs = endsAt - now
  const status: ShellStatus = submitted
    ? 'submitted'
    : remainingMs <= 0
      ? 'expired'
      : 'running'

  const submitPaper = async () => {
    if (submitState.phase === 'submitting' || !session.paperId) return
    setSubmitState({ phase: 'submitting' })
    try {
      const result = await submitPaperExam(session.paperId)
      writeSubmitted(session.id)
      setSubmitted(true)
      setSubmitState({
        phase: 'done',
        answeredCount: result.answeredCount,
        totalQuestions: result.totalQuestions,
        unanswered: result.unansweredQuestionIds.length
      })
    } catch (submitError: unknown) {
      setSubmitState({
        phase: 'error',
        message:
          submitError instanceof Error ? submitError.message : '交卷失败'
      })
    }
  }

  const statusLabel =
    status === 'submitted' ? '已交卷' : status === 'expired' ? '时间到' : '答题中'

  return (
    <div
      className={`paper-exam-shell status-${status}`}
      data-session-id={session.id}
      data-paper-id={session.paperId ?? ''}
    >
      <div className="paper-exam-shell-main">
        <span className="paper-exam-icon" aria-hidden>
          <FileStack size={16} />
        </span>
        <div className="paper-exam-copy">
          <div className="paper-exam-title">
            成套{session.mode === 'assessment' ? '测评' : '练习'}
            {session.paperId !== undefined ? (
              <span className="muted"> · {session.paperId}</span>
            ) : null}
          </div>
          <div className="muted paper-exam-meta">
            {session.attemptIds.length} 题 · 开始于 {session.startedAt}
          </div>
        </div>
        <div className="paper-exam-timer" aria-live="polite">
          <Clock3 size={14} />{' '}
          {status === 'running' ? formatRemaining(remainingMs) : statusLabel}
        </div>
      </div>
      <div className="paper-exam-actions">
        <span className={`paper-exam-status-badge ${status}`}>{statusLabel}</span>
        {status === 'running' ? (
          <button
            type="button"
            className="primary-button"
            onClick={() => void submitPaper()}
            disabled={submitState.phase === 'submitting'}
          >
            <Flag size={14} />{' '}
            {submitState.phase === 'submitting' ? '交卷中…' : '交卷'}
          </button>
        ) : null}
        {status === 'expired' && !submitted ? (
          <button
            type="button"
            className="primary-button"
            onClick={() => void submitPaper()}
            disabled={submitState.phase === 'submitting'}
          >
            <Flag size={14} />
            {submitState.phase === 'submitting' ? '交卷中…' : '确认交卷'}
          </button>
        ) : null}
        {status === 'submitted' ? (
          <span className="muted paper-exam-note">
            {submitState.phase === 'done' ? (
              <>
                已交卷：{submitState.answeredCount}/{submitState.totalQuestions} 题已评分
                {submitState.unanswered > 0
                  ? `，${submitState.unanswered} 题未答`
                  : ''}
                。分数以各题 Attempt 评价为准。
              </>
            ) : (
              <>已交卷；分数以各题 Attempt 评价为准。</>
            )}
          </span>
        ) : null}
        {submitState.phase === 'error' ? (
          <span className="paper-exam-error" role="alert">
            交卷失败：{submitState.message}
          </span>
        ) : null}
      </div>
    </div>
  )
}
