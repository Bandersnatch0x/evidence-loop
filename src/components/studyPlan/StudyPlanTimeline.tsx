/**
 * StudyPlanTimeline — 学生首页「本周计划」时间条（T18）。
 *
 * 只渲染服务端返回的硬事实计划：7 个日格 + 每格 0..N 个 task。
 * 前端**不做任何补全**：日格空就是空（当天没有硬输入），
 * `status === 'insufficient_evidence'` 时明说「证据不足」并给出下一步，
 * 绝不用文案伪装成有计划。
 *
 * presentationHint 是建议层（llm_inference），渲染在虚线框里、与硬事实
 * 任务视觉分离；它缺省时整个时间条照常工作。
 */
import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  CalendarRange,
  RefreshCw,
  ShieldCheck,
  Sparkles
} from 'lucide-react'
import type { StudyPlanTask } from '../../../shared/studyPlan'
import { isAdvisoryHint } from '../../../shared/studyPlan'
import {
  getStudyPlan,
  regenerateStudyPlan,
  type StudyPlanResponse
} from './studyPlanApi'
import { StudyPlanDayColumn } from './StudyPlanDayColumn'
import { evidenceSummary } from './evidenceSummary'
import './studyPlan.css'

interface StudyPlanTimelineProps {
  studentId: string
  teachingUnitId: string
  /** 变更即重新拉取（与 TodayPractice 的 refreshKey 约定一致）。 */
  refreshKey?: number
  /** 今日任务进练习入口。缺省时任务卡只读。 */
  onStartTask?: (task: StudyPlanTask) => void
  busy?: boolean
}

export function StudyPlanTimeline({
  studentId,
  teachingUnitId,
  refreshKey = 0,
  onStartTask,
  busy = false
}: StudyPlanTimelineProps) {
  const [data, setData] = useState<StudyPlanResponse>()
  const [error, setError] = useState<string>()
  const [isLoading, setIsLoading] = useState(true)
  const [isRegenerating, setIsRegenerating] = useState(false)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(undefined)
    getStudyPlan(studentId, teachingUnitId)
      .then((loaded) => {
        if (!cancelled) setData(loaded)
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : '本周计划加载失败'
          )
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [studentId, teachingUnitId, refreshKey])

  const handleRegenerate = useCallback(() => {
    setIsRegenerating(true)
    setError(undefined)
    regenerateStudyPlan(studentId, teachingUnitId)
      .then(setData)
      .catch((regenError: unknown) => {
        setError(
          regenError instanceof Error ? regenError.message : '计划重算失败'
        )
      })
      .finally(() => {
        setIsRegenerating(false)
      })
  }, [studentId, teachingUnitId])

  const plan = data?.plan
  const hint = plan?.presentationHint

  return (
    <section className="study-plan" aria-labelledby="study-plan-title">
      <header className="study-plan-header">
        <h3 id="study-plan-title">
          <CalendarRange size={18} /> 本周计划
        </h3>
        <span className="study-plan-provenance">
          <ShieldCheck size={13} />
          硬事实生成 · 每条可追溯到证据
        </span>
      </header>

      {isLoading ? <p className="study-plan-note">正在按硬输入重算计划…</p> : null}

      {error !== undefined ? (
        <div className="error-banner" role="alert">
          <AlertTriangle size={18} /> {error}
        </div>
      ) : null}

      {plan !== undefined && plan.status === 'insufficient_evidence' ? (
        <p className="study-plan-empty">
          证据不足，暂不生成本周计划。计划只由 FSRS 到期、依赖链薄弱与测评掌握度
          三类硬输入决定；完成一次测评或练习后回来即可看到路径。
        </p>
      ) : null}

      {plan !== undefined ? (
        <>
          <div className="study-plan-timeline" role="list">
            {plan.days.map((day) => (
              <StudyPlanDayColumn
                key={day.date}
                day={day}
                onStartTask={onStartTask}
                busy={busy || isRegenerating}
              />
            ))}
          </div>

          {isAdvisoryHint(hint) && hint !== undefined ? (
            <p className="study-plan-hint">
              <Sparkles size={14} />
              <span>
                <strong>节奏建议（AI 生成 · llm_inference）：</strong>
                {hint.text}
              </span>
            </p>
          ) : null}

          <div className="study-plan-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={handleRegenerate}
              disabled={isRegenerating || busy}
            >
              <RefreshCw size={14} /> {isRegenerating ? '重算中…' : '重算计划'}
            </button>
            <span className="study-plan-note">
              算法 {plan.algorithm} · 全周 {data?.taskCount ?? 0} 项 ·{' '}
              {evidenceSummary(plan.evidenceRefs)}
            </span>
          </div>
        </>
      ) : null}
    </section>
  )
}
