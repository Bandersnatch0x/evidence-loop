/**
 * studyPlanRoutes — T18 硬事实学习计划的 HTTP 面。
 *
 *   GET  /api/student/study-plan?studentId=&unitId=      学生 7 日计划
 *   POST /api/student/study-plan/regenerate              强制重算
 *   GET  /api/teacher/students/:id/study-plan?unitId=    教师只读
 *   POST /api/teacher/study-plan/assign                  一键布置某日/全周
 *
 * 边界：
 *   * GET / regenerate 都是**只读投影** —— 全量重算后返回，除自有快照表外
 *     不写任何东西，绝不 touch score / evidence / MasteryProfile。
 *   * assign 是**教师显式动作**，通过注入的端口复用 T06 既有的
 *     「按薄弱点布置」写路径（产出 Attempt 占位，status=rejected、score=0），
 *     本模块自己不构造 Attempt、不构造 Evidence。
 *   * 计划里的 KP 全部来自硬事实；assign 只是把它们原样转交，不新增 KP。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Database } from 'better-sqlite3'
import { HttpError, readJsonBody, respondJson } from '../http/httpUtils'
import {
  authorizeAccess,
  authorizeStudentInUnit,
  authorizeTeacherOwnsUnit,
  type UnitScopeOrg
} from '../auth/authorization'
import type { SessionUser } from '../auth/SessionProvider'
import {
  listStudyPlanTasks,
  listTodayTasks,
  type StudyPlan,
  type StudyPlanTask
} from '../../shared/studyPlan'
import type { StudyPlanService } from './StudyPlanService'
import { TeachingUnitMissingError } from './ports'

/**
 * 布置端口 —— 结构上兼容 T06 `AssignByWeaknessService.assign`。
 * 声明成端口而不是直接 import，保持 server/studyPlan 的 import 图干净。
 */
export interface StudyPlanAssignPort {
  assign(input: {
    teachingUnitId: string
    teacherId: string
    kpIds?: string[]
    studentIds?: string[]
    limit?: number
    mode?: 'practice' | 'assessment'
    dueAt?: string
  }): Promise<unknown>
}

export interface StudyPlanRouteContext {
  db: Database
  studyPlan: StudyPlanService
  user: SessionUser
  /** Unit ownership + enrollment gate (required for all student-scoped reads). */
  org: UnitScopeOrg
  /** 可选：缺省时 assign 端点返回 501（计划仍可只读查看）。 */
  assign?: StudyPlanAssignPort
}

const STUDENT_PLAN_PATH = '/api/student/study-plan'
const STUDENT_REGENERATE_PATH = '/api/student/study-plan/regenerate'
const TEACHER_ASSIGN_PATH = '/api/teacher/study-plan/assign'
const TEACHER_PLAN_PATTERN = /^\/api\/teacher\/students\/([^/]+)\/study-plan$/

/**
 * 返回 true 表示请求已被消费。挂载顺序无关紧要 —— 路径判定是精确匹配。
 */
export async function handleStudyPlanApi(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  context: StudyPlanRouteContext
): Promise<boolean> {
  const { pathname } = requestUrl
  const teacherPlanMatch = TEACHER_PLAN_PATTERN.exec(pathname)

  const isStudyPlanPath =
    pathname === STUDENT_PLAN_PATH ||
    pathname === STUDENT_REGENERATE_PATH ||
    pathname === TEACHER_ASSIGN_PATH ||
    teacherPlanMatch !== null
  if (!isStudyPlanPath) return false

  try {
    if (request.method === 'GET' && pathname === STUDENT_PLAN_PATH) {
      await handleStudentPlan(requestUrl, response, context)
      return true
    }
    if (request.method === 'POST' && pathname === STUDENT_REGENERATE_PATH) {
      await handleRegenerate(request, response, context)
      return true
    }
    if (request.method === 'GET' && teacherPlanMatch?.[1] !== undefined) {
      await handleTeacherPlan(
        decodeURIComponent(teacherPlanMatch[1]),
        requestUrl,
        response,
        context
      )
      return true
    }
    if (request.method === 'POST' && pathname === TEACHER_ASSIGN_PATH) {
      await handleAssign(request, response, context)
      return true
    }

    respondJson(response, 405, { error: 'Method not allowed' })
    return true
  } catch (error) {
    return respondError(response, error)
  }
}

async function handleStudentPlan(
  requestUrl: URL,
  response: ServerResponse,
  context: StudyPlanRouteContext
): Promise<void> {
  const studentId =
    requestUrl.searchParams.get('studentId')?.trim() ??
    context.user.studentId ??
    context.user.userId
  const unitId = readUnitId(requestUrl)
  if (studentId === '' || unitId === '') {
    respondJson(response, 400, {
      error: 'studentId and unitId query parameters are required'
    })
    return
  }
  // Student path is self-only; teachers must use the teacher endpoint.
  if (context.user.role !== 'student') {
    respondJson(response, 403, {
      error: 'Forbidden: use the teacher study-plan endpoint for other students'
    })
    return
  }
  if (!assertStudentInUnit(response, context, studentId, unitId)) return

  const plan = await context.studyPlan.generate(studentId, unitId)
  respondJson(response, 200, toStudentPlanResponse(plan))
}

async function handleRegenerate(
  request: IncomingMessage,
  response: ServerResponse,
  context: StudyPlanRouteContext
): Promise<void> {
  const body = await readRecordBody(request)
  const studentId =
    readString(body.studentId) ||
    context.user.studentId ||
    context.user.userId
  const unitId = readString(body.unitId) || readString(body.teachingUnitId)
  if (studentId === '' || unitId === '') {
    respondJson(response, 400, { error: 'studentId and unitId are required' })
    return
  }
  if (context.user.role !== 'student') {
    respondJson(response, 403, {
      error: 'Forbidden: only the student may regenerate their own plan here'
    })
    return
  }
  if (!assertStudentInUnit(response, context, studentId, unitId)) return

  // 重算 = 同一条 generate 路径。幂等：同一硬输入必得同一计划。
  const plan = await context.studyPlan.generate(studentId, unitId)
  respondJson(response, 200, toStudentPlanResponse(plan))
}

async function handleTeacherPlan(
  studentId: string,
  requestUrl: URL,
  response: ServerResponse,
  context: StudyPlanRouteContext
): Promise<void> {
  const unitId = readUnitId(requestUrl)
  if (studentId.trim() === '' || unitId === '') {
    respondJson(response, 400, {
      error: 'studentId path segment and unitId query parameter are required'
    })
    return
  }
  const teaching = authorizeAccess(context.db, context.user, {
    purpose: 'teaching'
  })
  if (!teaching.allowed) {
    respondJson(response, 403, {
      error: 'Forbidden: only teachers may read a student study plan'
    })
    return
  }
  if (!assertStudentInUnit(response, context, studentId, unitId)) return

  const plan = await context.studyPlan.generate(studentId, unitId)
  respondJson(response, 200, toStudentPlanResponse(plan))
}

/**
 * 一键布置。只接受计划里**已经存在**的 KP —— 请求里任何计划外的 kpId
 * 都会被丢弃，教师无法借这个端点塞进未教/无证据的知识点。
 */
async function handleAssign(
  request: IncomingMessage,
  response: ServerResponse,
  context: StudyPlanRouteContext
): Promise<void> {
  const teaching = authorizeAccess(context.db, context.user, {
    purpose: 'teaching'
  })
  if (!teaching.allowed) {
    respondJson(response, 403, {
      error: 'Forbidden: only teachers may assign a study plan'
    })
    return
  }
  if (!context.assign) {
    respondJson(response, 501, {
      error: 'Study plan assignment is not configured on this server'
    })
    return
  }

  const body = await readRecordBody(request)
  const studentId = readString(body.studentId)
  const unitId = readString(body.unitId) || readString(body.teachingUnitId)
  if (studentId === '' || unitId === '') {
    respondJson(response, 400, { error: 'studentId and unitId are required' })
    return
  }
  if (!assertStudentInUnit(response, context, studentId, unitId)) return

  const plan = await context.studyPlan.generate(studentId, unitId)
  const scoped = selectTasks(plan, body.dayIndex)
  const kpIds = [...new Set(scoped.map((task) => task.kpId))]
  if (kpIds.length === 0) {
    respondJson(response, 409, {
      error:
        'Study plan has no hard-fact tasks to assign (证据不足，不编造学习项)',
      status: plan.status
    })
    return
  }

  const limit = clampLimit(
    scoped.reduce((total, task) => total + task.targetCount, 0)
  )
  const result = await context.assign.assign({
    teachingUnitId: unitId,
    teacherId: context.user.userId,
    kpIds,
    studentIds: [studentId],
    limit,
    // 计划任务恒为 practice（先练后测），布置时保持一致。
    mode: 'practice'
  })

  respondJson(response, 201, {
    planId: plan.id,
    algorithm: plan.algorithm,
    kpIds,
    taskCount: scoped.length,
    assignment: result
  })
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * 学生端响应：计划 + 今日任务快捷入口（首页「今天该练什么」直接用）。
 */
export interface StudyPlanResponse {
  plan: StudyPlan
  today: StudyPlanTask[]
  /** 全周 task 总数，前端时间条角标用。 */
  taskCount: number
}

function toStudentPlanResponse(plan: StudyPlan): StudyPlanResponse {
  return {
    plan,
    today: listTodayTasks(plan),
    taskCount: listStudyPlanTasks(plan).length
  }
}

/** dayIndex 缺省 = 整周；给了数字就只取那一天。 */
function selectTasks(plan: StudyPlan, rawDayIndex: unknown): StudyPlanTask[] {
  if (typeof rawDayIndex !== 'number' || !Number.isFinite(rawDayIndex)) {
    return listStudyPlanTasks(plan)
  }
  const dayIndex = Math.trunc(rawDayIndex)
  return plan.days.find((day) => day.dayIndex === dayIndex)?.tasks ?? []
}

function assertStudentInUnit(
  response: ServerResponse,
  context: StudyPlanRouteContext,
  studentId: string,
  unitId: string
): boolean {
  const decision = authorizeStudentInUnit(
    context.db,
    context.user,
    context.org,
    { studentId, teachingUnitId: unitId }
  )
  if (!decision.allowed) {
    respondJson(response, decision.status, { error: decision.error })
    return false
  }
  return true
}

/** Exported for unit tests that only need ownership without a student. */
export function assertTeacherOwnsUnit(
  response: ServerResponse,
  context: StudyPlanRouteContext,
  unitId: string
): boolean {
  const decision = authorizeTeacherOwnsUnit(
    context.db,
    context.user,
    context.org,
    unitId
  )
  if (!decision.allowed) {
    respondJson(response, decision.status, { error: decision.error })
    return false
  }
  return true
}

function readUnitId(requestUrl: URL): string {
  return (
    requestUrl.searchParams.get('unitId')?.trim() ??
    requestUrl.searchParams.get('teachingUnitId')?.trim() ??
    ''
  )
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

function clampLimit(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 10
  return Math.min(Math.max(Math.trunc(value), 1), 50)
}

function respondError(response: ServerResponse, error: unknown): boolean {
  if (error instanceof TeachingUnitMissingError) {
    respondJson(response, 404, { error: error.message })
    return true
  }
  if (error instanceof HttpError) {
    respondJson(response, error.statusCode, { error: error.message })
    return true
  }
  respondJson(response, 500, { error: 'Internal server error' })
  return true
}
