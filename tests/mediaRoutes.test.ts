// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createEvidenceRingServer } from '../server/index'
import { AuditStore } from '../server/audit/AuditStore'
import { hashMediaBytes } from '../server/media/paths'

/**
 * T-B slice 5 — media HTTP endpoints (spec §5.5):
 *   POST /api/media/upload-sessions   create session (teacher, quota in-tx)
 *   PATCH /api/media/upload-sessions/:id/upload  tus chunked upload
 *   HEAD  /api/media/upload-sessions/:id/upload  resume offset
 *   GET   /api/media/blobs/:hash      stream with Range (206/416)
 *   DELETE /api/media/upload-sessions/:id       cancel + release quota
 */

const SECRET = 'media-routes-hmac'
const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Real PNG payload (signature + IHDR) that passes the v1 parse gate. */
const REAL_PNG: Buffer = (() => {
  const ihdr = Buffer.alloc(26)
  PNG_HEAD.copy(ihdr, 0)
  ihdr.writeUInt32BE(13, 8)
  ihdr.write('IHDR', 12, 'ascii')
  ihdr.writeUInt32BE(64, 16)
  ihdr.writeUInt32BE(64, 20)
  ihdr[24] = 8
  ihdr[25] = 6
  return Buffer.concat([ihdr, Buffer.alloc(8)]) // 8 bytes of payload after IHDR
})()

describe('media routes', () => {
  let server: Awaited<ReturnType<typeof createEvidenceRingServer>>
  let baseUrl: string
  let dataRoot: string

  beforeEach(async () => {
    // dev gate: non-prod + MEDIA_DISABLE_SCAN=1 → pass-through scanner.
    process.env.MEDIA_DISABLE_SCAN = '1'
    dataRoot = await mkdtemp(join(tmpdir(), 'media-routes-'))
    const audit = new AuditStore({
      dbPath: ':memory:',
      hmacSecret: SECRET,
      flushIntervalMs: 60_000
    })
    server = await createEvidenceRingServer({
      dataFile: ':memory:',
      auditStore: audit,
      auditHmacSecret: SECRET,
      memoryDbPath: ':memory:',
      productDbPath: ':memory:',
      mediaDataRoot: dataRoot
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${String(address.port)}`
  })

  afterEach(async () => {
    delete process.env.MEDIA_DISABLE_SCAN
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  })

  async function createSession(
    kind: string,
    declaredBytes: number
  ): Promise<{ id: string; uploadUrl: string }> {
    const res = await fetch(`${baseUrl}/api/media/upload-sessions`, {
      method: 'POST',
      headers: {
        'x-demo-role': 'teacher',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ kind, declaredBytes })
    })
    expect(res.status).toBe(201)
    expect(res.headers.get('tus-max-size')).toBe(String(declaredBytes))
    const body = (await res.json()) as { id: string; uploadUrl: string }
    return body
  }

  it('creates a session and streams a full upload via tus PATCH', async () => {
    const payload = REAL_PNG
    const { id, uploadUrl } = await createSession('image', payload.length)
    expect(uploadUrl).toContain('/api/media/upload-sessions/')

    const patch = await fetch(`${baseUrl}${uploadUrl}`, {
      method: 'PATCH',
      headers: {
        'x-demo-role': 'teacher',
        'upload-offset': '0',
        'content-type': 'application/offset+octet-stream'
      },
      body: payload
    })
    expect(patch.status).toBe(204)
    expect(patch.headers.get('upload-offset')).toBe(String(payload.length))

    // Session reached ready (worker ran inline on completion) and the blob is
    // addressable over HTTP with Range support.
    const hash = hashMediaBytes(payload)
    const range = await fetch(`${baseUrl}/api/media/blobs/${hash}`, {
      headers: { range: 'bytes=0-7' }
    })
    expect(range.status).toBe(206)
    expect(range.headers.get('accept-ranges')).toBe('bytes')
    expect(range.headers.get('etag')).toBe(`"${hash}"`)
    expect(range.headers.get('x-content-type-options')).toBe('nosniff')
    const body = Buffer.from(await range.arrayBuffer())
    expect(body.equals(PNG_HEAD)).toBe(true)
    void id
  })

  it('supports resume: HEAD returns Upload-Offset after a partial PATCH', async () => {
    const payload = Buffer.concat([REAL_PNG, Buffer.from('chunked-payload')])
    const splitAt = 6
    const { uploadUrl } = await createSession('image', payload.length)

    const first = await fetch(`${baseUrl}${uploadUrl}`, {
      method: 'PATCH',
      headers: {
        'x-demo-role': 'teacher',
        'upload-offset': '0',
        'content-type': 'application/offset+octet-stream'
      },
      body: payload.subarray(0, splitAt)
    })
    expect(first.status).toBe(204)
    expect(first.headers.get('upload-offset')).toBe(String(splitAt))

    const head = await fetch(`${baseUrl}${uploadUrl}`, {
      method: 'HEAD',
      headers: { 'x-demo-role': 'teacher' }
    })
    expect(head.status).toBe(200)
    expect(head.headers.get('upload-offset')).toBe(String(splitAt))

    const second = await fetch(`${baseUrl}${uploadUrl}`, {
      method: 'PATCH',
      headers: {
        'x-demo-role': 'teacher',
        'upload-offset': String(splitAt),
        'content-type': 'application/offset+octet-stream'
      },
      body: payload.subarray(splitAt)
    })
    expect(second.status).toBe(204)
    expect(second.headers.get('upload-offset')).toBe(String(payload.length))

    const hash = hashMediaBytes(payload)
    const full = await fetch(`${baseUrl}/api/media/blobs/${hash}`)
    expect(full.status).toBe(200)
    const body = Buffer.from(await full.arrayBuffer())
    expect(body.equals(payload)).toBe(true)
  })

  it('rejects students with 403 on session creation', async () => {
    const res = await fetch(`${baseUrl}/api/media/upload-sessions`, {
      method: 'POST',
      headers: {
        'x-demo-role': 'student',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ kind: 'image', declaredBytes: 10 })
    })
    expect(res.status).toBe(403)
  })

  it('rejects over-declared payload during PATCH', async () => {
    const { uploadUrl } = await createSession('image', 4)
    const res = await fetch(`${baseUrl}${uploadUrl}`, {
      method: 'PATCH',
      headers: {
        'x-demo-role': 'teacher',
        'upload-offset': '0',
        'content-type': 'application/offset+octet-stream'
      },
      body: Buffer.from('0123456789')
    })
    expect(res.status).toBe(400)
  })

  it('cancels a session via DELETE and releases quota', async () => {
    const { id, uploadUrl } = await createSession('image', 8)
    const del = await fetch(`${baseUrl}/api/media/upload-sessions/${id}`, {
      method: 'DELETE',
      headers: { 'x-demo-role': 'teacher' }
    })
    expect(del.status).toBe(204)
    // Session is now terminal — HEAD on it returns 410.
    const head = await fetch(`${baseUrl}${uploadUrl}`, {
      method: 'HEAD',
      headers: { 'x-demo-role': 'teacher' }
    })
    expect(head.status).toBe(410)
  })

  it('returns 416 for an out-of-range request', async () => {
    // Upload a small blob first.
    const payload = REAL_PNG
    const { uploadUrl } = await createSession('image', payload.length)
    await fetch(`${baseUrl}${uploadUrl}`, {
      method: 'PATCH',
      headers: {
        'x-demo-role': 'teacher',
        'upload-offset': '0',
        'content-type': 'application/offset+octet-stream'
      },
      body: payload
    })
    const hash = hashMediaBytes(payload)
    const res = await fetch(`${baseUrl}/api/media/blobs/${hash}`, {
      headers: { range: `bytes=99999-100000` }
    })
    expect(res.status).toBe(416)
  })
})