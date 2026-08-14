/**
 * parentRoutes — 家长端 HTTP 面（决赛加码）。
 *
 *   GET /api/parent/children   当前家长绑定的子女 id 列表（只读）
 *
 * 权限：parent 角色专属（教师/学生走各自的端点）；绑定查询来自
 * ParentChildBindingReader（DB 表 0021）。无写端点 —— 绑定由种子/管理面
 * 维护，家长端保持只读（红队底线：不装成家长可随意认领学生）。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { respondJson } from '../http/httpUtils'
import type { SessionUser } from '../auth/SessionProvider'
import type { ParentChildBindingReader } from './ParentChildBindingStore'

export interface ParentRouteContext {
  user: SessionUser
  bindings: ParentChildBindingReader
}

const CHILDREN_PATH = '/api/parent/children'

/** 返回 true 表示请求已被消费。路径精确匹配，挂载顺序无关。 */
export function handleParentApi(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  context: ParentRouteContext
): boolean {
  const { pathname } = requestUrl
  if (pathname !== CHILDREN_PATH) return false

  if (request.method !== 'GET') {
    respondJson(response, 405, { error: 'Method not allowed' })
    return true
  }
  if (context.user.role !== 'parent') {
    respondJson(response, 403, {
      error: 'Forbidden: only parent sessions may list bound children'
    })
    return true
  }
  const children = context.bindings.listChildren(context.user.userId)
  respondJson(response, 200, { children })
  return true
}
