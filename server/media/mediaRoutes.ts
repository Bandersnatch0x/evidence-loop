/**
 * Media HTTP routes (spec §5.5) — tus-style chunked uploads + CAS blob serving
 * with RFC-7233 Range support. Wired into server/index.ts as one more
 * `handle*Api` module router (returns true when it consumed the request).
 *
 * Router conventions match the question-bank router: JSON bodies, `?` params,
 * 401/403 scoped by SessionUser, respondJson helper shape. The `x-demo-role`
 * header role flows in via the demo session provider (as in the other routers).
 */
import { respondJson, JSON_HEADERS } from '../http/httpUtils'
import { SECURITY_WARNING_HEADER, SECURITY_WARNING_VALUE } from '../auth/MockSessionProvider'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { URL } from 'node:url'
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { SessionUser } from '../auth/SessionProvider'
import type { BlobStore } from './BlobStore'
import type { UploadStore } from './UploadStore'
import type { MediaProcessor } from './MediaProcessor'
import type { Scanner } from './Scanner'
import { kindLimits } from './mediaGate'

const MAX_JSON_BODY = 16 * 1024

export interface MediaRouteContext {
  db: Database.Database
  blobs: BlobStore
  uploads: UploadStore
  processor: MediaProcessor
  scanner: Scanner
  user: SessionUser
}

export async function handleMediaApi(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  ctx: MediaRouteContext
): Promise<boolean> {
  const { pathname } = requestUrl
  const user = ctx.user

  // GET /api/media/assets — owner-scoped ready asset picker for authoring.
  if (request.method === 'GET' && pathname === '/api/media/assets') {
    if (user.role !== 'teacher' && user.role !== 'admin') {
      respondJson(response, 403, { error: 'media asset listing requires teacher role' })
      return true
    }
    const kind = requestUrl.searchParams.get('kind')
    const allowedKinds = ['image', 'audio', 'model3d', 'video', 'subtitle']
    if (kind !== null && !allowedKinds.includes(kind)) {
      respondJson(response, 400, { error: `unsupported media asset kind: ${kind}` })
      return true
    }
    const rows = ctx.db
      .prepare(
        `SELECT a.id, a.kind, a.original_blob_hash AS blobHash,
                a.status, a.display_name AS displayName, a.created_at AS createdAt,
                b.byte_size AS byteSize, b.media_type AS mediaType
         FROM media_assets a
         JOIN media_blobs b ON b.hash = a.original_blob_hash
         WHERE a.owner_id = ? AND a.status = 'ready'
           AND (? IS NULL OR a.kind = ?)
         ORDER BY a.created_at DESC
         LIMIT 100`
      )
      .all(user.userId, kind, kind)
    respondJson(response, 200, { assets: rows })
    return true
  }

  // POST /api/media/upload-sessions — teacher-only session creation.
  if (request.method === 'POST' && pathname === '/api/media/upload-sessions') {
    if (user.role !== 'teacher' && user.role !== 'admin') {
      respondJson(response, 403, { error: 'media upload requires teacher role' })
      return true
    }
    const bodyText = await readJsonBody(request)
    if (!bodyText) {
      respondJson(response, 400, { error: 'expected JSON body' })
      return true
    }
    let parsed: { kind?: unknown; declaredBytes?: unknown }
    try {
      parsed = JSON.parse(bodyText) as { kind?: unknown; declaredBytes?: unknown }
    } catch {
      respondJson(response, 400, { error: 'invalid JSON body' })
      return true
    }
    const kind = parsed.kind
    const declaredBytes = parsed.declaredBytes
    if (
      typeof kind !== 'string' ||
      typeof declaredBytes !== 'number' ||
      !Number.isSafeInteger(declaredBytes) ||
      declaredBytes <= 0
    ) {
      respondJson(response, 400, { error: 'kind (string) and declaredBytes (positive int) required' })
      return true
    }
    // Check the declared kind against the allowlist (spec §5.5: session
    // creation validates intended kind + declared size BEFORE reserving quota).
    const limits = kindLimits(kind)
    if (!limits) {
      respondJson(response, 400, { error: `kind not allowed: ${kind}` })
      return true
    }
    if (declaredBytes > limits.maxBytes) {
      respondJson(response, 400, {
        error: `declared ${declaredBytes} exceeds ${kind} limit ${limits.maxBytes}`
      })
      return true
    }
    // Video/audio capability-disabled before MEDIA_FFMPEG_PATH is configured
    // (spec §5.5 / T-B): refuse at session creation, never accept originals
    // and stall in processing.
    if (
      (kind === 'video' || kind === 'audio') &&
      !process.env.MEDIA_FFMPEG_PATH
    ) {
      respondJson(response, 503, { error: `${kind} upload capability-disabled (MEDIA_FFMPEG_PATH unset)` })
      return true
    }
    try {
      // Per-teacher concurrency cap (spec §9: 同时 2 个上传).
      if (ctx.uploads.activeCount(user.userId) >= 2) {
        respondJson(response, 429, { error: 'concurrent upload limit reached (max 2)' })
        return true
      }
      const session = ctx.uploads.create({
        id: randomUUID(),
        ownerId: user.userId,
        kind,
        declaredBytes
      })
      respondJson(response, 201, {
        id: session.id,
        uploadUrl: `/api/media/upload-sessions/${session.id}/upload`
      }, {
        'tus-max-size': String(session.declaredBytes),
        'upload-expires': session.expiresAt
      })
      return true
    } catch (err) {
      respondJson(response, 400, { error: err instanceof Error ? err.message : 'session creation failed' })
      return true
    }
  }

  // tus PATCH/HEAD on the session upload URL.
  const uploadMatch = pathname.match(
    /^\/api\/media\/upload-sessions\/([^/]+)\/upload$/
  )
  if (uploadMatch && (request.method === 'PATCH' || request.method === 'HEAD')) {
    const id = uploadMatch[1] as string
    const session = ctx.uploads.get(id)
    if (!session) {
      respondJson(response, 404, { error: 'upload session not found' })
      return true
    }
    if (session.ownerId !== user.userId && user.role !== 'admin') {
      respondJson(response, 403, { error: 'not your upload session' })
      return true
    }
    if (request.method === 'HEAD') {
      if (session.state === 'failed' || session.state === 'rejected') {
        respondJson(response, 410, { error: 'upload session closed' })
        return true
      }
      response.writeHead(200, {
        ...JSON_HEADERS,
        'upload-offset': String(session.receivedBytes)
      })
      response.end()
      return true
    }

    // PATCH: append one chunk.
    if (session.state !== 'uploading') {
      respondJson(response, 409, { error: `upload session not uploading (${session.state})` })
      return true
    }
    const offsetHeader = request.headers['upload-offset']
    const expectedOffset = String(session.receivedBytes)
    if (typeof offsetHeader === 'string' && offsetHeader !== expectedOffset) {
      respondJson(response, 409, {
        error: `upload-offset ${offsetHeader} does not match current offset ${expectedOffset}`
      })
      return true
    }
    const declared = session.declaredBytes
    const remaining = declared - session.receivedBytes
    const streamed = await storeChunk(ctx, session.id, request)
    if (!streamed) {
      respondJson(response, 400, { error: 'empty chunk' })
      return true
    }
    if (streamed > remaining) {
      // Chunk pushes the session past its declared budget: roll back by
      // discarding the whole temp file AND terminal-failing the session
      // (fail-closed, never accept the excess).
      void ctx.blobs.discardTemp(session.tempKey)
      ctx.uploads.markFailed(session.id)
      respondJson(response, 400, { error: 'chunk exceeds remaining declared bytes' })
      return true
    }
    try {
      ctx.uploads.recordReceived(session.id, streamed)
    } catch (err) {
      respondJson(response, 400, { error: err instanceof Error ? err.message : 'offset advance failed' })
      return true
    }
    const updated = ctx.uploads.get(id) as NonNullable<ReturnType<typeof ctx.uploads.get>>
    // Complete upload → quarantine + worker processes inline BEFORE the
    // response, so callers observe the terminal state (upload-then-use).
    // A slow scan stalls this request; v1 is single-process and payloads are
    // size-capped (image 25MiB / GLB 200MiB). Video jobs queue once ffmpeg
    // lands (capability-disabled today).
    let processError: string | null = null
    let blobHash: string | undefined
    if (updated.receivedBytes === updated.declaredBytes) {
      ctx.uploads.markQuarantined(id)
      const result = await ctx.processor.processUpload(id)
      blobHash = result.blobHash
      if (!result.ok) processError = result.reason ?? 'media processing failed'
    }
    if (processError) {
      respondJson(response, 422, { error: processError })
      return true
    }
    // tus checksum extension (spec §5.5:258): `Upload-Checksum: sha256 <b64>`.
    const checksumHeader = request.headers['upload-checksum']
    if (blobHash && typeof checksumHeader === 'string') {
      const m = checksumHeader.match(/^sha256[\t ]+([A-Za-z0-9+/=]+)$/)
      if (!m) {
        respondJson(response, 400, { error: 'only sha256 checksums supported' })
        return true
      }
      const expected = Buffer.from(m[1] as string, 'base64').toString('hex')
      if (expected !== blobHash) {
        respondJson(response, 460, { error: 'checksum mismatch' })
        return true
      }
    }
    const finalState = ctx.uploads.get(id)?.state
    response.writeHead(204, {
      'upload-offset': String(updated.receivedBytes),
      'x-upload-state': finalState ?? 'unknown',
      [SECURITY_WARNING_HEADER]: SECURITY_WARNING_VALUE
    })
    response.end()
    return true
  }

  // DELETE /api/media/upload-sessions/:id — cancel (owner).
  const cancelMatch = pathname.match(/^\/api\/media\/upload-sessions\/([^/]+)$/)
  if (request.method === 'DELETE' && cancelMatch) {
    const id = cancelMatch[1] as string
    const session = ctx.uploads.get(id)
    if (!session) {
      respondJson(response, 404, { error: 'upload session not found' })
      return true
    }
    if (session.ownerId !== user.userId && user.role !== 'admin') {
      respondJson(response, 403, { error: 'not your upload session' })
      return true
    }
    // Idempotent cancel: terminal sessions (ready/rejected/failed) respond 204
    // without touching state again — transition would throw.
    try {
      ctx.uploads.cancel(id)
      void ctx.blobs.discardTemp(session.tempKey)
    } catch {
      // already terminal — idempotent
    }
    response.writeHead(204, { [SECURITY_WARNING_HEADER]: SECURITY_WARNING_VALUE })
    response.end()
    return true
  }

  // GET /api/media/blobs/:hash — CAS stream with Range (spec §5.5 / §6.1).
  const blobMatch = pathname.match(/^\/api\/media\/blobs\/([a-f0-9]{64})$/)
  if (request.method === 'GET' && blobMatch) {
    const hash = blobMatch[1] as string
    const stat = await ctx.blobs.stat(hash)
    if (!stat) {
      respondNotFoundBlob(response, hash)
      return true
    }
    const len = stat.byteSize
    const rangeHeader = request.headers.range
    let start = 0
    let end = len - 1
    let status = 200
    if (typeof rangeHeader === 'string') {
      const parsed = parseRange(rangeHeader, len)
      if (parsed === null) {
        // 416 with Content-Range: bytes */len
        response.writeHead(416, {
          ...JSON_HEADERS,
          'content-range': `bytes */${len}`,
          'etag': `"${hash}"`,
          'accept-ranges': 'bytes'
        })
        response.end()
        return true
      }
      start = parsed.start
      end = parsed.end
      status = 206
    }
    const stream = await ctx.blobs.open(hash, { start, end })
    const isPublic = requestUrl.searchParams.get('public') === '1'
    response.writeHead(status, {
      'content-type': mediaTypeForExt(stat.storageKey),
      'content-length': String(end - start + 1),
      'accept-ranges': 'bytes',
      // content-range only for partial responses; omit wholly otherwise (Node
      // rejects undefined header values).
      ...(status === 206
        ? { 'content-range': `bytes ${String(start)}-${String(end)}/${String(len)}` }
        : {}),
      'etag': `"${hash}"`,
      'x-content-type-options': 'nosniff',
      // Private content (student-scoped) must not be cached; public derivative
      // URLs are content-addressed and immutable (spec §5.5:456).
      'cache-control': isPublic
        ? 'public, max-age=31536000, immutable'
        : 'private, no-store',
      [SECURITY_WARNING_HEADER]: SECURITY_WARNING_VALUE
    })
    stream.pipe(response)
    stream.on('error', () => response.destroy())
    return true
  }

  return false
}

/** Stream request bytes into the session temp file, returning count. */
async function storeChunk(
  ctx: MediaRouteContext,
  sessionId: string,
  request: IncomingMessage
): Promise<number | null> {
  return ctx.blobs.appendQuarantined(sessionId, request)
}

function parseRange(header: string, len: number): { start: number; end: number } | null {
  const m = header.match(/^bytes=(\d*)-(\d*)$/)
  if (!m) return null
  let start = m[1] === '' ? -1 : Number(m[1])
  const rawEnd = m[2] === '' ? -1 : Number(m[2])
  if (Number.isNaN(start) || Number.isNaN(rawEnd)) return null
  if (start === -1 && rawEnd === -1) return null
  if (start === -1) {
    // suffix range: last N bytes
    start = Math.max(0, len - rawEnd)
    return { start, end: len - 1 }
  }
  if (start >= len) return null
  let end = rawEnd === -1 ? len - 1 : Math.min(rawEnd, len - 1)
  if (end < start) end = start
  return { start, end }
}

function mediaTypeForExt(storageKey: string): string {
  if (storageKey.endsWith('.png')) return 'image/png'
  if (storageKey.endsWith('.jpg') || storageKey.endsWith('.jpeg')) return 'image/jpeg'
  if (storageKey.endsWith('.webp')) return 'image/webp'
  if (storageKey.endsWith('.gif')) return 'image/gif'
  if (storageKey.endsWith('.glb')) return 'model/gltf-binary'
  if (storageKey.endsWith('.mp4')) return 'video/mp4'
  if (storageKey.endsWith('.webm')) return 'video/webm'
  if (storageKey.endsWith('.vtt')) return 'text/vtt'
  return 'application/octet-stream'
}

function respondNotFoundBlob(response: ServerResponse, hash: string): void {
  response.writeHead(404, JSON_HEADERS)
  response.end(JSON.stringify({ error: `blob not found: ${hash}` }))
}

function readJsonBody(request: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    let size = 0
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer | string) => {
      size += Buffer.byteLength(chunk)
      if (size > MAX_JSON_BODY) {
        resolve(null)
        request.destroy()
        return
      }
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', () => resolve(null))
  })
}