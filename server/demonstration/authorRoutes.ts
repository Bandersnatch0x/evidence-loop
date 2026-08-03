/**
 * authorRoutes — teacher author endpoints for demonstrations (spec §5.1).
 *
 *   GET    /api/demonstrations/:id/draft       owner reads own draft
 *   PUT    /api/demonstrations/:id/draft       owner saves full SceneDocument draft
 *   POST   /api/demonstrations/:id/submit      owner submits (freeze snapshot)
 *   POST   /api/demonstrations/:id/withdraw    owner withdraws pending version
 *   DELETE /api/demonstrations/:id             owner soft-deletes work
 *   POST   /api/demonstrations/:id/takedown    owner takes down published work
 *
 * Ownership-gated via DemonstrationService (assertOwner). The draft PUT runs
 * the SceneDocument zod trust gate (parseSceneDocument) so hard failures are
 * refused at the boundary. Author routes never touch scoring/evidence.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Database } from 'better-sqlite3'
import { parseSceneDocument } from './sceneDocumentSchema'
import type { DemonstrationService } from './DemonstrationService'

export interface AuthorRouteContext {
  db: Database
  service: DemonstrationService
  /** Resolved session user (authorization happens in the caller or here). */
  getUserId: () => string | null
}

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
} as const

const MAX_BODY_BYTES = 2 * 1024 * 1024

function respondJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, JSON_HEADERS)
  response.end(JSON.stringify(body))
}

class BodyTooLargeError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'BodyTooLargeError'
  }
}

class MalformedJsonError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'MalformedJsonError'
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  const declaredSize = Number(request.headers['content-length'] ?? 0)
  if (Number.isFinite(declaredSize) && declaredSize > MAX_BODY_BYTES) {
    throw new BodyTooLargeError('Request body is too large')
  }
  for await (const chunk of request) {
    const buffer: Buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += buffer.length
    if (size > MAX_BODY_BYTES) {
      throw new BodyTooLargeError('Request body is too large')
    }
    chunks.push(buffer)
  }
  const body = Buffer.concat(chunks).toString('utf8')
  if (body.length === 0) return null
  try {
    return JSON.parse(body) as unknown
  } catch {
    throw new MalformedJsonError('Malformed JSON request body')
  }
}

export async function handleAuthorApi(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  ctx: AuthorRouteContext
): Promise<boolean> {
  const userId = ctx.getUserId()
  if (!userId) return false

  const match = pathname.match(/^\/api\/demonstrations\/([^/]+)(\/[^/]+)?$/)
  if (!match) return false
  const demoId = decodeURIComponent(match[1] ?? '')
  const action = match[2] ?? ''

  if (request.method === 'GET' && action === '/draft') {
    try {
      const draft = ctx.service.getDraft(demoId)
      respondJson(response, 200, draft)
    } catch {
      respondJson(response, 404, { error: 'draft not found' })
    }
    return true
  }

  if (request.method === 'PUT' && action === '/draft') {
    try {
      const body = await readJsonBody(request)
      // Zod trust gate: hard failures refuse the save at the boundary.
      const document = parseSceneDocument(body)
      ctx.service.saveDraft(demoId, userId, document)
      respondJson(response, 200, { ok: true })
    } catch (error) {
      if (error instanceof MalformedJsonError || error instanceof BodyTooLargeError) {
        respondJson(response, 400, { error: error.message })
      } else if (error instanceof Error && error.name === 'ZodError') {
        respondJson(response, 400, { error: 'scene document failed validation' })
      } else {
        respondJson(response, 403, { error: error instanceof Error ? error.message : 'forbidden' })
      }
    }
    return true
  }

  if (request.method === 'POST' && action === '/submit') {
    try {
      const body = (await readJsonBody(request)) as {
        classification?: string
        license?: string
        aiDisclosure?: string
        reviewerNote?: string
      } | null
      const versionId = ctx.service.submit(demoId, userId, {
        classification: body?.classification ?? '',
        license: body?.license ?? '',
        aiDisclosure: body?.aiDisclosure ?? '',
        reviewerNote: body?.reviewerNote
      })
      respondJson(response, 201, { versionId })
    } catch (error) {
      respondJson(response, 400, { error: error instanceof Error ? error.message : 'submit failed' })
    }
    return true
  }

  if (request.method === 'POST' && action === '/withdraw') {
    try {
      const body = (await readJsonBody(request)) as { versionId?: string } | null
      const versionId = body?.versionId
      if (!versionId) {
        respondJson(response, 400, { error: 'versionId required' })
        return true
      }
      ctx.service.withdraw(demoId, userId, versionId)
      respondJson(response, 200, { ok: true })
    } catch (error) {
      respondJson(response, 400, { error: error instanceof Error ? error.message : 'withdraw failed' })
    }
    return true
  }

  if (request.method === 'DELETE' && action === '') {
    try {
      ctx.service.softDelete(demoId, userId)
      respondJson(response, 200, { ok: true })
    } catch (error) {
      respondJson(response, 403, { error: error instanceof Error ? error.message : 'forbidden' })
    }
    return true
  }

  if (request.method === 'POST' && action === '/takedown') {
    try {
      ctx.service.takedown(demoId, userId)
      respondJson(response, 200, { ok: true })
    } catch (error) {
      respondJson(response, 403, { error: error instanceof Error ? error.message : 'forbidden' })
    }
    return true
  }

  return false
}
