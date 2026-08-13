import { useEffect, useState } from 'react'
import { Building2, Layers } from 'lucide-react'
import type { TeachingUnit, TeachingUnitView } from '../../../shared/contracts'
import { ErrorBanner } from '../../components/Banner'
import {
  createTeachingUnit,
  getTeachingUnit,
  listTeachingUnits
} from '../../lib/api'

interface ClassSetupProps {
  /** Fired when a unit is created or selected for the rest of the workbench. */
  onSelected?: (unit: TeachingUnit) => void
  /** @deprecated use onSelected — kept for callers that only create. */
  onCreated?: (unit: TeachingUnit) => void
}

/**
 * T08 teaching-unit setup (D3: class × subject × term).
 *
 * Teachers can:
 *   1. Select an existing unit they own (incl. cold-start `tu-demo`)
 *   2. Create a new unit and declare the taught KP set (D4)
 *
 * Demo defaults match seedDemoProduct so a first-time teacher can demo without
 * inventing opaque ids.
 */
export function ClassSetup({ onSelected, onCreated }: ClassSetupProps) {
  const [classId, setClassId] = useState('class-demo')
  const [subjectId, setSubjectId] = useState('math')
  const [termId, setTermId] = useState('term-demo')
  const [taughtKpIds, setTaughtKpIds] = useState('')
  const [existing, setExisting] = useState<TeachingUnitView[]>([])
  const [error, setError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)
  const [loadingList, setLoadingList] = useState(true)

  const emit = (unit: TeachingUnit) => {
    onSelected?.(unit)
    onCreated?.(unit)
  }

  useEffect(() => {
    let cancelled = false
    setLoadingList(true)
    listTeachingUnits()
      .then((units) => {
        if (!cancelled) setExisting(units)
      })
      .catch(() => {
        // Listing is best-effort for demo; create form still works.
        if (!cancelled) setExisting([])
      })
      .finally(() => {
        if (!cancelled) setLoadingList(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const selectUnit = async (id: string) => {
    setSubmitting(true)
    setError(undefined)
    try {
      const view = await getTeachingUnit(id)
      emit(view)
    } catch (selectError: unknown) {
      setError(
        selectError instanceof Error ? selectError.message : '选择单元失败'
      )
    } finally {
      setSubmitting(false)
    }
  }

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
      emit(unit)
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

      <div className="unit-picker">
        <h4>
          <Layers size={16} style={{ verticalAlign: 'middle' }} /> 我的单元
        </h4>
        {loadingList ? (
          <p className="muted">加载已有单元…</p>
        ) : existing.length === 0 ? (
          <p className="muted">暂无单元。可一键使用演示单元，或下方新建。</p>
        ) : (
          <ul className="unit-list">
            {existing.map((unit) => (
              <li key={unit.id}>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={submitting}
                  onClick={() => void selectUnit(unit.id)}
                >
                  <code>{unit.id}</code>
                  <span className="muted">
                    {unit.className} · {unit.subjectName} · {unit.termName}
                    {unit.enrolledCount > 0
                      ? ` · ${unit.enrolledCount} 人`
                      : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          className="ghost-button"
          disabled={submitting}
          onClick={() => void selectUnit('tu-demo')}
        >
          使用演示单元 tu-demo
        </button>
      </div>

      <hr className="unit-divider" />

      <h4>新建单元</h4>
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
      <button type="button" className="primary-button" onClick={() => void submit()} disabled={submitting}>
        创建
      </button>
      {error !== undefined ? (
        <ErrorBanner>{error}</ErrorBanner>
      ) : null}
    </section>
  )
}
