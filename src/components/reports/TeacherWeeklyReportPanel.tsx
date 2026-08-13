/**
 * TeacherWeeklyReportPanel — 教师学情页「周报」入口面板（T19）。
 *
 * 挂在学生行 / 学员抽屉里：预览 → 打印。教师看到的报告与学生自己看到的
 * 是**同一份**（同一算法、同一硬事实、同一分层标识）。
 *
 * 这个面板没有任何写动作 —— 打印按钮只是把服务端渲染好的 HTML 拉回来，
 * 服务端在导出时记一条审计与台账，前端不参与。
 */
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Printer, RefreshCw } from 'lucide-react'
import {
  getTeacherWeeklyReport,
  openWeeklyReportPrintView,
  type WeeklyReportResponse
} from './weeklyReportApi'
import { WeeklyReportHeader, WeeklyReportSections } from './WeeklyReportSections'
import './weeklyReport.css'
import { ErrorBanner } from '../../components/Banner'

interface TeacherWeeklyReportPanelProps {
  studentId: string
  teachingUnitId: string
  /** ISO-8601；缺省 = 最近 7×24h。 */
  from?: string
  to?: string
  refreshKey?: number
}

export function TeacherWeeklyReportPanel({
  studentId,
  teachingUnitId,
  from,
  to,
  refreshKey = 0
}: TeacherWeeklyReportPanelProps) {
  const [data, setData] = useState<WeeklyReportResponse>()
  const [error, setError] = useState<string>()
  const [isLoading, setIsLoading] = useState(true)
  const [isPrinting, setIsPrinting] = useState(false)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(undefined)
    getTeacherWeeklyReport({
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

  const handlePrint = useCallback(() => {
    setIsPrinting(true)
    setError(undefined)
    openWeeklyReportPrintView({
      studentId,
      teachingUnitId,
      ...(from ? { from } : {}),
      ...(to ? { to } : {})
    })
      .catch((printError: unknown) => {
        setError(
          printError instanceof Error ? printError.message : '打印页生成失败'
        )
      })
      .finally(() => {
        setIsPrinting(false)
      })
  }, [studentId, teachingUnitId, from, to])

  const report = data?.report

  return (
    <section className="weekly-report" aria-labelledby="teacher-weekly-report">
      <header className="weekly-report-head">
        <h3 id="teacher-weekly-report">学情周报</h3>
        <div className="weekly-report-actions">
          <button
            type="button"
            className="ghost-button"
            onClick={handlePrint}
            disabled={isPrinting || report === undefined}
          >
            <Printer size={14} /> 打印 / 另存 PDF
          </button>
        </div>
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
              本区间内没有采集到足够的学习证据，以下章节均为空态。系统不会用推测
              内容填充报告。
            </p>
          ) : null}
          <WeeklyReportSections report={report} />
        </>
      ) : null}
    </section>
  )
}
