/**
 * referenceRoutes — reference + notification endpoints (ticket T-J, spec §5.6).
 *
 *   GET    /api/references?questionId= | kpId=     list references (ordered)
 *   PUT    /api/references?questionId= | kpId=     full replace (role/ord)
 *   POST   /api/references/:id/upgrade             manual upgrade to a newer version
 *   DELETE /api/references/:id                     remove a reference
 *   GET    /api/notifications/demo                 teacher's demo notifications
 *   POST   /api/notifications/demo/:id/read        mark one read
 *
 * Teacher-gated. Fixed-version semantics enforced by ReferenceService
 * (never automatic drift; upgrade requires explicit action).
 */
import { respondJson } from '../http/httpUtils'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Database } from 'better-sqlite3'
import type { ReferenceService } from './ReferenceService'
import type { NotificationService } from './NotificationService'

export interface ReferenceRouteContext {
  db: Database
  references: ReferenceService
  notifications: NotificationService
  getUserId: () => string | null
  getRole: () => string
}


const MAX_BODY_BYTES = 256 * 1024


async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer: Buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(buffer)
  }
  const body = Buffer.concat(chunks).toString('utf8')
  if (!body) return null
  try {
    return JSON.parse(body) as unknown
  } catch {
    throw new Error('malformed JSON')
  }
}

export async function handleReferenceApi(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  url: URL,
  ctx: ReferenceRouteContext
): Promise<boolean> {
  const userId = ctx.getUserId()
  if (!userId) return false
  const role = ctx.getRole()

  // Notifications (teacher-facing).
  if (pathname === '/api/notifications/demo' && request.method === 'GET') {
    const list = ctx.notifications.listForTeacher(userId)
    respondJson(response, 200, { notifications: list })
    return true
  }
  const readMatch = pathname.match(/^\/api\/notifications\/demo\/([^/]+)\/read$/)
  if (readMatch?.[1] && request.method === 'POST') {
    ctx.notifications.markRead(decodeURIComponent(readMatch[1]), userId)
    respondJson(response, 200, { ok: true })
    return true
  }

  // References.
  const upgradeMatch = pathname.match(/^\/api\/references\/([^/]+)\/upgrade$/)
  if (upgradeMatch?.[1] && request.method === 'POST') {
    try {
      const body = (await readJsonBody(request)) as { newVersionId?: string } | null
      const newVersionId = body?.newVersionId
      if (!newVersionId) {
        respondJson(response, 400, { error: 'newVersionId required' })
        return true
      }
      ctx.references.upgradeReference(userId, role, decodeURIComponent(upgradeMatch[1]), newVersionId)
      respondJson(response, 200, { ok: true })
    } catch (error) {
      respondJson(response, 400, { error: error instanceof Error ? error.message : 'upgrade failed' })
    }
    return true
  }

  const removeMatch = pathname.match(/^\/api\/references\/([^/]+)$/)
  if (removeMatch?.[1] && request.method === 'DELETE') {
    try {
      ctx.references.removeReference(userId, role, decodeURIComponent(removeMatch[1]))
      respondJson(response, 200, { ok: true })
    } catch (error) {
      respondJson(response, 400, { error: error instanceof Error ? error.message : 'remove failed' })
    }
    return true
  }

  if (pathname === '/api/references') {
    const questionId = url.searchParams.get('questionId') ?? undefined
    const kpId = url.searchParams.get('kpId') ?? undefined
    const hasQuestion = questionId !== undefined
    const hasKp = kpId !== undefined
    if (hasQuestion === hasKp) {
      respondJson(response, 400, { error: 'exactly one of questionId/kpId required' })
      return true
    }
    const parentId = (questionId ?? kpId) as string
    const parentType = hasQuestion ? 'question' : 'kp'

    if (request.method === 'GET') {
      const refs = ctx.references.listReferences(parentId, parentType)
      respondJson(response, 200, { references: refs })
      return true
    }

    if (request.method === 'PUT') {
      try {
        const body = (await readJsonBody(request)) as {
          entries?: Array<{ demoVersionId: string; role: 'primary' | 'supplementary' }>
        } | null
        const entries = body?.entries ?? []
        ctx.references.setReferences(
          userId,
          role,
          hasQuestion
            ? { questionId: parentId, entries }
            : { kpId: parentId, entries }
        )
        respondJson(response, 200, { ok: true })
      } catch (error) {
        respondJson(response, 400, { error: error instanceof Error ? error.message : 'set failed' })
      }
      return true
    }
  }

  return false
}