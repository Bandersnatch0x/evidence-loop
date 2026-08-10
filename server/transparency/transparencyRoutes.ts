/**
 * transparencyRoutes — 只读透明度端点（T17）。
 *
 * GET /api/transparency/agents
 *
 * 返回 shared/agentCatalog.ts 的静态 Agent 编队目录，供透明度页与外部评审
 * 自动化引用。纯静态投影：不读库、不写库、不产生审计事件，也不引入任何
 * 会改变评分行为的 endpoint（PRD「不新增会改变评分行为的 endpoint」）。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { respondJson } from '../http/httpUtils'
import { AGENT_CATALOG, type AgentCatalogEntry } from '../../shared/agentCatalog'

export interface AgentCatalogResponse {
  agents: AgentCatalogEntry[]
  /** 铁律声明，与目录同源：碰分的 Agent 一律零 LLM。 */
  ironRule: string
}

/**
 * handleTransparencyApi — 只读目录端点。返回 true 表示已消费该请求。
 */
export function handleTransparencyApi(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string
): boolean {
  if (pathname !== '/api/transparency/agents') return false
  if (request.method !== 'GET') {
    respondJson(response, 405, { error: 'Method not allowed' })
    return true
  }

  respondJson(response, 200, {
    agents: AGENT_CATALOG,
    ironRule: '评分路径零 LLM：只有评分 Agent 碰分数，且它是确定性的。'
  } satisfies AgentCatalogResponse)
  return true
}
