import { useEffect, useState } from 'react'
import { AlertTriangle, MessageSquareText, Send } from 'lucide-react'
import type {
  CreateTeacherTipResult,
  TeacherTipSummary
} from '../../../shared/contracts'
import { createTeacherTip, listTeacherTips } from '../../lib/api'

interface TipComposerProps {
  teachingUnitId: string
}

/**
 * T14 — teacher batch tips (站内消息). Messages only; never writes score.
 */
export function TipComposer({ teachingUnitId }: TipComposerProps) {
  const [body, setBody] = useState('今晚复习二次函数顶点式，错题记得订正。')
  const [studentIds, setStudentIds] = useState('')
  const [kpIds, setKpIds] = useState('')
  const [result, setResult] = useState<CreateTeacherTipResult>()
  const [history, setHistory] = useState<TeacherTipSummary[]>([])
  const [error, setError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)
  const [loadingList, setLoadingList] = useState(true)

  const refresh = async () => {
    setLoadingList(true)
    try {
      const list = await listTeacherTips(teachingUnitId)
      setHistory(list)
      setError(undefined)
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : '提示列表加载失败')
    } finally {
      setLoadingList(false)
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teachingUnitId])

  const submit = async () => {
    setSubmitting(true)
    setError(undefined)
    try {
      const out = await createTeacherTip({
        teachingUnitId,
        body,
        studentIds:
          studentIds.trim() !== ''
            ? studentIds.split(',').map((s) => s.trim()).filter(Boolean)
            : undefined,
        kpIds:
          kpIds.trim() !== ''
            ? kpIds.split(',').map((s) => s.trim()).filter(Boolean)
            : undefined
      })
      setResult(out)
      setBody('')
      await refresh()
    } catch (submitError: unknown) {
      setError(submitError instanceof Error ? submitError.message : '发送失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="tip-composer" aria-labelledby="tip-composer-title">
      <h3 id="tip-composer-title">
        <MessageSquareText size={18} style={{ verticalAlign: 'middle' }} /> 发提示
      </h3>
      <p className="muted">
        站内消息，投递到本教学单元已报名学生。消息永不写入分数 / 证据 / 掌握度。
      </p>

      <label>
        提示正文：
        <textarea
          rows={4}
          maxLength={2000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          disabled={submitting}
          aria-label="提示正文"
        />
      </label>

      <label>
        学生 ID（逗号分隔，留空=本单元全班）：
        <input
          type="text"
          value={studentIds}
          onChange={(e) => setStudentIds(e.target.value)}
          placeholder="learner-demo"
          disabled={submitting}
        />
      </label>

      <label>
        知识点标签（可选，仅展示）：
        <input
          type="text"
          value={kpIds}
          onChange={(e) => setKpIds(e.target.value)}
          placeholder="kp-A"
          disabled={submitting}
        />
      </label>

      <button type="button" onClick={() => void submit()} disabled={submitting || body.trim() === ''}>
        <Send size={16} /> 发送提示
      </button>

      {error !== undefined ? (
        <div className="error-banner">
          <AlertTriangle size={18} /> {error}
        </div>
      ) : null}

      {result !== undefined ? (
        <div className="success-banner">
          已投递 {result.deliveryCount} 人（tip {result.tip.id}）
        </div>
      ) : null}

      <div className="tip-history">
        <h4>本单元已发提示</h4>
        {loadingList ? <p className="muted">加载中…</p> : null}
        {!loadingList && history.length === 0 ? (
          <p className="muted">还没有发送过提示。</p>
        ) : null}
        {history.length > 0 ? (
          <ul className="tip-list">
            {history.map((tip) => (
              <li key={tip.id} className="tip-row">
                <div className="tip-body">{tip.body}</div>
                <div className="muted tip-meta">
                  {tip.createdAt} · 已读 {tip.readCount}/{tip.deliveryCount}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  )
}
