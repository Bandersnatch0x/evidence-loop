/**
 * mockExamRoutes — T16 跨学科模拟考的 HTTP 面。
 *
 *   POST /api/teacher/mock-exams/suggest    建议卷（不落库）
 *   POST /api/teacher/mock-exams            保存草稿 / 一键布置
 *   GET  /api/teacher/mock-exams/:id        卷面 + 覆盖 KP
 *   GET  /api/student/mock-exams            学生本人已布置卷面
 *   GET  /api/student/papers/:paperId/report 交卷统一报告（学生本人 / 教师）
 *
 * 边界：
 *   * suggest / GET 都是只读，除自有 mock_exam_plans 表外不写任何东西；
 *   * POST 发布把布置动作整体转交 T08 AssignmentService（占位 Attempt，
 *     status=rejected、score=0），本模块不构造 Attempt、不写 score / evidence；
 *   * report 是对已有 Attempt.result 的只读投影，不重新判分；
 *   * 权限用统一的 authorizeAccess：教师端 purpose='teaching'，
 *     学生报告 purpose='student-data'（学生只能看自己的）。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Database } from 'better-sqlite3'
import { HttpError, readJsonBody, respondJson } from '../http/httpUtils'
import {
  authorizeAccess,
  authorizeStudentInUnit,
  type UnitScopeOrg
} from '../auth/authorization'
import type { SessionUser } from '../auth/SessionProvider'
import { MOCK_EXAM_GATE_NOTICE } from '../../shared/mockExam'
import type { MockExamService } from './MockExamService'
import {
  MockExamForbiddenError,
  MockExamInputError,
  MockExamPlanNotFoundError,
  MockExamUnitNotFoundError
} from './ports'

export interface MockExamRouteContext {
  db: Database
  mockExam: MockExamService
  user: SessionUser
  /** Required for report AuthZ (unit ownership + enrollment). */
  org: UnitScopeOrg
}

const SUGGEST_PATH = '/api/teacher/mock-exams/suggest'
const PLANS_PATH = '/api/teacher/mock-exams'
const STUDENT_PLANS_PATH = '/api/student/mock-exams'
const PLAN_PATTERN = /^\/api\/teacher\/mock-exams\/([^/]+)$/
const REPORT_PATTERN = /^\/api\/student\/papers\/([^/]+)\/report$/

/** 返回 true 表示请求已被消费。路径判定是精确匹配，挂载顺序无关。 */
export async function handleMockExamApi(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  context: MockExamRouteContext
): Promise<boolean> {
  const { pathname } = requestUrl
  const planMatch = PLAN_PATTERN.exec(pathname)
  const reportMatch = REPORT_PATTERN.exec(pathname)

  const isMockExamPath =
    pathname === SUGGEST_PATH ||
    pathname === PLANS_PATH ||
    pathname === STUDENT_PLANS_PATH ||
    planMatch !== null ||
    reportMatch !== null
  if (!isMockExamPath) return false

  try {
    if (request.method === 'GET' && pathname === STUDENT_PLANS_PATH) {
      handleListStudentPlans(response, context)
      return true
    }
    if (request.method === 'POST' && pathname === SUGGEST_PATH) {
      await handleSuggest(request, response, context)
      return true
    }
    if (request.method === 'POST' && pathname === PLANS_PATH) {
      await handleSave(request, response, context)
      return true
    }
    // /suggest 已在上面消费，这里的捕获组只会是真正的 planId。
    if (
      request.method === 'GET' &&
      planMatch?.[1] !== undefined &&
      pathname !== SUGGEST_PATH
    ) {
      handleGetPlan(decodeURIComponent(planMatch[1]), response, context)
      return true
    }
    if (request.method === 'GET' && reportMatch?.[1] !== undefined) {
      await handleReport(
        decodeURIComponent(reportMatch[1]),
        requestUrl,
        response,
        context
      )
      return true
    }

    respondJson(response, 405, { error: 'Method not allowed' })
    return true
  } catch (error) {
    return respondError(response, error)
  }
}

function handleListStudentPlans(
  response: ServerResponse,
  context: MockExamRouteContext
): void {
  if (context.user.role !== 'student') {
    respondJson(response, 403, {
      error: 'Forbidden: student mock exams are student-private'
    })
    return
  }
  const studentId = context.user.studentId ?? context.user.userId
  const decision = authorizeAccess(context.db, context.user, {
    purpose: 'student-data',
    studentId
  })
  if (!decision.allowed) {
    respondJson(response, 403, { error: decision.reason })
    return
  }
  respondJson(response, 200, {
    plans: context.mockExam.listAssignedForStudent(studentId),
    gateNotice: MOCK_EXAM_GATE_NOTICE
  })
}

async function handleSuggest(
  request: IncomingMessage,
  response: ServerResponse,
  context: MockExamRouteContext
): Promise<void> {
  if (!requireTeacher(response, context, '只有教师可以生成模拟考建议卷')) return

  const body = await readRecordBody(request)
  const teachingUnitIds = readStringArray(body.teachingUnitIds)
  if (teachingUnitIds.length === 0) {
    respondJson(response, 400, {
      error: 'teachingUnitIds is required (at least one teaching unit)'
    })
    return
  }

  const suggestion = await context.mockExam.suggest({
    teacherId: context.user.userId,
    teachingUnitIds,
    ...optionalString('classId', body.classId),
    ...optionalString('title', body.title),
    ...optionalNumber('questionCount', body.count ?? body.questionCount),
    ...optionalNumber('durationMinutes', body.duration ?? body.durationMinutes)
  })
  respondJson(response, 200, suggestion)
}

async function handleSave(
  request: IncomingMessage,
  response: ServerResponse,
  context: MockExamRouteContext
): Promise<void> {
  if (!requireTeacher(response, context, '只有教师可以保存或布置模拟考')) return

  const body = await readRecordBody(request)
  const teachingUnitIds = readStringArray(body.teachingUnitIds)
  const questionIds = readStringArray(body.questionIds)
  if (teachingUnitIds.length === 0 || questionIds.length === 0) {
    respondJson(response, 400, {
      error: 'teachingUnitIds and questionIds are required'
    })
    return
  }

  const studentIds = readStringArray(body.studentIds)
  const result = await context.mockExam.save({
    teacherId: context.user.userId,
    teachingUnitIds,
    questionIds,
    publish: body.publish === true,
    ...(studentIds.length > 0 ? { studentIds } : {}),
    ...optionalString('planId', body.planId),
    ...optionalString('classId', body.classId),
    ...optionalString('title', body.title),
    ...optionalString('dueAt', body.dueAt),
    ...optionalNumber('durationMinutes', body.duration ?? body.durationMinutes)
  })
  respondJson(response, result.plan.status === 'assigned' ? 201 : 200, result)
}

function handleGetPlan(
  planId: string,
  response: ServerResponse,
  context: MockExamRouteContext
): void {
  if (!requireTeacher(response, context, '只有教师可以查看模拟考卷面')) return
  respondJson(response, 200, context.mockExam.get(planId, context.user.userId))
}

/**
 * 交卷报告。学生只能看自己的；教师须为卷面 creator 或所属单元任课教师，
 * 且目标学生在卷面任一教学单元在读。
 * studentId 缺省 = 当前会话主体。
 */
async function handleReport(
  paperId: string,
  requestUrl: URL,
  response: ServerResponse,
  context: MockExamRouteContext
): Promise<void> {
  const studentId =
    requestUrl.searchParams.get('studentId')?.trim() ??
    context.user.studentId ??
    context.user.userId
  if (studentId === '') {
    respondJson(response, 400, { error: 'studentId is required' })
    return
  }

  const plan = context.mockExam.findByPaperId(paperId)

  if (context.user.role === 'student') {
    const own = context.user.studentId ?? context.user.userId
    if (studentId !== own) {
      respondJson(response, 403, {
        error: 'Forbidden: cannot read this student mock exam report'
      })
      return
    }
    // When a mock-exam plan exists, require enrollment in one of its units.
    if (plan && plan.teachingUnitIds.length > 0) {
      const enrolledSomewhere = plan.teachingUnitIds.some((unitId) => {
        const decision = authorizeStudentInUnit(
          context.db,
          context.user,
          context.org,
          { studentId, teachingUnitId: unitId }
        )
        return decision.allowed
      })
      if (!enrolledSomewhere) {
        respondJson(response, 403, {
          error: 'Forbidden: not enrolled in this mock exam teaching unit'
        })
        return
      }
    }
  } else {
    if (!plan) {
      respondJson(response, 404, {
        error: `Mock exam paper not found: ${paperId}`
      })
      return
    }
    const base = authorizeAccess(context.db, context.user, {
      purpose: 'student-data',
      studentId
    })
    if (!base.allowed) {
      respondJson(response, 403, {
        error: 'Forbidden: cannot read this student mock exam report'
      })
      return
    }
    const isCreator =
      context.user.role === 'admin' || plan.creatorId === context.user.userId
    let unitOk = false
    if (plan.teachingUnitIds.length === 0) {
      unitOk = isCreator
    } else {
      for (const unitId of plan.teachingUnitIds) {
        const decision = authorizeStudentInUnit(
          context.db,
          context.user,
          context.org,
          { studentId, teachingUnitId: unitId }
        )
        if (decision.allowed) {
          unitOk = true
          break
        }
      }
      // Creator may still be blocked if student is not enrolled — intentional.
    }
    if (!unitOk) {
      respondJson(response, 403, {
        error:
          'Forbidden: not unit owner for this exam, or student not enrolled'
      })
      return
    }
  }

  const report = await context.mockExam.report(paperId, studentId)
  respondJson(response, 200, { report, gateNotice: MOCK_EXAM_GATE_NOTICE })
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function requireTeacher(
  response: ServerResponse,
  context: MockExamRouteContext,
  message: string
): boolean {
  const decision = authorizeAccess(context.db, context.user, {
    purpose: 'teaching'
  })
  if (decision.allowed) return true
  respondJson(response, 403, { error: `Forbidden: ${message}` })
  return false
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

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item !== '')
}

function optionalString(
  key: string,
  value: unknown
): Record<string, string> {
  if (typeof value !== 'string') return {}
  const trimmed = value.trim()
  return trimmed === '' ? {} : { [key]: trimmed }
}

function optionalNumber(
  key: string,
  value: unknown
): Record<string, number> {
  if (typeof value !== 'number' || !Number.isFinite(value)) return {}
  return { [key]: value }
}

function respondError(response: ServerResponse, error: unknown): boolean {
  if (error instanceof MockExamUnitNotFoundError) {
    respondJson(response, 404, { error: error.message })
    return true
  }
  if (error instanceof MockExamPlanNotFoundError) {
    respondJson(response, 404, { error: error.message })
    return true
  }
  if (error instanceof MockExamForbiddenError) {
    respondJson(response, 403, { error: error.message })
    return true
  }
  if (error instanceof MockExamInputError) {
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
