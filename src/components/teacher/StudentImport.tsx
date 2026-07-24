import { useState } from 'react'
import { AlertTriangle, Upload } from 'lucide-react'
import type { ImportRosterResult } from '../../../shared/contracts'
import { importRoster } from '../../lib/api'

interface StudentImportProps {
  teachingUnitId: string
}

/**
 * T08 student roster import (T02 activation-code flow).
 *
 * Teacher pastes a name+studentNumber roster → backend creates Student Users
 * + activation codes + binds Enrollments scoped to the owned TeachingUnit.
 * The returned manifest is shown for offline distribution. Demo compliance:
 * test roster data only, never real 学籍 (守 CONTEXT 边界).
 */
export function StudentImport({ teachingUnitId }: StudentImportProps) {
  const [roster, setRoster] = useState('2026001,张三\n2026002,李四')
  const [result, setResult] = useState<ImportRosterResult>()
  const [error, setError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    const rows = roster
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [studentNumber, ...rest] = line.split(',').map((s) => s.trim())
        const fallbackName = studentNumber ?? ''
        return {
          studentNumber: fallbackName,
          displayName: rest.join(',').trim() || fallbackName
        }
      })
      .filter((r) => r.studentNumber !== '')

    if (rows.length === 0) {
      setError('至少需要一行名单')
      return
    }
    setSubmitting(true)
    setError(undefined)
    try {
      const out = await importRoster(teachingUnitId, rows)
      setResult(out)
    } catch (submitError: unknown) {
      setError(submitError instanceof Error ? submitError.message : '导入失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="student-import">
      <h3>导入学生名单</h3>
      <p className="muted">每行：学号,姓名（逗号分隔）</p>
      <textarea
        rows={6}
        value={roster}
        onChange={(e) => setRoster(e.target.value)}
        disabled={submitting}
      />
      <button type="button" onClick={() => void submit()} disabled={submitting}>
        <Upload size={16} /> 导入并生成激活码
      </button>

      {error !== undefined ? (
        <div className="error-banner">
          <AlertTriangle size={18} /> {error}
        </div>
      ) : null}

      {result !== undefined ? (
        <div className="activation-manifest">
          <h4>激活码清单（线下分发）</h4>
          <table>
            <thead>
              <tr>
                <th>学号</th>
                <th>姓名</th>
                <th>激活码</th>
              </tr>
            </thead>
            <tbody>
              {result.imported.map((s) => (
                <tr key={s.userId}>
                  <td>{s.loginId}</td>
                  <td>{s.displayName}</td>
                  <td>
                    <code>{s.activationCode}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  )
}
