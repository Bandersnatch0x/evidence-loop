/**
 * achievementRoutes — T20 证据驱动轻激励的 HTTP 面。
 *
 *   GET  /api/student/achievements?studentId=&unitId=       学生成就墙
 *   POST /api/student/achievements/sync                     判定并落库新徽章
 *   GET  /api/teacher/achievements/summary?unitId=          班级聚合**计数**
 *
 * 刻意**没有**的端点（PRD Out of Scope，缺席即边界）：
 *   * 没有 /leaderboard、/ranking、/top —— 排行榜没有 HTTP 入口；
 *   * 没有任何返回「学生 A 比学生 B 多几枚」的形状；
 *   * 没有 points / streak 提醒推送端点。
 *
 * 边界：
 *   * GET 全部是**只读投影**（全量重算后返回），除自有表外不写任何东西；
 *   * sync 只写 student_achievements 一张自有表，绝不 touch score /
 *     evidence / MasteryProfile（ADR-0001）；
 *   * 祝贺文案（llm_inference）由调用方在**授予之后**外挂，本层不生成、
 *     也不允许它影响 earned 列表 —— 判定结果先算完再谈文案。
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
  ACHIEVEMENT_CATALOG,
  findUnbackedAchievements,
  type AchievementCatalogEntry,
  type AchievementClassSummary,
  type AchievementEvaluation,
  type StudentAchievement
} from '../../shared/achievements'
import type { AchievementService } from './AchievementService'
import { AchievementUnitMissingError, UnbackedAchievementError } from './ports'

export interface AchievementRouteContext {
  db: Database
  achievements: AchievementService
  user: SessionUser
  /** Unit ownership + enrollment (required for teacher cross-student access). */
  org: UnitScopeOrg
}

const STUDENT_PATH = '/api/student/achievements'
const STUDENT_SYNC_PATH = '/api/student/achievements/sync'
const TEACHER_SUMMARY_PATH = '/api/teacher/achievements/summary'

/** 返回 true 表示请求已被消费。路径判定是精确匹配，挂载顺序无关。 */
export async function handleAchievementApi(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  context: AchievementRouteContext
): Promise<boolean> {
  const { pathname } = requestUrl
  const isAchievementPath =
    pathname === STUDENT_PATH ||
    pathname === STUDENT_SYNC_PATH ||
    pathname === TEACHER_SUMMARY_PATH
  if (!isAchievementPath) return false

  try {
    if (request.method === 'GET' && pathname === STUDENT_PATH) {
      await handleStudentAchievements(requestUrl, response, context)
      return true
    }
    if (request.method === 'POST' && pathname === STUDENT_SYNC_PATH) {
      await handleSync(request, response, context)
      return true
    }
    if (request.method === 'GET' && pathname === TEACHER_SUMMARY_PATH) {
      await handleTeacherSummary(requestUrl, response, context)
      return true
    }

    respondJson(response, 405, { error: 'Method not allowed' })
    return true
  } catch (error) {
    return respondError(response, error)
  }
}

// ---------------------------------------------------------------------------
// handlers
// ---------------------------------------------------------------------------

async function handleStudentAchievements(
  requestUrl: URL,
  response: ServerResponse,
  context: AchievementRouteContext
): Promise<void> {
  const studentId =
    requestUrl.searchParams.get('studentId')?.trim() ??
    context.user.studentId ??
    context.user.userId
  if (studentId === '') {
    respondJson(response, 400, { error: 'studentId is required' })
    return
  }
  const unitId = readUnitId(requestUrl)
  if (!assertAchievementAccess(response, context, studentId, unitId)) return

  const evaluation = await context.achievements.evaluate(studentId, {
    ...withUnitId(unitId)
  })
  respondJson(response, 200, toWallResponse(evaluation))
}

/**
 * 判定 + 落库。**幂等** —— 已授予的徽章不会被改写 earnedAt，
 * 也不会出现在 newlyEarned 里（前端据此只对真正的新徽章弹一次 toast）。
 */
async function handleSync(
  request: IncomingMessage,
  response: ServerResponse,
  context: AchievementRouteContext
): Promise<void> {
  const body = await readRecordBody(request)
  const studentId =
    readString(body.studentId) ||
    context.user.studentId ||
    context.user.userId
  if (studentId === '') {
    respondJson(response, 400, { error: 'studentId is required' })
    return
  }

  const unitId = readString(body.unitId) || readString(body.teachingUnitId)
  if (!assertAchievementAccess(response, context, studentId, unitId)) return

  const result = await context.achievements.sync(studentId, {
    ...withUnitId(unitId)
  })
  respondJson(response, 200, {
    ...toWallResponse(result.evaluation),
    newlyEarned: result.newlyEarned
  })
}

/**
 * 班级聚合。返回形状里**只有分子分母**：`studentCount` 和每枚徽章的
 * `earnedCount`。没有学生 id、没有名次、没有 max/min —— 教师看到的是
 * 「这个班有多少人清掉了薄弱点」，不是「谁排第一」。
 */
async function handleTeacherSummary(
  requestUrl: URL,
  response: ServerResponse,
  context: AchievementRouteContext
): Promise<void> {
  const unitId = readUnitId(requestUrl)
  if (unitId === '') {
    respondJson(response, 400, { error: 'unitId query parameter is required' })
    return
  }
  const owns = authorizeTeacherOwnsUnit(
    context.db,
    context.user,
    context.org,
    unitId
  )
  if (!owns.allowed) {
    respondJson(response, owns.status, { error: owns.error })
    return
  }

  const summary = await context.achievements.classSummary(unitId)
  respondJson(response, 200, toSummaryResponse(summary))
}

// ---------------------------------------------------------------------------
// response shapes
// ---------------------------------------------------------------------------

/**
 * 学生成就墙。目录随响应一起下发，前端不必硬编码文案，
 * 「一句话硬条件」始终与服务端判定逻辑同源。
 */
export interface AchievementWallResponse {
  studentId: string
  algorithm: string
  evaluatedAt: string
  catalog: readonly AchievementCatalogEntry[]
  earned: StudentAchievement[]
  progress: AchievementEvaluation['progress']
  /** 已获得数 / 目录总数。仅此一个「进度」标量，不折算成积分。 */
  earnedCount: number
  totalCount: number
}

/**
 * 出站闸门：任何一枚徽章缺硬证据就整体 500，而不是把它渲染给用户。
 * 正常路径上 evaluateAchievements 永不产出这种徽章，所以这一行是
 * 「不变量被破坏时立刻响亮失败」的保险丝。
 */
function toWallResponse(
  evaluation: AchievementEvaluation
): AchievementWallResponse {
  const unbacked = findUnbackedAchievements(evaluation.earned)
  if (unbacked.length > 0) {
    throw new UnbackedAchievementError(unbacked.join(', '))
  }
  return {
    studentId: evaluation.studentId,
    algorithm: evaluation.algorithm,
    evaluatedAt: evaluation.evaluatedAt,
    catalog: ACHIEVEMENT_CATALOG,
    earned: evaluation.earned,
    progress: evaluation.progress,
    earnedCount: evaluation.earned.length,
    totalCount: ACHIEVEMENT_CATALOG.length
  }
}

export interface AchievementSummaryResponse {
  teachingUnitId: string
  algorithm: string
  studentCount: number
  catalog: readonly AchievementCatalogEntry[]
  /** 与固定目录等长、同序；缺席的徽章补 0，避免前端出现「空排行」错觉。 */
  counts: Array<{ achievementId: string; earnedCount: number }>
}

function toSummaryResponse(
  summary: AchievementClassSummary
): AchievementSummaryResponse {
  const tally = new Map(
    summary.counts.map((item) => [item.achievementId, item.earnedCount])
  )
  return {
    teachingUnitId: summary.teachingUnitId,
    algorithm: summary.algorithm,
    studentCount: summary.studentCount,
    catalog: ACHIEVEMENT_CATALOG,
    // 固定目录顺序 —— 刻意**不**按 earnedCount 排序，排序本身就是排行榜。
    counts: ACHIEVEMENT_CATALOG.map((entry) => ({
      achievementId: entry.id,
      earnedCount: tally.get(entry.id) ?? 0
    }))
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function withUnitId(unitId: string): { teachingUnitId?: string } {
  return unitId === '' ? {} : { teachingUnitId: unitId }
}

/**
 * Student wall/sync:
 * - students: self only (unit optional; when present must be enrolled)
 * - teachers: unit required + ownership + enrollment
 */
function assertAchievementAccess(
  response: ServerResponse,
  context: AchievementRouteContext,
  studentId: string,
  unitId: string
): boolean {
  if (context.user.role === 'student') {
    const own = context.user.studentId ?? context.user.userId
    if (studentId !== own) {
      respondJson(response, 403, {
        error: 'Forbidden: cannot view achievements for this student'
      })
      return false
    }
    if (unitId !== '') {
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
    } else {
      const base = authorizeAccess(context.db, context.user, {
        purpose: 'student-data',
        studentId
      })
      if (!base.allowed) {
        respondJson(response, 403, {
          error: 'Forbidden: cannot view achievements for this student'
        })
        return false
      }
    }
    return true
  }

  // Teachers / admins: require unit scope so class walls cannot be scraped globally.
  if (unitId === '') {
    respondJson(response, 400, {
      error: 'unitId is required for teacher achievement access'
    })
    return false
  }
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

function respondError(response: ServerResponse, error: unknown): boolean {
  if (error instanceof AchievementUnitMissingError) {
    respondJson(response, 404, { error: error.message })
    return true
  }
  if (error instanceof UnbackedAchievementError) {
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
