/**
 * libraryRoutes — public library discovery endpoint (spec §5.4, ticket T-E).
 *
 *   GET /api/library?q=&subject=&grade=&format=&space=&behavior=&license=&sort=
 *
 * Returns library cards (only latest approved versions) + facets. Read-only,
 * no scoring/evidence coupling. Logged-in users; public content readable.
 */
import { respondJson } from '../http/httpUtils'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Database } from 'better-sqlite3'
import { LibrarySearchService, type LibraryQuery } from './LibrarySearchService'

export interface LibraryRouteContext {
  db: Database
  getUserId: () => string | null
}



export function handleLibraryApi(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  url: URL,
  ctx: LibraryRouteContext
): boolean {
  if (request.method !== 'GET' || pathname !== '/api/library') return false
  if (!ctx.getUserId()) {
    respondJson(response, 401, { error: 'unauthorized' })
    return true
  }

  const params = url.searchParams
  const query: LibraryQuery = {
    q: params.get('q') ?? undefined,
    filters: {
      subject: params.get('subject') ?? undefined,
      grade: params.get('grade') ?? undefined,
      kp: params.get('kp') ?? undefined,
      format: params.get('format') ?? undefined,
      space: params.get('space') ?? undefined,
      behavior: params.get('behavior') ?? undefined,
      license: params.get('license') ?? undefined
    },
    sort: params.get('sort') === 'citations' ? 'citations' : 'relevance'
  }
  const limitRaw = Number(params.get('limit') ?? 50)
  query.limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50

  const service = new LibrarySearchService(ctx.db)
  const result = service.search(query)
  respondJson(response, 200, result)
  return true
}
