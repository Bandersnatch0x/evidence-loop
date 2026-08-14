/**
 * TeacherStudyPlanPanel — 教师学员抽屉里的只读 7 日计划 + 一键布置（T18）。
 *
 * 教师看到的是与学生**同一份**硬事实计划（同一算法、同一硬输入），
 * 不存在「教师视图特供排序」。教师唯一能做的写动作是「按今日/整周布置」，
 * 它把计划里已有的 KP 原样转交 T06 布置路径 —— 不能借这个入口塞进
 * 计划外、未教或无证据的知识点。
 */
import { useCallback, useEffect, useState } from 'react'
import { ClipboardList, ShieldCheck } from 'lucide-react'
import {
  assignStudyPlan,
  getStudentStudyPlanForTeacher,
  type StudyPlanResponse
} from './studyPlanApi'
import { StudyPlanDayColumn } from './StudyPlanDayColumn'
import { evidenceSummary } from './evidenceSummary'
import './studyPlan.css'
import { ErrorBanner } from '../../components/Banner'

interface TeacherStudyPlanPanelProps {
  studentId: string
  teachingUnitId: string
  refreshKey?: number
  /** 布置成功回调（父级可刷新作业列表）。 */
  onAssigned?: (kpIds: string[]) => void
}

export function TeacherStudyPlanPanel({
  studentId,
  teachingUnitId,
  refreshKey = 0,
  onAssigned
}: TeacherStudyPlanPanelProps) {
  const [data, setData] = useState<StudyPlanResponse>()
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [isLoading, setIsLoading] = useState(true)
  const [isAssigning, setIsAssigning] = useState(false)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(undefined)
    getStudentStudyPlanForTeacher(studentId, teachingUnitId)
      .then((loaded) => {
        if (!cancelled) setData(loaded)
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : '学习计划加载失败'
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

  const handleAssign = useCallback(
    (dayIndex?: number) => {
      setIsAssigning(true)
      setError(undefined)
      setNotice(undefined)
      assignStudyPlan({
        studentId,
        teachingUnitId,
        ...(dayIndex !== undefined ? { dayIndex } : {})
      })
        .then((result) => {
          setNotice(
            `已布置 ${result.kpIds.length} 个知识点（${result.taskCount} 项任务）`
          )
          onAssigned?.(result.kpIds)
        })
        .catch((assignError: unknown) => {
          setError(
            assignError instanceof Error ? assignError.message : '布置失败'
          )
        })
        .finally(() => {
          setIsAssigning(false)
        })
    },
    [studentId, teachingUnitId, onAssigned]
  )

  const plan = data?.plan
  const hasTasks = (data?.taskCount ?? 0) > 0
  const todayCount = data?.today.length ?? 0

  return (
    <section className="study-plan" aria-labelledby="teacher-study-plan-title">
      <header className="study-plan-header">
        <h3 id="teacher-study-plan-title">
          <ClipboardList size={18} /> 学习计划（只读）
        </h3>
        <span className="study-plan-provenance">
          <ShieldCheck size={13} />
          与学生同一份硬事实计划
        </span>
      </header>

      {isLoading ? <p className="study-plan-note">加载中…</p> : null}

      {error !== undefined ? (
        <ErrorBanner>{error}</ErrorBanner>
      ) : null}

      {notice !== undefined ? <p className="study-plan-note">{notice}</p> : null}

      {plan !== undefined && plan.status === 'insufficient_evidence' ? (
        <p className="study-plan-empty">
          该生暂无硬输入（FSRS 到期 / 依赖链薄弱 / 测评掌握度），因此没有可布置的
          计划项。系统不会凭空生成学习任务。
        </p>
      ) : null}

      {plan !== undefined ? (
        <>
          <div className="study-plan-timeline" role="list">
            {plan.days.map((day) => (
              <StudyPlanDayColumn key={day.date} day={day} readOnly />
            ))}
          </div>

          <div className="study-plan-actions">
            <button
              type="button"
              className="primary-button"
              onClick={() => handleAssign(0)}
              disabled={isAssigning || todayCount === 0}
            >
              布置今日（{todayCount} 项）
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => handleAssign()}
              disabled={isAssigning || !hasTasks}
            >
              布置整周（{data?.taskCount ?? 0} 项）
            </button>
            <span className="study-plan-note">
              {plan.algorithm} · {evidenceSummary(plan.evidenceRefs)}
            </span>
          </div>
        </>
      ) : null}
    </section>
  )
}
