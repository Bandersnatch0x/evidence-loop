import { useState } from 'react'
import { AlertTriangle, Building2 } from 'lucide-react'
import type { TeachingUnit } from '../../../shared/contracts'
import { createTeachingUnit } from '../../lib/api'

interface ClassSetupProps {
  onCreated?: (unit: TeachingUnit) => void
}

/**
 * T08 teaching-unit setup (D3: class × subject × term).
 *
 * The teacher picks an existing class + subject + term and declares the taught
 * KP set (D4 — un-taught KPs never alarm). The taughtKpIds carry the D4
 * boundary that the T06 loop intersects when surfacing weaknesses.
 */
export function ClassSetup({ onCreated }: ClassSetupProps) {
  const [classId, setClassId] = useState('')
  const [subjectId, setSubjectId] = useState('')
  const [termId, setTermId] = useState('')
  const [taughtKpIds, setTaughtKpIds] = useState('')
  const [error, setError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    if (classId.trim() === '' || subjectId.trim() === '' || termId.trim() === '') {
      setError('班级、学科、学期均必填')
      return
    }
    setSubmitting(true)
    setError(undefined)
    try {
      const unit = await createTeachingUnit({
        classId: classId.trim(),
        subjectId: subjectId.trim(),
        termId: termId.trim(),
        taughtKpIds: taughtKpIds
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      })
      onCreated?.(unit)
    } catch (submitError: unknown) {
      setError(submitError instanceof Error ? submitError.message : '建班失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="class-setup">
      <h3>
        <Building2 size={18} style={{ verticalAlign: 'middle' }} /> 建教学单元
      </h3>
      <p className="muted">教学单元 = 班级 × 学科 × 学期（D3）</p>
      <label>
        班级 ID：
        <input
          type="text"
          value={classId}
          onChange={(e) => setClassId(e.target.value)}
          disabled={submitting}
        />
      </label>
      <label>
        学科 ID：
        <input
          type="text"
          value={subjectId}
          onChange={(e) => setSubjectId(e.target.value)}
          disabled={submitting}
        />
      </label>
      <label>
        学期 ID：
        <input
          type="text"
          value={termId}
          onChange={(e) => setTermId(e.target.value)}
          disabled={submitting}
        />
      </label>
      <label>
        已教知识点（逗号分隔，D4）：
        <input
          type="text"
          value={taughtKpIds}
          onChange={(e) => setTaughtKpIds(e.target.value)}
          placeholder="kp-A, kp-B"
          disabled={submitting}
        />
      </label>
      <button type="button" onClick={() => void submit()} disabled={submitting}>
        创建
      </button>
      {error !== undefined ? (
        <div className="error-banner">
          <AlertTriangle size={18} /> {error}
        </div>
      ) : null}
    </section>
  )
}
