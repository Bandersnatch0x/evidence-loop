// @vitest-environment node
/** httpUtils — shared transport helpers (C5 deepening, #35). */
import { describe, it, expect } from 'vitest'
import type { IncomingMessage } from 'node:http'
import {
  HttpError,
  respondJson,
  readJsonBody,
  JSON_HEADERS,
  maxRequestBodyBytes
} from '../server/http/httpUtils'

describe('respondJson', () => {
  it('writes JSON with the security-warning header', () => {
    const chunks: Buffer[] = []
    const headers: Record<string, unknown> = {}
    const response = {
      writeHead: (status: number, h: Record<string, string>) => {
        headers.status = status
        headers.meta = h
      },
      end: (body: string) => { chunks.push(Buffer.from(body)) }
    } as never

    respondJson(response, 200, { ok: true })
    const status = headers.status as number
    const meta = headers.meta as Record<string, string>
    expect(status).toBe(200)
    expect(meta['content-type']).toBe('application/json; charset=utf-8')
    expect(meta['cache-control']).toBe('no-store')
    expect(meta['X-Security-Warning']).toBeTruthy()
    expect(JSON.parse(chunks.join(''))).toEqual({ ok: true })
  })

  it('merges extra headers over the defaults', () => {
    const meta: Record<string, string> = {}
    const response = {
      writeHead: (_s: number, h: Record<string, string>) => { Object.assign(meta, h) },
      end: () => {}
    } as never
    respondJson(response, 200, {}, { 'cache-control': 'public, max-age=60' })
    expect(meta['cache-control']).toBe('public, max-age=60')
  })
})

describe('readJsonBody', () => {
  function makeRequest(body: string, contentLength?: number): IncomingMessage {
    // Build a minimal readable stream that yields the body.
    const stream = new (require('node:stream').Readable)() as IncomingMessage
    stream.push(body)
    stream.push(null)
    ;(stream as { headers?: Record<string, string | undefined> }).headers = {
      'content-length': contentLength !== undefined ? String(contentLength) : undefined
    }
    return stream
  }

  it('parses a JSON object body', async () => {
    const body = await readJsonBody(makeRequest('{"a":1}'))
    expect(body).toEqual({ a: 1 })
  })

  it('returns {} for an empty body', async () => {
    expect(await readJsonBody(makeRequest(''))).toEqual({})
  })

  it('rejects malformed JSON with 400', async () => {
    await expect(readJsonBody(makeRequest('{oops'))).rejects.toThrow(HttpError)
    await expect(readJsonBody(makeRequest('{oops'))).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects an oversized body with 413', async () => {
    const big = 'x'.repeat(maxRequestBodyBytes + 1)
    await expect(readJsonBody(makeRequest(big, big.length))).rejects.toMatchObject({ statusCode: 413 })
  })
})

describe('HttpError + JSON_HEADERS', () => {
  it('HttpError carries a status code', () => {
    const err = new HttpError(404, 'nope')
    expect(err.statusCode).toBe(404)
    expect(err.message).toBe('nope')
  })

  it('JSON_HEADERS includes the security warning', () => {
    expect(JSON_HEADERS['X-Security-Warning']).toBeTruthy()
  })
})