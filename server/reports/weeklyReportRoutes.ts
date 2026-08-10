/**
 * weeklyReportRoutes — T19 学情周报的 HTTP 面。
 *
 *   GET /api/teacher/reports/weekly       教师拉某学生周报（JSON）
 *   GET /api/teacher/reports/weekly.html  同上，打印友好 HTML（另存 PDF）
 *   GET /api/student/reports/weekly       学生拉**自己**的周报（JSON）
 *
 * 边界：
 *   * 三个端点都是**只读投影** —— 除自有导出台账与审计链外不写任何东西，
 *     绝不 touch score / evidence / MasteryProfile（ADR-0001）。
 *   * 三道权限门叠加：角色（authorizeAccess）→ 教学单元归属（teacherId）
 *     → enrollment（学生必须在本单元班级名单里）。学生只能是本人。
 *   * 无数据不报错：证据不足的章节返回空态文案，HTTP 仍是 200。
 *   * AI 文案走 `attachReportNarrative` 闸门（provenance + 非空 + PII 三验），
 *     不合格直接丢弃，报告数字不受任何影响。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import { authorizeAccess } from '../auth/authorization'
import type { SessionUser } from '../auth/SessionProvider'
import {
  SECURITY_WARNING_HEADER,
  SECURITY_WARNING_VALUE
} from '../auth/MockSessionProvider'
import { HttpError, respondJson } from '../http/httpUtils'
import {
  WEEKLY_REPORT_SECTION_ORDER,
  type WeeklyReport,
  type WeeklyReportNarrative,
  type WeeklyReportSectionId
} from '../../shared/weeklyReport'
import { attachReportNarrative } from './WeeklyReportService'
import type { WeeklyReportService } from './WeeklyReportService'
import { renderWeeklyReportHtml } from './renderWeeklyReportHtml'
import {
  WeeklyReportUnitMissingError,
  WeeklyReportWindowError,
  type WeeklyReportAuditSink,
  type WeeklyReportExportRecorder,
  type WeeklyReportOrgReader
} from './ports'

/**
 * 叙述性文案提供方（可选）。**唯一**允许 LLM 介入周报的入口，
 * 产出物必须过 `attachReportNarrative` 闸门才会出现在报告里。
 */
export interface WeeklyReportNarrator {
  narrate(report: WeeklyReport): Promise<WeeklyReportNarrative | undefined>
}

/** LLM 文案只能挂在「下周建议」章节 —— 数字章节不接受任何叙述层改写。 */
const NARRATIVE_SECTION: WeeklyReportSectionId = 'next_week'

export interface WeeklyReportRouteContext {
  db: Database
  weeklyReport: WeeklyReportService
  /** 用于 enrollment 校验（与 Service 内部用的是同一个实现）。 */
  org: WeeklyReportOrgReader
  user: SessionUser
  /** 可选：导出台账（迁移 0015）。缺席时只记审计链。 */
  exports?: WeeklyReportExportRecorder
  /** 可选：审计链。缺席时不记（测试可注入 fake 断言）。 */
  audit?: WeeklyReportAuditSink
  /** 可选：AI 叙述文案。缺席时报告纯硬事实。 */
  narrator?: WeeklyReportNarrator
  now?: () => Date
}

/** 学生 / 教师端共用的 JSON 响应体。 */
export interface WeeklyReportResponse {
  report: WeeklyReport
  /** 章节固定顺序，前端不必再排序。 */
  sectionOrder: readonly WeeklyReportSectionId[]
  /** 锚点总数，UI 角标用。 */
  evidenceCount: number
}

const TEACHER_JSON_PATH = '/api/teacher/reports/weekly'
const TEACHER_HTML_PATH = '/api/teacher/reports/weekly.html'
const STUDENT_JSON_PATH = '/api/student/reports/weekly'

/** 返回 true 表示请求已被消费。路径为精确匹配，挂载顺序无关紧要。 */
export async function handleWeeklyReportApi(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  context: WeeklyReportRouteContext
): Promise<boolean> {
  const { pathname } = requestUrl
  const isReportPath =
    pathname === TEACHER_JSON_PATH ||
    pathname === TEACHER_HTML_PATH ||
    pathname === STUDENT_JSON_PATH
  if (!isReportPath) return false

  if (request.method !== 'GET') {
    respondJson(response, 405, { error: 'Method not allowed' })
    return true
  }

  try {
    if (pathname === STUDENT_JSON_PATH) {
      await handleStudentReport(requestUrl, response, context)
      return true
    }
    await handleTeacherReport(
      requestUrl,
      response,
      context,
      pathname === TEACHER_HTML_PATH ? 'html' : 'json'
    )
    return true
  } catch (error) {
    return respondError(response, error)
  }
}

// ---------------------------------------------------------------------------
// 教师面
// ---------------------------------------------------------------------------

async function handleTeacherReport(
  requestUrl: URL,
  response: ServerResponse,
  context: WeeklyReportRouteContext,
  format: 'json' | 'html'
): Promise<void> {
  const teaching = authorizeAccess(context.db, context.user, {
    purpose: 'teaching'
  })
  if (!teaching.allowed) {
    respondJson(response, 403, {
      error: 'Forbidden: only teachers may export a weekly report'
    })
    return
  }

  const unitId = readUnitId(requestUrl)
  const studentId = requestUrl.searchParams.get('studentId')?.trim() ?? ''
  if (unitId === '' || studentId === '') {
    respondJson(response, 400, {
      error: 'teachingUnitId and studentId query parameters are required'
    })
    return
  }

  const unit = context.org.getTeachingUnit(unitId)
  if (!unit) {
    respondJson(response, 404, { error: `Teaching unit not found: ${unitId}` })
    return
  }
  // 教学单元归属：admin 放行，教师只能导出自己带的单元。
  if (context.user.role !== 'admin' && unit.teacherId !== context.user.userId) {
    respondJson(response, 403, {
      error: 'Forbidden: teaching unit belongs to another teacher'
    })
    return
  }
  if (!isEnrolled(context, unit.classId, unit.termId, studentId)) {
    respondJson(response, 403, {
      error: 'Forbidden: student is not enrolled in this teaching unit'
    })
    return
  }
  if (
    !authorizeAccess(context.db, context.user, {
      purpose: 'student-data',
      studentId
    }).allowed
  ) {
    respondJson(response, 403, {
      error: 'Forbidden: cannot read data for this student'
    })
    return
  }

  const report = await produceReport(context, studentId, unitId, requestUrl)
  recordExport(context, report, format)

  if (format === 'html') {
    respondHtml(response, 200, renderWeeklyReportHtml(report))
    return
  }
  respondJson(response, 200, toResponse(report))
}

// ---------------------------------------------------------------------------
// 学生面
// ---------------------------------------------------------------------------

async function handleStudentReport(
  requestUrl: URL,
  response: ServerResponse,
  context: WeeklyReportRouteContext
): Promise<void> {
  const own = context.user.studentId ?? context.user.userId
  const requested = requestUrl.searchParams.get('studentId')?.trim() ?? ''
  const studentId = requested === '' ? own : requested

  // Student endpoint is student-role only. Teachers must use the teacher path
  // (unit ownership + enrollment). Closes cross-teacher IDOR via student-data.
  if (context.user.role !== 'student') {
    respondJson(response, 403, {
      error:
        'Forbidden: use the teacher weekly-report endpoint for other students'
    })
    return
  }
  if (studentId !== own) {
    respondJson(response, 403, {
      error: 'Forbidden: students may only read their own weekly report'
    })
    return
  }
  if (
    !authorizeAccess(context.db, context.user, {
      purpose: 'student-data',
      studentId
    }).allowed
  ) {
    respondJson(response, 403, {
      error: 'Forbidden: students may only read their own weekly report'
    })
    return
  }

  const unitId = readUnitId(requestUrl)
  if (unitId === '') {
    respondJson(response, 400, {
      error: 'teachingUnitId query parameter is required'
    })
    return
  }
  const unit = context.org.getTeachingUnit(unitId)
  if (!unit) {
    respondJson(response, 404, { error: `Teaching unit not found: ${unitId}` })
    return
  }
  if (!isEnrolled(context, unit.classId, unit.termId, studentId)) {
    respondJson(response, 403, {
      error: 'Forbidden: student is not enrolled in this teaching unit'
    })
    return
  }

  const report = await produceReport(context, studentId, unitId, requestUrl)
  auditView(context, report)
  respondJson(response, 200, toResponse(report))
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * 生成报告 + 可选地挂 AI 文案。
 * narrator 抛错不影响报告 —— 硬事实层永远优先于叙述层。
 */
async function produceReport(
  context: WeeklyReportRouteContext,
  studentId: string,
  unitId: string,
  requestUrl: URL
): Promise<WeeklyReport> {
  const from = requestUrl.searchParams.get('from')?.trim()
  const to = requestUrl.searchParams.get('to')?.trim()
  const report = await context.weeklyReport.generate(studentId, unitId, {
    ...(from ? { from } : {}),
    ...(to ? { to } : {})
  })
  if (!context.narrator) return report

  let narrative: WeeklyReportNarrative | undefined
  try {
    narrative = await context.narrator.narrate(report)
  } catch {
    return report
  }
  return attachReportNarrative(report, NARRATIVE_SECTION, narrative)
}

function toResponse(report: WeeklyReport): WeeklyReportResponse {
  return {
    report,
    sectionOrder: WEEKLY_REPORT_SECTION_ORDER,
    evidenceCount: report.evidenceRefs.length
  }
}

function isEnrolled(
  context: WeeklyReportRouteContext,
  classId: string,
  termId: string,
  studentId: string
): boolean {
  return context.org
    .listEnrolledStudentIds(classId, termId)
    .includes(studentId)
}

/**
 * 导出留痕。台账（自有表）+ 审计链（哈希链）双写，metadata 全是标量，
 * 绝不落报告正文（ADR-0003：不做 PII 二次落库）。
 */
function recordExport(
  context: WeeklyReportRouteContext,
  report: WeeklyReport,
  format: 'json' | 'html'
): void {
  const exportedAt = (context.now?.() ?? new Date()).toISOString()
  context.exports?.record({
    id: randomUUID(),
    reportId: report.id,
    studentId: report.studentId,
    teachingUnitId: report.teachingUnitId,
    actorId: context.user.userId,
    actorRole: context.user.role,
    format,
    windowFrom: report.window.from,
    windowTo: report.window.to,
    algorithm: report.algorithm,
    status: report.status,
    exportedAt
  })
  context.audit?.enqueue({
    actorRole: context.user.role,
    actorId: context.user.userId,
    action: 'export',
    resourceType: 'evaluation',
    resourceId: report.id,
    studentId: report.studentId,
    result: report.status,
    metadata: {
      feature: 'weekly_report',
      format,
      teachingUnitId: report.teachingUnitId,
      windowFrom: report.window.from,
      windowTo: report.window.to,
      algorithm: report.algorithm,
      evidenceCount: report.evidenceRefs.length
    }
  })
}

/** 学生自查不算「导出」，只记 view，不进导出台账。 */
function auditView(
  context: WeeklyReportRouteContext,
  report: WeeklyReport
): void {
  context.audit?.enqueue({
    actorRole: context.user.role,
    actorId: context.user.userId,
    action: 'view',
    resourceType: 'evaluation',
    resourceId: report.id,
    studentId: report.studentId,
    result: report.status,
    metadata: {
      feature: 'weekly_report',
      format: 'json',
      teachingUnitId: report.teachingUnitId,
      evidenceCount: report.evidenceRefs.length
    }
  })
}

function readUnitId(requestUrl: URL): string {
  return (
    requestUrl.searchParams.get('teachingUnitId')?.trim() ??
    requestUrl.searchParams.get('unitId')?.trim() ??
    ''
  )
}

function respondHtml(
  response: ServerResponse,
  statusCode: number,
  html: string
): void {
  response.writeHead(statusCode, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    [SECURITY_WARNING_HEADER]: SECURITY_WARNING_VALUE
  })
  response.end(html)
}

function respondError(response: ServerResponse, error: unknown): boolean {
  if (error instanceof WeeklyReportUnitMissingError) {
    respondJson(response, 404, { error: error.message })
    return true
  }
  if (error instanceof WeeklyReportWindowError) {
    respondJson(response, 400, { error: error.message })
    return true
  }
  if (error instanceof HttpError) {
    respondJson(response, error.statusCode, { error: error.message })
    return true
  }
  respondJson(response, 500, { error: 'Internal server error' })
  return true
}
