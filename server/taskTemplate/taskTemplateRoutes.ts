/**
 * taskTemplateRoutes — 知识点任务模板（复赛 item 3）的 HTTP 面。
 *
 *   GET  /api/teacher/task-templates             模板目录（含 kp 名称）
 *   POST /api/teacher/task-templates/:id/deploy  一键部署到教学单元
 *
 * 铁律：模板不写分数。部署 = 复用 AssignmentService 以 handpick 布置预置题，
 * 分数只来自题目 runner 的可复现证据（ADR-0001）。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Database } from 'better-sqlite3'
import { HttpError, readJsonBody, respondJson } from '../http/httpUtils'
import {
  authorizeTeacherOwnsUnit,
  type UnitScopeOrg
} from '../auth/authorization'
import type { SessionUser } from '../auth/SessionProvider'
import type { DeployTaskTemplateInput } from '../../shared/contracts'
import type { TaskTemplateService } from './TaskTemplateService'

export interface TaskTemplateRouteContext {
  db: Database
  taskTemplates: TaskTemplateService
  user: SessionUser
  /** Unit ownership (deploy is teacher-only, scoped to own units). */
  org: UnitScopeOrg
}

const LIST_PATH = '/api/teacher/task-templates'

/** 返回 true 表示请求已被消费。 */
export async function handleTaskTemplateApi(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  context: TaskTemplateRouteContext
): Promise<boolean> {
  const { pathname } = requestUrl
  const deployMatch = pathname.match(/^\/api\/teacher\/task-templates\/([^/]+)\/deploy$/)
  const isTemplatePath = pathname === LIST_PATH || deployMatch?.[1] !== undefined
  if (!isTemplatePath) return false

  try {
    if (request.method === 'GET' && pathname === LIST_PATH) {
      const templates = await context.taskTemplates.list()
      respondJson(response, 200, { templates })
      return true
    }

    if (request.method === 'POST' && deployMatch?.[1]) {
      const templateId = decodeURIComponent(deployMatch[1])
      const body = (await readJsonBody(request)) as Record<string, unknown>
      const teachingUnitId = readString(body.teachingUnitId)
      if (teachingUnitId === '') {
        respondJson(response, 400, {
          error: 'teachingUnitId is required'
        })
        return true
      }
      const gate = authorizeTeacherOwnsUnit(
        context.db,
        context.user,
        context.org,
        teachingUnitId
      )
      if (!gate.allowed) {
        respondJson(response, gate.status, { error: gate.error })
        return true
      }
      const input: DeployTaskTemplateInput = {
        teachingUnitId,
        ...(Array.isArray(body.studentIds) &&
        body.studentIds.every((id: unknown) => typeof id === 'string')
          ? { studentIds: body.studentIds }
          : {}),
        ...(typeof body.dueAt === 'string' && body.dueAt !== ''
          ? { dueAt: body.dueAt }
          : {})
      }
      const result = await context.taskTemplates.deploy(
        templateId,
        input,
        context.user.userId
      )
      respondJson(response, 201, result)
      return true
    }

    respondJson(response, 405, { error: 'Method not allowed' })
    return true
  } catch (error) {
    return respondError(response, error)
  }
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function respondError(response: ServerResponse, error: unknown): boolean {
  if (error instanceof HttpError) {
    respondJson(response, error.statusCode, { error: error.message })
    return true
  }
  if (error instanceof Error) {
    // TaskTemplateError carries a 404 status; anything else is a 422.
    const status =
      'status' in error && typeof (error as { status?: unknown }).status === 'number'
        ? ((error as { status: number }).status)
        : 422
    respondJson(response, status, { error: error.message })
    return true
  }
  respondJson(response, 500, { error: 'Internal server error' })
  return true
}
