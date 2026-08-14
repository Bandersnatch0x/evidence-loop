/**
 * StudentWeeklyReportView — 学生侧栏「我的周报」（T19）。
 *
 * 与教师面板共用同一套章节渲染组件，所以学生看到的数字、分层标识、空态
 * 文案与教师导出给家长的完全一致 —— 不存在「对学生柔化过的版本」。
 *
 * 学生端没有打印按钮：MVP-0 的对外导出是教师动作（要留审计与台账）。
 */
import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import {
  getStudentWeeklyReport,
  type WeeklyReportResponse
} from './weeklyReportApi'
import { WeeklyReportHeader, WeeklyReportSections } from './WeeklyReportSections'
import './weeklyReport.css'
import { ErrorBanner } from '../../components/Banner'

interface StudentWeeklyReportViewProps {
  studentId: string
  teachingUnitId: string
  from?: string
  to?: string
  refreshKey?: number
}

export function StudentWeeklyReportView({
  studentId,
  teachingUnitId,
  from,
  to,
  refreshKey = 0
}: StudentWeeklyReportViewProps) {
  const [data, setData] = useState<WeeklyReportResponse>()
  const [error, setError] = useState<string>()
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(undefined)
    getStudentWeeklyReport({
      studentId,
      teachingUnitId,
      ...(from ? { from } : {}),
      ...(to ? { to } : {})
    })
      .then((loaded) => {
        if (!cancelled) setData(loaded)
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : '周报加载失败')
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [studentId, teachingUnitId, from, to, refreshKey])

  const report = data?.report

  return (
    <section className="weekly-report" aria-labelledby="student-weekly-report">
      <header className="weekly-report-head">
        <h3 id="student-weekly-report">我的周报</h3>
        <span className="weekly-report-meta">
          与老师看到的是同一份报告
        </span>
      </header>

      {isLoading ? (
        <p className="weekly-report-note">
          <RefreshCw size={12} /> 加载中…
        </p>
      ) : null}

      {error !== undefined ? (
        <ErrorBanner>{error}</ErrorBanner>
      ) : null}

      {report !== undefined ? (
        <>
          <WeeklyReportHeader
            report={report}
            evidenceCount={data?.evidenceCount ?? 0}
          />
          {report.status === 'insufficient_evidence' ? (
            <p className="weekly-report-banner">
              这一周还没有留下足够的学习记录，所以下面各章节都是空的。系统不会
              编造内容 —— 去练几道题，下周报告就有数据了。
            </p>
          ) : null}
          <WeeklyReportSections report={report} />
        </>
      ) : null}
    </section>
  )
}
