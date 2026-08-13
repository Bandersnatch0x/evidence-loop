/**
 * TeacherMockExamWizard — 教师「生成模拟考」向导（T16）。
 *
 * 三步：选教学单元（可跨学科）→ 预览建议卷并删题 → 一键布置全班。
 *
 * 边界：
 *   * 前端**不做**任何选题放行判断。删题只是从 questionIds 里去掉一个 id，
 *     保存时服务端会对剩下的每一题重新跑一遍 D2 / D4 / 归属闸门；
 *   * 组卷告警（题量不足 / 学科缺席 / 无薄弱信号）如实展示，不隐藏；
 *   * 页面上不出现任何分数 —— 组卷阶段本来就没有分数。
 */
import { useCallback, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ClipboardList,
  ShieldCheck,
  Trash2
} from 'lucide-react'
import type {
  MockExamQuestionView,
  MockExamSuggestion,
  MockExamWarning
} from '../../../shared/mockExam'
import { questionTypeLabel, subjectLabel } from '../../lib/labels'
import {
  saveMockExam,
  suggestMockExam,
  type SaveMockExamResponse
} from './mockExamApi'
import './mockExam.css'
import { ErrorBanner } from '../../components/Banner'

interface TeacherMockExamWizardProps {
  /** 教师当前可选的教学单元（跨学科时传多个）。 */
  teachingUnitIds: string[]
  classId?: string
  /** 布置成功回调（父级可刷新作业列表）。 */
  onAssigned?: (paperId: string) => void
}

export function TeacherMockExamWizard({
  teachingUnitIds,
  classId,
  onAssigned
}: TeacherMockExamWizardProps) {
  const [selectedUnitIds, setSelectedUnitIds] = useState<string[]>(teachingUnitIds)
  const [count, setCount] = useState(10)
  const [duration, setDuration] = useState(60)
  const [suggestion, setSuggestion] = useState<MockExamSuggestion>()
  const [keptIds, setKeptIds] = useState<string[]>([])
  const [warnings, setWarnings] = useState<MockExamWarning[]>([])
  const [saved, setSaved] = useState<SaveMockExamResponse>()
  const [error, setError] = useState<string>()
  const [isBusy, setIsBusy] = useState(false)

  const keptQuestions = useMemo<MockExamQuestionView[]>(() => {
    const all = suggestion?.questions ?? []
    return keptIds.flatMap((id) => {
      const found = all.find((question) => question.questionId === id)
      return found ? [found] : []
    })
  }, [suggestion, keptIds])

  const toggleUnit = useCallback((unitId: string) => {
    setSelectedUnitIds((current) =>
      current.includes(unitId)
        ? current.filter((id) => id !== unitId)
        : [...current, unitId]
    )
  }, [])

  const handleSuggest = useCallback(() => {
    setIsBusy(true)
    setError(undefined)
    setSaved(undefined)
    suggestMockExam({
      teachingUnitIds: selectedUnitIds,
      count,
      duration,
      ...(classId !== undefined ? { classId } : {})
    })
      .then((result) => {
        setSuggestion(result)
        setKeptIds(result.plan.questionIds)
        setWarnings(result.warnings)
      })
      .catch((suggestError: unknown) => {
        setError(
          suggestError instanceof Error ? suggestError.message : '组卷失败'
        )
      })
      .finally(() => {
        setIsBusy(false)
      })
  }, [selectedUnitIds, count, duration, classId])

  const handlePublish = useCallback(() => {
    if (suggestion === undefined) return
    setIsBusy(true)
    setError(undefined)
    saveMockExam({
      teachingUnitIds: suggestion.plan.teachingUnitIds,
      questionIds: keptIds,
      title: suggestion.plan.title,
      duration: suggestion.plan.durationMinutes,
      classId: suggestion.plan.classId,
      publish: true
    })
      .then((result) => {
        setSaved(result)
        setWarnings(result.warnings)
        if (result.plan.paperId !== undefined) onAssigned?.(result.plan.paperId)
      })
      .catch((publishError: unknown) => {
        setError(
          publishError instanceof Error ? publishError.message : '布置失败'
        )
      })
      .finally(() => {
        setIsBusy(false)
      })
  }, [suggestion, keptIds, onAssigned])

  return (
    <section className="mock-exam" aria-labelledby="mock-exam-wizard-title">
      <header className="mock-exam-header">
        <h3 id="mock-exam-wizard-title">
          <ClipboardList size={18} /> 生成模拟考
        </h3>
        <span className="mock-exam-provenance">
          <ShieldCheck size={13} />
          只收录已入库且有权威答案的正式题
        </span>
      </header>

      <p className="mock-exam-gate">{suggestion?.gateNotice ?? ''}</p>

      <fieldset className="mock-exam-units">
        <legend>教学单元（可跨学科）</legend>
        {teachingUnitIds.map((unitId) => (
          <label key={unitId} className="mock-exam-unit">
            <input
              type="checkbox"
              aria-label={`选择教学单元 ${unitId}`}
              checked={selectedUnitIds.includes(unitId)}
              onChange={() => {
                toggleUnit(unitId)
              }}
            />
            {unitId}
          </label>
        ))}
      </fieldset>

      <div className="mock-exam-actions">
        <label className="mock-exam-field">
          题量
          <input
            type="number"
            aria-label="题量"
            min={1}
            max={60}
            value={count}
            onChange={(event) => {
              setCount(Number(event.target.value))
            }}
          />
        </label>
        <label className="mock-exam-field">
          时长（分钟）
          <input
            type="number"
            aria-label="考试时长（分钟）"
            min={5}
            max={300}
            value={duration}
            onChange={(event) => {
              setDuration(Number(event.target.value))
            }}
          />
        </label>
        <button
          type="button"
          className="primary-button"
          onClick={handleSuggest}
          disabled={isBusy || selectedUnitIds.length === 0}
        >
          生成建议卷
        </button>
      </div>

      {error !== undefined ? (
        <ErrorBanner>{error}</ErrorBanner>
      ) : null}

      {warnings.length > 0 ? (
        <ul className="mock-exam-warnings">
          {warnings.map((warning, index) => (
            <li key={`${warning.code}-${String(index)}`}>
              <AlertTriangle size={13} /> {warning.message}
            </li>
          ))}
        </ul>
      ) : null}

      {suggestion !== undefined ? (
        <>
          <ol className="mock-exam-list">
            {keptQuestions.map((question, index) => (
              <li key={question.questionId} className="mock-exam-item">
                <span className="mock-exam-index">{index + 1}</span>
                <span className="mock-exam-stem">{question.stem}</span>
                <span className="mock-exam-tags">
                  <span className="mock-exam-tag">
                    {subjectLabel(question.subject)}
                  </span>
                  <span className="mock-exam-tag">
                    {questionTypeLabel(question.questionType)}
                  </span>
                  {question.kpIds.map((kpId) => (
                    <span key={kpId} className="mock-exam-kp">
                      {kpId}
                    </span>
                  ))}
                </span>
                <button
                  type="button"
                  className="ghost-button"
                  aria-label={`移除第 ${String(index + 1)} 题`}
                  onClick={() => {
                    setKeptIds((current) =>
                      current.filter((id) => id !== question.questionId)
                    )
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ol>

          <div className="mock-exam-actions">
            <button
              type="button"
              className="primary-button"
              onClick={handlePublish}
              disabled={isBusy || keptIds.length === 0}
            >
              布置全班（{keptIds.length} 题 · 测评态）
            </button>
            {suggestion.plan.questionIds.length > keptIds.length ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => setKeptIds(suggestion.plan.questionIds)}
              >
                恢复全卷被剔除的 {suggestion.plan.questionIds.length - keptIds.length} 道题
              </button>
            ) : null}
            <span className="mock-exam-note">
              {suggestion.plan.algorithm} · 覆盖{' '}
              {suggestion.plan.kpCoverage.length} 个知识点
            </span>
          </div>
        </>
      ) : null}

      {saved?.assignment !== undefined ? (
        <p className="mock-exam-note">
          已布置：paper {saved.assignment.paperId} ·{' '}
          {saved.assignment.studentIds.length} 名学生 ·{' '}
          {saved.assignment.attemptCount} 条占位作答（未开始，score=0）
        </p>
      ) : null}
    </section>
  )
}
