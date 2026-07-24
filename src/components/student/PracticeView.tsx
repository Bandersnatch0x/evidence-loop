import { useState } from 'react'
import { AlertTriangle, BookOpen, GraduationCap, PenLine } from 'lucide-react'
import type { SessionMode } from '../../../shared/contracts'
import { startPractice } from '../../lib/api'
import { MistakeBook } from './MistakeBook'

interface PracticeViewProps {
  questionId: string
  teachingUnitId: string
  termId: string
  onAttemptStarted: (attemptId: string, mode: SessionMode) => void
}

/**
 * T07 student practice entry — the D1 dual-mode gate made visible.
 *
 * 练习态: AI 辅导全开 (GraduationCap icon, green) — mistakes feed FSRS only,
 *          never formal mastery.
 * 测评态: 独立完成 (PenLine icon, amber) — AI 关闭, evidence 进正式 MasteryProfile.
 *
 * The tutoringEnabled flag comes from the server response, not a client claim,
 * so the D1 gate cannot be bypassed by tampering with the UI state.
 */
export function PracticeView({
  questionId,
  teachingUnitId,
  termId,
  onAttemptStarted
}: PracticeViewProps) {
  const [error, setError] = useState<string>()
  const [starting, setStarting] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const begin = async (mode: SessionMode) => {
    setStarting(true)
    setError(undefined)
    try {
      const out = await startPractice({
        questionId,
        teachingUnitId,
        termId,
        mode
      })
      onAttemptStarted(out.attemptId, out.mode)
      setRefreshKey((k) => k + 1)
    } catch (startError: unknown) {
      setError(startError instanceof Error ? startError.message : '无法开始练习')
    } finally {
      setStarting(false)
    }
  }

  return (
    <section className="practice-view">
      <h3>开始练习</h3>
      <p className="muted">
        选择模式：练习态开启 AI 辅导（不计入正式掌握度），测评态独立完成（计入正式掌握度）。
      </p>

      <div className="mode-cards">
        <button
          type="button"
          className="mode-card practice"
          disabled={starting}
          onClick={() => void begin('practice')}
        >
          <GraduationCap size={24} />
          <strong>练习态 · 辅导开启</strong>
          <span className="muted">讲解 / 苏格拉底 / 追问</span>
        </button>
        <button
          type="button"
          className="mode-card assessment"
          disabled={starting}
          onClick={() => void begin('assessment')}
        >
          <PenLine size={24} />
          <strong>测评态 · 独立完成</strong>
          <span className="muted">AI 关闭，裸做</span>
        </button>
      </div>

      {error !== undefined ? (
        <div className="error-banner">
          <AlertTriangle size={18} /> {error}
        </div>
      ) : null}

      <hr />
      <div className="mistake-section">
        <h4>
          <BookOpen size={18} style={{ verticalAlign: 'middle' }} /> 我的错题本
        </h4>
        <MistakeBook refreshKey={refreshKey} />
      </div>
    </section>
  )
}
