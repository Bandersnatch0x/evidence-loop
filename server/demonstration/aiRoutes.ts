/**
 * aiRoutes — AI assistant endpoints (ticket T-I, spec §5.1 note).
 *
 *   POST /api/demonstrations/:id/ai-draft         generate a candidate (NOT stored)
 *   POST /api/demonstrations/:id/ai-checkpoint    save a checkpoint snapshot
 *   GET  /api/demonstrations/:id/ai-checkpoints   list checkpoints (rollback UI)
 *   POST /api/demonstrations/:id/ai-rollback      restore draft from a checkpoint
 *
 * Ownership-gated. Generated candidates are never persisted until the teacher
 * confirms (checkpoint/save). Quota reserve happens before generation.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Database } from 'better-sqlite3'
import type { DemonstrationService } from './DemonstrationService'
import type { AiQuotaStore } from './aiAssistant'
import { generateAiDraft, sanitizeDescription } from './aiAssistant'

export interface AiRouteContext {
  db: Database
  service: DemonstrationService
  quota: AiQuotaStore
  getUserId: () => string | null
}

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
} as const

const MAX_BODY_BYTES = 128 * 1024

function respondJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, JSON_HEADERS)
  response.end(JSON.stringify(body))
}

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

export async function handleAiApi(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  ctx: AiRouteContext
): Promise<boolean> {
  const userId = ctx.getUserId()
  if (!userId) return false

  const match = pathname.match(/^\/api\/demonstrations\/([^/]+)\/(ai-[a-z-]+)$/)
  if (!match) return false
  const demoId = decodeURIComponent(match[1] ?? '')
  const action = match[2] ?? ''

  if (request.method === 'POST' && action === 'ai-draft') {
    try {
      const body = (await readJsonBody(request)) as { description?: string } | null
      const description = sanitizeDescription(body?.description ?? '')
      const outcome = await generateAiDraft(description, ctx.quota, userId)
      if (outcome.ok) {
        respondJson(response, 200, { ok: true, document: outcome.document, warnings: outcome.warnings })
      } else {
        respondJson(response, outcome.reason === 'quota' ? 429 : 400, {
          ok: false,
          reason: outcome.reason,
          message: outcome.message
        })
      }
    } catch (error) {
      respondJson(response, 400, { ok: false, reason: 'llm-failed', message: error instanceof Error ? error.message : 'unknown' })
    }
    return true
  }

  if (request.method === 'POST' && action === 'ai-checkpoint') {
    try {
      const body = (await readJsonBody(request)) as { document?: unknown } | null
      const checkpointId = ctx.service.saveCheckpoint(demoId, userId, body?.document as never)
      respondJson(response, 201, { checkpointId })
    } catch (error) {
      respondJson(response, 400, { error: error instanceof Error ? error.message : 'checkpoint failed' })
    }
    return true
  }

  if (request.method === 'GET' && action === 'ai-checkpoints') {
    try {
      const checkpoints = ctx.service.listCheckpoints(demoId, userId)
      respondJson(response, 200, { checkpoints })
    } catch (error) {
      respondJson(response, 404, { error: error instanceof Error ? error.message : 'not found' })
    }
    return true
  }

  if (request.method === 'POST' && action === 'ai-rollback') {
    try {
      const body = (await readJsonBody(request)) as { checkpointId?: string } | null
      const checkpointId = body?.checkpointId
      if (!checkpointId) {
        respondJson(response, 400, { error: 'checkpointId required' })
        return true
      }
      ctx.service.rollbackToCheckpoint(demoId, userId, checkpointId)
      respondJson(response, 200, { ok: true })
    } catch (error) {
      respondJson(response, 400, { error: error instanceof Error ? error.message : 'rollback failed' })
    }
    return true
  }

  return false
}