import { useState } from 'react'
import { AlertTriangle, Send } from 'lucide-react'
import type {
  AssignmentKind,
  CreateAssignmentResult,
  SessionMode
} from '../../../shared/contracts'
import { createAssignment } from '../../lib/api'

interface AssignmentComposerProps {
  teachingUnitId: string
}

/**
 * T08 assignment composer — three shapes (T08):
 *   handpick / assemble_by_kp / by_weakness
 *
 * The "by_weakness" path delegates to the T06 engine (aggregate class weak
 * KPs). All shapes produce paper-batched placeholder attempts that the T07
 * session derivation groups into one paper session.
 */
export function AssignmentComposer({ teachingUnitId }: AssignmentComposerProps) {
  const [kind, setKind] = useState<AssignmentKind>('handpick')
  const [mode, setMode] = useState<SessionMode>('assessment')
  const [questionIds, setQuestionIds] = useState('')
  const [kpIds, setKpIds] = useState('')
  const [studentIds, setStudentIds] = useState('')
  /** datetime-local value (no timezone); empty = no deadline. */
  const [dueLocal, setDueLocal] = useState('')
  const [result, setResult] = useState<CreateAssignmentResult>()
  const [error, setError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    setSubmitting(true)
    setError(undefined)
    try {
      const dueAt =
        dueLocal.trim() !== ''
          ? new Date(dueLocal).toISOString()
          : undefined
      const out = await createAssignment({
        teachingUnitId,
        mode,
        kind,
        questionIds:
          kind === 'handpick'
            ? questionIds.split(',').map((s) => s.trim()).filter(Boolean)
            : undefined,
        kpIds:
          kind === 'assemble_by_kp'
            ? kpIds.split(',').map((s) => s.trim()).filter(Boolean)
            : kind === 'by_weakness'
              ? kpIds.split(',').map((s) => s.trim()).filter(Boolean)
              : undefined,
        studentIds:
          studentIds.trim() !== ''
            ? studentIds.split(',').map((s) => s.trim()).filter(Boolean)
            : undefined,
        dueAt
      })
      setResult(out)
    } catch (submitError: unknown) {
      setError(submitError instanceof Error ? submitError.message : '布置失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="assignment-composer">
      <h3>布置作业</h3>

      <div className="form-row">
        <label>
          类型：
          <select aria-label="布置类型" value={kind} onChange={(e) => setKind(e.target.value as AssignmentKind)}>
            <option value="handpick">手选题</option>
            <option value="assemble_by_kp">按知识点组卷</option>
            <option value="by_weakness">按全班薄弱点</option>
          </select>
        </label>
        <label>
          模式：
          <select aria-label="练习模式" value={mode} onChange={(e) => setMode(e.target.value as SessionMode)}>
            <option value="practice">练习态</option>
            <option value="assessment">测评态</option>
          </select>
        </label>
      </div>

      {kind === 'handpick' ? (
        <label>
          题目 ID（逗号分隔，可用 seed:… 预置题或私有题）：
          <input
            type="text"
            value={questionIds}
            onChange={(e) => setQuestionIds(e.target.value)}
            placeholder="seed:essay-perseverance-growth, seed:math-..."
          />
        </label>
      ) : null}

      {kind === 'assemble_by_kp' || kind === 'by_weakness' ? (
        <label>
          知识点 ID（逗号分隔{kind === 'by_weakness' ? '，留空则聚合全班' : ''}）：
          <input
            type="text"
            value={kpIds}
            onChange={(e) => setKpIds(e.target.value)}
            placeholder="kp-A, kp-B"
          />
        </label>
      ) : null}

      {kind !== 'by_weakness' ? (
        <label>
          学生 ID（逗号分隔，留空=本单元全班）：
          <input
            type="text"
            value={studentIds}
            onChange={(e) => setStudentIds(e.target.value)}
            placeholder="learner-demo, student-a"
          />
        </label>
      ) : null}

      <label>
        截止时间（可选）：
        <input
          type="datetime-local"
          value={dueLocal}
          onChange={(e) => setDueLocal(e.target.value)}
          disabled={submitting}
        />
      </label>

      <button type="button" onClick={() => void submit()} disabled={submitting}>
        <Send size={16} /> 布置
      </button>

      {error !== undefined ? (
        <div className="error-banner" role="alert">
          <AlertTriangle size={18} /> {error}
        </div>
      ) : null}

      {result !== undefined ? (
        <div className="success-banner" role="status">
          已布置 {result.attemptIds.length} 个占位尝试（paper {result.paperId}
          {result.dueAt !== undefined ? ` · 截止 ${result.dueAt}` : ''}）
        </div>
      ) : null}
    </section>
  )
}
