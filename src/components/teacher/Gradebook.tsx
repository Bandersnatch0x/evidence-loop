import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ClipboardList, Download, ShieldAlert } from 'lucide-react'
import type { GradingQueueItem } from '../../../shared/contracts'
import { getGradingQueue, gradeSubjective } from '../../lib/api'
import { downloadCsv } from '../../lib/downloadCsv'

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

  const reload = useCallback(() => {
    setIsLoading(true)
    setError(undefined)
    return getGradingQueue(teachingUnitId)
      .then((loaded) => setQueue(loaded))
      .catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : '批改队列加载失败')
      })
      .finally(() => setIsLoading(false))
  }, [teachingUnitId])

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

  const handleGraded = (
    attemptId: string,
    annotation: NonNullable<GradingQueueItem['teacherAnnotation']>
  ) => {
    // Optimistic local update so the row flips to "教师终裁" without a full reload.
    setQueue((prev) =>
      prev.map((item) =>
        item.attemptId === attemptId
          ? { ...item, teacherAnnotation: annotation }
          : item
      )
    )
  }

  if (isLoading) return <p className="muted">加载批改队列…</p>
  if (error !== undefined) {
    return (
      <div className="error-banner" role="alert">
        <AlertTriangle size={18} /> {error}
        <button type="button" onClick={() => void reload()}>
          重试
        </button>
      </div>
    )
  }
  if (queue.length === 0) {
    return (
      <p className="muted">
        <ClipboardList size={18} style={{ verticalAlign: 'middle' }} />{' '}
        队列为空，没有待批改的主观题。学生提交作文/论述后会出现在此。
      </p>
    )
  }

  const pending = queue.filter((item) => item.teacherAnnotation === undefined).length

  const exportCsv = () => {
    downloadCsv(
      `grading-${teachingUnitId}.csv`,
      [
        'attemptId',
        'studentId',
        'questionId',
        'objectiveScore',
        'objectiveMaxScore',
        'subjectiveScore',
        'subjectiveMaxScore',
        'note',
        'adjudicatedAt',
        'signature'
      ],
      queue.map((item) => [
        item.attemptId,
        item.studentId,
        item.questionId,
        item.objectiveScore,
        item.objectiveMaxScore,
        item.teacherAnnotation?.subjectiveScore,
        item.teacherAnnotation?.subjectiveMaxScore,
        item.teacherAnnotation?.note,
        item.teacherAnnotation?.adjudicatedAt,
        item.teacherAnnotation?.signature
      ])
    )
  }

  return (
    <section className="gradebook">
      <header className="gradebook-header">
        <div>
          <h3>主观题批改</h3>
          <span className="muted">
            共 {queue.length} 份 · 待批 {pending} 份
          </span>
        </div>
        <button type="button" className="export-csv-btn" onClick={exportCsv}>
          <Download size={14} /> 导出成绩 CSV
        </button>
      </header>
      <ul className="grading-list">
        {queue.map((item) => (
          <GradingRow
            key={item.attemptId}
            item={item}
            onGraded={handleGraded}
          />
        ))}
      </ul>
    </section>
  )
}

interface GradingRowProps {
  item: GradingQueueItem
  onGraded: (
    attemptId: string,
    annotation: NonNullable<GradingQueueItem['teacherAnnotation']>
  ) => void
}

function GradingRow({ item, onGraded }: GradingRowProps) {
  const [score, setScore] = useState('')
  /** T12/S3: teacher-editable max (default 10, not hard-wired on submit). */
  const [maxScore, setMaxScore] = useState('10')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    const subjectiveScore = Number(score)
    const subjectiveMaxScore = Number(maxScore)
    if (!Number.isFinite(subjectiveScore) || subjectiveScore < 0) {
      setError('请输入有效分数')
      return
    }
    if (
      !Number.isFinite(subjectiveMaxScore) ||
      subjectiveMaxScore <= 0 ||
      !Number.isInteger(subjectiveMaxScore)
    ) {
      setError('请输入有效满分（正整数）')
      return
    }
    if (subjectiveScore > subjectiveMaxScore) {
      setError(`分数不能超过满分 ${subjectiveMaxScore}`)
      return
    }
    if (note.trim() === '') {
      setError('请填写批改说明')
      return
    }
    setSubmitting(true)
    setError(undefined)
    try {
      const result = await gradeSubjective(item.attemptId, {
        subjectiveScore,
        subjectiveMaxScore,
        note: note.trim()
      })
      onGraded(item.attemptId, result.teacherAnnotation)
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
      <div className="grading-meta muted">
        学生 {item.studentId} · 提交于 {item.submittedAt}
      </div>
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
        {(item.advisory ?? []).length === 0 ? (
          <span className="muted">暂无 AI 建议</span>
        ) : (
          <ul>
            {(item.advisory ?? []).map((a) => (
              <li key={a.id}>
                <em>{a.dimensionLabel}：</em>
                {a.suggestion}
              </li>
            ))}
          </ul>
        )}
        <span className="muted">建议，不计入分数；需教师确认。</span>
      </div>

      {item.teacherAnnotation !== undefined ? (
        <div className="grading-layer adjudicated">
          <span className="layer-tag teacher-tag">教师终裁</span>
          <span>
            {item.teacherAnnotation.subjectiveScore} /{' '}
            {item.teacherAnnotation.subjectiveMaxScore} —{' '}
            {item.teacherAnnotation.note}
          </span>
        </div>
      ) : (
        <div className="grading-form">
          <label>
            主观分：
            <input
              type="number"
              min={0}
              value={score}
              onChange={(e) => setScore(e.target.value)}
              disabled={submitting}
              aria-label="主观分"
            />
          </label>
          <label>
            满分：
            <input
              type="number"
              min={1}
              value={maxScore}
              onChange={(e) => setMaxScore(e.target.value)}
              disabled={submitting}
              aria-label="主观满分"
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
              aria-label="批改说明"
            />
          </label>
          <button type="button" onClick={() => void submit()} disabled={submitting}>
            提交终裁
          </button>
        </div>
      )}

      {error !== undefined ? (
        <div className="error-banner" role="alert">
          <AlertTriangle size={16} /> {error}
        </div>
      ) : null}
    </li>
  )
}
