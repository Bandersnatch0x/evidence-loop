/**
 * ParentOverviewView — 家长端只读视图（决赛加码）。
 *
 * 权限面刻意最小：只拉 /api/parent/reports/weekly（演示绑定
 * parent-demo → learner-demo），复用与教师/学生同一套章节渲染组件
 * （WeeklyReportSections），不存在「对家长柔化过的数字」。
 * 无写动作、无导出按钮 —— 家长端只读，审计记 view 事件。
 */
import { useEffect, useState } from 'react'
import { Eye, RefreshCw, UserRound } from 'lucide-react'
import { getParentWeeklyReport, type WeeklyReportResponse } from '../reports/weeklyReportApi'
import { WeeklyReportHeader, WeeklyReportSections } from '../reports/WeeklyReportSections'
import '../reports/weeklyReport.css'
import { ErrorBanner } from '../Banner'

interface ParentOverviewViewProps {
  /** 演示绑定子女（parent-demo 的固定子辈）。 */
  childStudentId: string
  teachingUnitId: string
  from?: string
  to?: string
}

export function ParentOverviewView({
  childStudentId,
  teachingUnitId,
  from,
  to
}: ParentOverviewViewProps) {
  const [data, setData] = useState<WeeklyReportResponse>()
  const [error, setError] = useState<string>()
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(undefined)
    getParentWeeklyReport({
      studentId: childStudentId,
      teachingUnitId,
      ...(from ? { from } : {}),
      ...(to ? { to } : {})
    })
      .then((loaded) => {
        if (!cancelled) setData(loaded)
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : '子女周报加载失败'
          )
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [childStudentId, teachingUnitId, from, to])

  return (
    <section className="parent-view" aria-labelledby="parent-view-title">
      <header className="view-heading parent-view-heading">
        <div>
          <h2 id="parent-view-title">
            <UserRound size={18} style={{ verticalAlign: 'middle' }} /> 家长视图
          </h2>
          <p className="muted">
            只读查看子女（{childStudentId}）的循证周报；数字与教师导出同源，
            无写动作。演示家长-子女绑定为 demo 常量（parent-demo → learner-demo）。
          </p>
        </div>
      </header>

      {isLoading ? (
        <p className="muted">
          <RefreshCw size={14} style={{ verticalAlign: 'middle' }} /> 加载中…
        </p>
      ) : null}
      {error !== undefined ? <ErrorBanner>{error}</ErrorBanner> : null}
      {!isLoading && error === undefined && data === undefined ? (
        <p className="muted">暂无子女周报数据。</p>
      ) : null}
      {data !== undefined ? (
        <>
          <div className="muted parent-view-readonly-note">
            <Eye size={13} style={{ verticalAlign: 'middle' }} /> 只读 · 每周报告 ·
            {data.evidenceCount} 条证据锚点
          </div>
          <WeeklyReportHeader
            report={data.report}
            evidenceCount={data.evidenceCount}
          />
          <WeeklyReportSections report={data.report} />
        </>
      ) : null}
    </section>
  )
}
