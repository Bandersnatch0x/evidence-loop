/**
 * ParentOverviewView — 家长端只读视图（决赛加码）。
 *
 * 先拉当前家长的子女绑定（GET /api/parent/children，DB 表 0021），再逐个拉
 * 子女的只读周报（GET /api/parent/reports/weekly，绑定校验在服务端）。
 * 复用与教师/学生同一套章节渲染组件（WeeklyReportSections），不存在「对
 * 家长柔化过的数字」。无写动作、无导出按钮 —— 家长端只读，审计记 view。
 */
import { useEffect, useState } from 'react'
import { Eye, RefreshCw, UserRound } from 'lucide-react'
import {
  getParentChildren,
  getParentWeeklyReport,
  type WeeklyReportResponse
} from '../reports/weeklyReportApi'
import {
  WeeklyReportHeader,
  WeeklyReportSections
} from '../reports/WeeklyReportSections'
import '../reports/weeklyReport.css'
import { ErrorBanner } from '../Banner'

interface ParentOverviewViewProps {
  teachingUnitId: string
  from?: string
  to?: string
}

interface ChildReport {
  studentId: string
  data: WeeklyReportResponse
}

export function ParentOverviewView({
  teachingUnitId,
  from,
  to
}: ParentOverviewViewProps) {
  const [children, setChildren] = useState<string[]>()
  const [selectedChild, setSelectedChild] = useState<string>()
  const [reports, setReports] = useState<Record<string, WeeklyReportResponse>>(
    {}
  )
  const [error, setError] = useState<string>()
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(undefined)
    getParentChildren()
      .then((childIds) => {
        if (cancelled) return
        setChildren(childIds)
        if (childIds.length > 0) {
          setSelectedChild((current) => current ?? childIds[0])
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : '子女绑定加载失败'
          )
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 逐个拉选中子女的周报（DB 绑定校验在服务端）。
  useEffect(() => {
    if (selectedChild === undefined) return
    if (reports[selectedChild] !== undefined) return
    let cancelled = false
    setError(undefined)
    getParentWeeklyReport({
      studentId: selectedChild,
      teachingUnitId,
      ...(from ? { from } : {}),
      ...(to ? { to } : {})
    })
      .then((loaded) => {
        if (!cancelled) {
          setReports((current) => ({ ...current, [selectedChild]: loaded }))
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : '子女周报加载失败'
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [selectedChild, teachingUnitId, from, to, reports])

  const report: ChildReport | undefined =
    selectedChild === undefined
      ? undefined
      : reports[selectedChild] !== undefined
        ? { studentId: selectedChild, data: reports[selectedChild] }
        : undefined

  return (
    <section className="parent-view" aria-labelledby="parent-view-title">
      <header className="view-heading parent-view-heading">
        <div>
          <h2 id="parent-view-title">
            <UserRound size={18} style={{ verticalAlign: 'middle' }} /> 家长视图
          </h2>
          <p className="muted">
            只读查看绑定子女的循证周报；数字与教师导出同源，无写动作。
            子女绑定存于数据库（parent_children），本视图不提供认领入口。
          </p>
        </div>
      </header>

      {isLoading ? (
        <p className="muted">
          <RefreshCw size={14} style={{ verticalAlign: 'middle' }} /> 加载中…
        </p>
      ) : null}
      {error !== undefined ? <ErrorBanner>{error}</ErrorBanner> : null}
      {!isLoading && error === undefined && children !== undefined && children.length === 0 ? (
        <p className="muted">当前家长尚未绑定子女；请在数据面添加绑定后刷新。</p>
      ) : null}

      {children !== undefined && children.length > 1 ? (
        <div className="parent-child-tabs" role="group" aria-label="选择子女">
          {children.map((childId) => (
            <button
              key={childId}
              type="button"
              className={`assignment-filter-chip ${
                selectedChild === childId ? 'is-active' : ''
              }`}
              onClick={() => setSelectedChild(childId)}
            >
              {childId}
            </button>
          ))}
        </div>
      ) : null}

      {report !== undefined ? (
        <>
          <div className="muted parent-view-readonly-note">
            <Eye size={13} style={{ verticalAlign: 'middle' }} /> 只读 · {report.studentId} · 每周报告 ·{' '}
            {report.data.evidenceCount} 条证据锚点
          </div>
          <WeeklyReportHeader
            report={report.data.report}
            evidenceCount={report.data.evidenceCount}
          />
          <WeeklyReportSections report={report.data.report} />
        </>
      ) : null}
    </section>
  )
}
