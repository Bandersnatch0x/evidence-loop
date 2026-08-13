import { Mic, Clock3 } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  getMultimodalUsage,
  type MultimodalUsageRow
} from '../lib/api'

interface CohortMultimodalUsageProps {
  /** Demo cohort / class identifier (required by the API). */
  classId: string
}

function formatWhen(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(value))
}

/**
 * Teacher-only panel: voice tutoring usage counts per student.
 * Deliberately omits transcripts, audio, and any free-text content (ADR-0005 §7).
 */
export function CohortMultimodalUsage({ classId }: CohortMultimodalUsageProps) {
  const [rows, setRows] = useState<MultimodalUsageRow[] | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(undefined)

    void getMultimodalUsage(classId)
      .then((data) => {
        if (!cancelled) {
          setRows(data)
          setLoading(false)
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : '无法加载语音辅导使用统计'
          )
          setRows([])
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [classId])

  return (
    <section className="cohort-multimodal-usage" aria-label="语音辅导使用统计">
      <header>
        <div>
          <h2>
            <Mic size={18} aria-hidden="true" />
            语音辅导使用次数
          </h2>
          <p>
            仅展示次数与最近使用时间，不展示转写或对话内容。
          </p>
        </div>
        <span className="cohort-multimodal-badge">合规 · 元数据</span>
      </header>

      {loading ? (
        <div className="view-loading" role="status" aria-live="polite">
          <span className="loading-bar" />
          正在汇总语音使用…
        </div>
      ) : error !== undefined ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : rows === undefined || rows.length === 0 ? (
        <p className="cohort-multimodal-empty">
          本班暂无语音辅导记录。学生开启多模态后，次数会在此汇总。
        </p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>学员 ID</th>
                <th>语音次数</th>
                <th>最近使用</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.studentId}>
                  <td>
                    <strong>{row.studentId}</strong>
                  </td>
                  <td>
                    <b>{row.voiceCount}</b>
                  </td>
                  <td>
                    <span className="cohort-multimodal-when">
                      <Clock3 size={14} aria-hidden="true" />
                      {formatWhen(row.lastVoiceAt)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
