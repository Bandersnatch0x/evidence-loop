/**
 * weeklyReportApi — T19 学情周报的前端读取层。
 *
 * 独立于 src/lib/api.ts（避免与并行票冲突），但复用同一套 demo-role
 * 请求头约定，行为一致。全部是只读 GET —— 周报没有任何写端点。
 *
 * 打印页刻意**不用** `window.open(url)`：那样发不出 demo-role 头，服务端
 * 会按学生角色拒绝。改为带头 fetch 回 HTML 文本，再用 Blob URL 打开，
 * 权限语义与 JSON 端点完全一致。
 */
import type { ApiError } from '../../../shared/contracts'
import type {
  WeeklyReport,
  WeeklyReportSectionId
} from '../../../shared/weeklyReport'
import { DEMO_ROLE_HEADER, readStoredDemoRole } from '../../lib/demoRole'

/** 与 server/reports/weeklyReportRoutes.ts 的 WeeklyReportResponse 对齐。 */
export interface WeeklyReportResponse {
  report: WeeklyReport
  sectionOrder: WeeklyReportSectionId[]
  evidenceCount: number
}

export interface WeeklyReportQuery {
  studentId: string
  teachingUnitId: string
  /** ISO-8601；缺省 = 最近 7×24h。 */
  from?: string
  to?: string
}

function buildParams(query: WeeklyReportQuery): URLSearchParams {
  const params = new URLSearchParams({
    studentId: query.studentId,
    teachingUnitId: query.teachingUnitId
  })
  if (query.from) params.set('from', query.from)
  if (query.to) params.set('to', query.to)
  return params
}

function demoHeaders(accept: string): Record<string, string> {
  return { accept, [DEMO_ROLE_HEADER]: readStoredDemoRole() }
}

async function requestJson<T>(input: string): Promise<T> {
  const response = await fetch(input, {
    headers: demoHeaders('application/json')
  })
  const payload = (await response.json()) as T | ApiError
  if (!response.ok) {
    const apiError = payload as ApiError
    throw new Error(apiError.details?.join('；') ?? apiError.error)
  }
  return payload as T
}

/** 教师拉某学生周报（JSON 预览）。 */
export function getTeacherWeeklyReport(
  query: WeeklyReportQuery
): Promise<WeeklyReportResponse> {
  return requestJson(
    `/api/teacher/reports/weekly?${buildParams(query).toString()}`
  )
}

/** 学生拉自己的周报。 */
export function getStudentWeeklyReport(
  query: WeeklyReportQuery
): Promise<WeeklyReportResponse> {
  return requestJson(
    `/api/student/reports/weekly?${buildParams(query).toString()}`
  )
}

/** 家长拉绑定子女的只读周报（演示绑定 parent-demo → learner-demo）。 */
export function getParentWeeklyReport(
  query: WeeklyReportQuery
): Promise<WeeklyReportResponse> {
  return requestJson(
    `/api/parent/reports/weekly?${buildParams(query).toString()}`
  )
}

/** 取打印友好 HTML 文本（不直接跳转，见文件头说明）。 */
export async function fetchWeeklyReportHtml(
  query: WeeklyReportQuery
): Promise<string> {
  const response = await fetch(
    `/api/teacher/reports/weekly.html?${buildParams(query).toString()}`,
    { headers: demoHeaders('text/html') }
  )
  const text = await response.text()
  if (!response.ok) {
    try {
      const apiError = JSON.parse(text) as ApiError
      throw new Error(apiError.error)
    } catch (parseError) {
      if (parseError instanceof Error && parseError.message !== '') {
        throw parseError
      }
      throw new Error('周报打印页生成失败')
    }
  }
  return text
}

/**
 * 在新标签页打开打印页。调用方负责在 finally 里释放 objectURL ——
 * 这里延迟 60s 撤销，既保证新窗口加载完成，也不永久泄漏。
 */
export async function openWeeklyReportPrintView(
  query: WeeklyReportQuery
): Promise<void> {
  const html = await fetchWeeklyReportHtml(query)
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank', 'noopener,noreferrer')
  window.setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 60_000)
}
