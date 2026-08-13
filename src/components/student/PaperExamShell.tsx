import { useEffect, useMemo, useState } from 'react'
import { Clock3, FileStack, Flag } from 'lucide-react'
import type { PracticeSession } from '../../../shared/contracts'

interface PaperExamShellProps {
  session: PracticeSession
}

type ShellStatus = 'running' | 'submitted' | 'expired'

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

  const submitPaper = () => {
    writeSubmitted(session.id)
    setSubmitted(true)
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
          <button type="button" className="primary-button" onClick={submitPaper}>
            <Flag size={14} /> 交卷
          </button>
        ) : null}
        {status === 'expired' && !submitted ? (
          <button type="button" className="primary-button" onClick={submitPaper}>
            <Flag size={14} /> 确认交卷
          </button>
        ) : null}
        {status === 'submitted' ? (
          <span className="muted paper-exam-note">
            仪式交卷完成；各题分数仍以 Attempt 评价为准（不计分写回）。
          </span>
        ) : null}
      </div>
    </div>
  )
}
