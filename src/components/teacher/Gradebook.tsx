import { useEffect, useState } from 'react'
import { AlertTriangle, ClipboardList, ShieldAlert } from 'lucide-react'
import type { GradingQueueItem } from '../../../shared/contracts'
import { getGradingQueue, gradeSubjective } from '../../lib/api'

interface GradebookProps {
  teachingUnitId: string
}

/**
 * T08 teacher Gradebook — the subjective final-adjudication UI the AdvisoryLayer
 * was missing (T08 补充刚需2 / 铁律闭环).
 *
 * Three deliberately separated layers per item (ADR-0006 §3):
 *   1. Objective evidence (字数/结构/语法) — reproducible, already in score.
 *   2. AI advisory suggestions (立意/论证) — grey "AI 推断" badge, NEVER scored.
 *   3. Teacher final adjudication — written as teacher_annotation provenance,
 *      NEVER folded into result.score.
 *
 * No batch grading control exists here by design — each item is graded
 * one-at-a-time (守铁律: 主观题不可批量给分).
 */
export function Gradebook({ teachingUnitId }: GradebookProps) {
  const [queue, setQueue] = useState<GradingQueueItem[]>([])
  const [error, setError] = useState<string>()
  const [isLoading, setIsLoading] = useState(true)
  const [gradedId, setGradedId] = useState<string>()

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(undefined)
    getGradingQueue(teachingUnitId)
      .then((loaded) => {
        if (!cancelled) setQueue(loaded)
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : '批改队列加载失败')
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [teachingUnitId])

  if (isLoading) return <p className="muted">加载批改队列…</p>
  if (error !== undefined) {
    return (
      <div className="error-banner">
        <AlertTriangle size={18} /> {error}
      </div>
    )
  }
  if (queue.length === 0) {
    return (
      <p className="muted">
        <ClipboardList size={18} style={{ verticalAlign: 'middle' }} /> 队列为空，没有待批改的主观题。
      </p>
    )
  }

  return (
    <section className="gradebook">
      <header>
        <h3>主观题批改</h3>
        <span className="muted">待批 {queue.length} 份</span>
      </header>
      <ul className="grading-list">
        {queue.map((item) => (
          <GradingRow
            key={item.attemptId}
            item={item}
            onGraded={(id) => setGradedId(id)}
          />
        ))}
      </ul>
      {gradedId !== undefined ? (
        <p className="muted">已批 {gradedId}（重新加载查看更新）</p>
      ) : null}
    </section>
  )
}

interface GradingRowProps {
  item: GradingQueueItem
  onGraded: (attemptId: string) => void
}

function GradingRow({ item, onGraded }: GradingRowProps) {
  const [score, setScore] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    const subjectiveScore = Number(score)
    if (!Number.isFinite(subjectiveScore) || subjectiveScore < 0) {
      setError('请输入有效分数')
      return
    }
    if (note.trim() === '') {
      setError('请填写批改说明')
      return
    }
    setSubmitting(true)
    setError(undefined)
    try {
      await gradeSubjective(item.attemptId, {
        subjectiveScore,
        subjectiveMaxScore: 10,
        note: note.trim()
      })
      onGraded(item.attemptId)
      setScore('')
      setNote('')
    } catch (submitError: unknown) {
      setError(submitError instanceof Error ? submitError.message : '批改失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <li className="grading-row">
      <div className="grading-stem">{item.stem}</div>
      <div className="grading-submission">
        <strong>学生提交：</strong>
        <p>{item.submissionText || '（无文本）'}</p>
      </div>

      <div className="grading-layer objective">
        <span className="layer-tag objective-tag">客观证据</span>
        <span>
          自动评分 {item.objectiveScore} / {item.objectiveMaxScore}（可复现）
        </span>
      </div>

      <div className="grading-layer advisory">
        <span className="layer-tag ai-tag">
          <ShieldAlert size={12} /> AI 推断
        </span>
        <ul>
          {(item.advisory ?? []).map((a) => (
            <li key={a.id}>
              <em>{a.dimensionLabel}：</em>
              {a.suggestion}
            </li>
          ))}
        </ul>
        <span className="muted">建议，不计入分数；需教师确认。</span>
      </div>

      {item.teacherAnnotation !== undefined ? (
        <div className="grading-layer adjudicated">
          <span className="layer-tag teacher-tag">教师终裁</span>
          <span>
            {item.teacherAnnotation.subjectiveScore} /{' '}
            {item.teacherAnnotation.subjectiveMaxScore} — {item.teacherAnnotation.note}
          </span>
        </div>
      ) : (
        <div className="grading-form">
          <label>
            主观分（0-10）：
            <input
              type="number"
              min={0}
              max={10}
              value={score}
              onChange={(e) => setScore(e.target.value)}
              disabled={submitting}
            />
          </label>
          <label>
            批改说明：
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={submitting}
              placeholder="终裁理由（必填）"
            />
          </label>
          <button type="button" onClick={() => void submit()} disabled={submitting}>
            提交终裁
          </button>
        </div>
      )}

      {error !== undefined ? (
        <div className="error-banner">
          <AlertTriangle size={16} /> {error}
        </div>
      ) : null}
    </li>
  )
}
