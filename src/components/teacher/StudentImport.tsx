import { useState } from 'react'
import { AlertTriangle, Download, Upload } from 'lucide-react'
import type { ImportRosterResult } from '../../../shared/contracts'
import { importRoster } from '../../lib/api'
import { downloadCsv } from '../../lib/downloadCsv'

interface StudentImportProps {
  teachingUnitId: string
}

/**
 * T08 student roster import (T02 activation-code flow).
 *
 * Teacher pastes a name+studentNumber roster or uploads a CSV → backend creates
 * Student Users + activation codes + binds Enrollments. Demo: test roster only.
 */
export function StudentImport({ teachingUnitId }: StudentImportProps) {
  const [roster, setRoster] = useState('2026001,张三\n2026002,李四')
  const [result, setResult] = useState<ImportRosterResult>()
  const [error, setError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)

  const onCsvFile = async (file: File | undefined) => {
    if (file === undefined) return
    try {
      const text = await file.text()
      // Strip BOM; keep raw lines for the existing paste parser.
      setRoster(text.replace(/^\uFEFF/, '').trimEnd())
      setError(undefined)
    } catch {
      setError('读取 CSV 失败')
    }
  }

  const submit = async () => {
    const rows = roster
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        // Support comma or tab separators (Excel CSV / TSV).
        const parts = line.includes('\t')
          ? line.split('\t').map((s) => s.trim())
          : line.split(',').map((s) => s.trim())
        const studentNumber = parts[0] ?? ''
        const displayName = parts.slice(1).join(',').trim() || studentNumber
        return { studentNumber, displayName }
      })
      .filter((r) => r.studentNumber !== '' && !isHeaderRow(r.studentNumber))

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
      <p className="muted">每行：学号,姓名（逗号或制表符分隔）</p>
      <label className="csv-upload">
        上传 CSV：
        <input
          type="file"
          accept=".csv,text/csv,text/plain"
          disabled={submitting}
          onChange={(e) => void onCsvFile(e.target.files?.[0])}
          aria-label="上传名单 CSV"
        />
      </label>
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
        <div className="error-banner" role="alert">
          <AlertTriangle size={18} /> {error}
        </div>
      ) : null}

      {result !== undefined ? (
        <div className="activation-manifest">
          <div className="activation-manifest-header">
            <h4>激活码清单（线下分发）</h4>
            <button
              type="button"
              className="export-csv-btn"
              onClick={() =>
                downloadCsv(
                  `activation-codes-${teachingUnitId}.csv`,
                  ['loginId', 'displayName', 'activationCode', 'userId'],
                  result.imported.map((s) => [
                    s.loginId,
                    s.displayName,
                    s.activationCode,
                    s.userId
                  ])
                )
              }
            >
              <Download size={14} /> 导出激活码 CSV
            </button>
          </div>
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

function isHeaderRow(firstCell: string): boolean {
  const lower = firstCell.toLowerCase()
  return (
    lower === '学号' ||
    lower === 'studentnumber' ||
    lower === 'student_number' ||
    lower === 'id'
  )
}
