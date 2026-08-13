/**
 * knowledgeRoutes — knowledge graph HTTP surface.
 *
 * Extracted from server/index.ts (architecture deepening C2).
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { KnowledgeStore } from '../knowledge/KnowledgeStore'
import { respondJson } from '../http/httpUtils'

export interface KnowledgeRouteContext {
  knowledge: KnowledgeStore
}

/**
 * Handle GET /api/knowledge-points.
 * Returns false when the path is not the knowledge route.
 */
export async function handleKnowledgeApi(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  context: KnowledgeRouteContext
): Promise<boolean> {
  if (
    request.method === 'GET' &&
    requestUrl.pathname === '/api/knowledge-points'
  ) {
    respondJson(response, 200, await context.knowledge.getGraph())
    return true
  }
  return false
}
