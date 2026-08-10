/**
 * portfolioRoutes — T23 能力证据包 / 作品集导出的 HTTP 面。
 *
 *   POST /api/student/portfolio/export  学生导出**自己**的包（zip 下载）
 *   POST /api/teacher/portfolio/export  教师导出本单元在读学生的包（zip 下载）
 *
 * 两个端点都支持 `?format=json`（返回 portfolio.json 原文，供前端预览与
 * 数据完整性校验）；缺省返回 zip（portfolio.json + README.md）。
 *
 * 边界：
 *   * 两个端点都是**只读投影** —— 除自有导出台账与审计链外不写任何东西，
 *     绝不 touch score / evidence / MasteryProfile（ADR-0001）。
 *   * 三道权限门叠加：角色（authorizeAccess）→ 教学单元归属（teacherId）
 *     → enrollment（学生必须在本单元班级名单里）。学生只能是本人。
 *   * 导出即留痕：台账（自有表）+ 审计链双写，metadata 全是标量，
 *     绝不落包正文（ADR-0003：不做 PII 二次落库）。
 *   * LLM 辅导对话不在此契约里（shared/portfolio.ts 无该字段）——默认不打包。
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
import { HttpError, readJsonBody, respondJson } from '../http/httpUtils'
import { findUnbackedPortfolioAttempts, type PortfolioPackage } from '../../shared/portfolio'
import type { PortfolioExportService } from './PortfolioExportService'
import { renderPortfolioReadme } from './renderPortfolioReadme'
import { buildZip, portfolioFilename } from './zipWriter'
import {
  PortfolioUnitMissingError,
  UnbackedPortfolioAttemptError,
  type PortfolioAuditSink,
  type PortfolioExportRecorder,
  type PortfolioOrgReader
} from './ports'

export interface PortfolioRouteContext {
  db: Database
  portfolio: PortfolioExportService
  /** 用于 enrollment 校验（与 Service 内部用的是同一个实现）。 */
  org: PortfolioOrgReader
  user: SessionUser
  /** 可选：导出台账（迁移 0019）。缺席时只记审计链。 */
  exports?: PortfolioExportRecorder
  /** 可选：审计链。缺席时不记（测试可注入 fake 断言）。 */
  audit?: PortfolioAuditSink
  now?: () => Date
}

const STUDENT_EXPORT_PATH = '/api/student/portfolio/export'
const TEACHER_EXPORT_PATH = '/api/teacher/portfolio/export'

/** 返回 true 表示请求已被消费。路径为精确匹配，挂载顺序无关紧要。 */
export async function handlePortfolioApi(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  context: PortfolioRouteContext
): Promise<boolean> {
  const { pathname } = requestUrl
  const isPortfolioPath =
    pathname === STUDENT_EXPORT_PATH || pathname === TEACHER_EXPORT_PATH
  if (!isPortfolioPath) return false

  if (request.method !== 'POST') {
    respondJson(response, 405, { error: 'Method not allowed' })
    return true
  }

  try {
    if (pathname === STUDENT_EXPORT_PATH) {
      await handleStudentExport(request, response, requestUrl, context)
      return true
    }
    await handleTeacherExport(request, response, requestUrl, context)
    return true
  } catch (error) {
    return respondError(response, error)
  }
}

// ---------------------------------------------------------------------------
// 学生面：只能导自己
// ---------------------------------------------------------------------------

async function handleStudentExport(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  context: PortfolioRouteContext
): Promise<void> {
  const body = await readRecordBody(request)
  const own = context.user.studentId ?? context.user.userId
  const requestedStudent = readString(body.studentId) || own

  // Student endpoint is student-role only (teachers use /api/teacher/...).
  // This closes the IDOR where any teacher could call the student path.
  if (context.user.role !== 'student') {
    respondJson(response, 403, {
      error:
        'Forbidden: use the teacher portfolio export endpoint for other students'
    })
    return
  }
  if (requestedStudent !== own) {
    respondJson(response, 403, {
      error: 'Forbidden: students may only export their own portfolio'
    })
    return
  }
  if (
    !authorizeAccess(context.db, context.user, {
      purpose: 'student-data',
      studentId: requestedStudent
    }).allowed
  ) {
    respondJson(response, 403, {
      error: 'Forbidden: students may only export their own portfolio'
    })
    return
  }

  const unitId = readString(body.teachingUnitId)
  if (unitId === '') {
    respondJson(response, 400, {
      error: 'teachingUnitId is required'
    })
    return
  }
  if (!isEnrolled(context, unitId, requestedStudent)) {
    respondJson(response, 403, {
      error: 'Forbidden: student is not enrolled in this teaching unit'
    })
    return
  }

  const options = readOptions(body)
  const pkg = await context.portfolio.exportPortfolio(
    requestedStudent,
    unitId,
    options
  )
  recordExport(context, pkg, requestedStudent)
  respondPackage(response, requestUrl, pkg)
}

// ---------------------------------------------------------------------------
// 教师面：只能导本单元在读学生
// ---------------------------------------------------------------------------

async function handleTeacherExport(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  context: PortfolioRouteContext
): Promise<void> {
  const teaching = authorizeAccess(context.db, context.user, {
    purpose: 'teaching'
  })
  if (!teaching.allowed) {
    respondJson(response, 403, {
      error: 'Forbidden: only teachers may export a student portfolio'
    })
    return
  }

  const body = await readRecordBody(request)
  const studentId = readString(body.studentId)
  const unitId = readString(body.teachingUnitId)
  if (studentId === '' || unitId === '') {
    respondJson(response, 400, {
      error: 'studentId and teachingUnitId are required'
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
  if (!isEnrolled(context, unitId, studentId)) {
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

  const options = readOptions(body)
  const pkg = await context.portfolio.exportPortfolio(studentId, unitId, options)
  recordExport(context, pkg, studentId)
  respondPackage(response, requestUrl, pkg)
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function readOptions(body: Record<string, unknown>): {
  attemptIds?: readonly string[]
  questionTypes?: readonly string[]
} {
  const options: { attemptIds?: readonly string[]; questionTypes?: readonly string[] } =
    {}
  if (Array.isArray(body.attemptIds)) {
    const ids = body.attemptIds.filter((item): item is string => typeof item === 'string')
    if (ids.length > 0) options.attemptIds = ids
  }
  if (Array.isArray(body.questionTypes)) {
    const types = body.questionTypes.filter((item): item is string => typeof item === 'string')
    if (types.length > 0) options.questionTypes = types
  }
  return options
}

function isEnrolled(
  context: PortfolioRouteContext,
  unitId: string,
  studentId: string
): boolean {
  const unit = context.org.getTeachingUnit(unitId)
  if (!unit) return false
  return context.org.listEnrolledStudentIds(unit.classId, unit.termId).includes(studentId)
}

/**
 * 导出留痕。台账（自有表）+ 审计链（哈希链）双写，metadata 全是标量，
 * 绝不落包正文（ADR-0003：不做 PII 二次落库）。
 */
function recordExport(
  context: PortfolioRouteContext,
  pkg: PortfolioPackage,
  studentId: string
): void {
  const exportedAt = (context.now?.() ?? new Date()).toISOString()
  const packageId = `portfolio_${studentId}_${pkg.meta.teachingUnitId}_${exportedAt}`
  context.exports?.record({
    id: randomUUID(),
    packageId,
    studentId,
    teachingUnitId: pkg.meta.teachingUnitId,
    actorId: context.user.userId,
    actorRole: context.user.role,
    attemptCount: pkg.attempts.length,
    algorithm: pkg.meta.algorithmVersion,
    rubricVersion: pkg.meta.rubricVersion,
    exportedAt
  })
  context.audit?.enqueue({
    actorRole: context.user.role,
    actorId: context.user.userId,
    action: 'export',
    resourceType: 'portfolio',
    resourceId: packageId,
    studentId,
    result: pkg.attempts.length > 0 ? 'ok' : 'empty',
    metadata: {
      feature: 'portfolio_export',
      teachingUnitId: pkg.meta.teachingUnitId,
      attemptCount: pkg.attempts.length,
      algorithm: pkg.meta.algorithmVersion,
      rubricVersion: pkg.meta.rubricVersion
    }
  })
}

/** 出站闸门 + 交付。`?format=json` 返回原文（预览/校验），缺省 zip 下载。 */
function respondPackage(
  response: ServerResponse,
  requestUrl: URL,
  pkg: PortfolioPackage
): void {
  const unbacked = findUnbackedPortfolioAttempts(pkg)
  if (unbacked.length > 0) {
    throw new UnbackedPortfolioAttemptError(unbacked[0] ?? '')
  }
  if (requestUrl.searchParams.get('format') === 'json') {
    respondJson(response, 200, pkg)
    return
  }
  const zip = buildZip([
    { name: 'portfolio.json', data: JSON.stringify(pkg, null, 2) },
    { name: 'README.md', data: renderPortfolioReadme(pkg) }
  ])
  response.writeHead(200, {
    'content-type': 'application/zip',
    'content-disposition': `attachment; filename="${portfolioFilename(
      pkg.meta.studentAlias
    )}"`,
    'content-length': String(zip.length),
    'cache-control': 'no-store',
    [SECURITY_WARNING_HEADER]: SECURITY_WARNING_VALUE
  })
  response.end(zip)
}

async function readRecordBody(
  request: IncomingMessage
): Promise<Record<string, unknown>> {
  const body = await readJsonBody(request)
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new HttpError(400, 'Request body must be a JSON object')
  }
  return body as Record<string, unknown>
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function respondError(response: ServerResponse, error: unknown): boolean {
  if (error instanceof PortfolioUnitMissingError) {
    respondJson(response, 404, { error: error.message })
    return true
  }
  if (error instanceof UnbackedPortfolioAttemptError) {
    respondJson(response, 500, { error: error.message })
    return true
  }
  if (error instanceof HttpError) {
    respondJson(response, error.statusCode, { error: error.message })
    return true
  }
  respondJson(response, 500, { error: 'Internal server error' })
  return true
}
