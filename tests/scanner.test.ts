// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { Readable } from 'node:stream'
import {
  ClamAVScanner,
  DevPassThroughScanner,
  FailClosedScanner,
  createScanner
} from '../server/media/Scanner'

/**
 * T-B slice 4a — Scanner seam. Decision (subagent, brief-scan-decision):
 * ship clamd with the single-node deployment; scan_result fail-closed keeps
 * quarantined and never publishes (spec §5.5 / research §5.1.3).
 */

async function collect(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

describe('FailClosedScanner (default when no clamd)', () => {
  it('returns fail_closed without touching the payload', async () => {
    const scanner = new FailClosedScanner('clamd not configured')
    const result = await scanner.scan(Readable.from(['x'.repeat(1024)]), 1024)
    expect(result.status).toBe('fail_closed')
    expect(result.reason).toMatch(/not configured/)
  })
})

describe('DevPassThroughScanner (non-prod dev gate)', () => {
  it('always returns clean and drains the stream', async () => {
    const scanner = new DevPassThroughScanner()
    const stream = Readable.from(['hello-scan'])
    const result = await scanner.scan(stream, 10)
    expect(result.status).toBe('clean')
    // Stream consumed (MediaProcessor re-hashes by streaming through scanner).
    expect(await collect(stream)).toHaveLength(0)
  })
})

describe('createScanner factory', () => {
  it('non-prod without MEDIA_DISABLE_SCAN => FailClosedScanner', () => {
    const s = createScanner({ NODE_ENV: 'test' })
    expect(s).toBeInstanceOf(FailClosedScanner)
  })

  it('non-prod with MEDIA_DISABLE_SCAN=1 => DevPassThroughScanner', () => {
    const s = createScanner({ NODE_ENV: 'test', MEDIA_DISABLE_SCAN: '1' })
    expect(s).toBeInstanceOf(DevPassThroughScanner)
  })

  it('prod without clamd config => FailClosedScanner (no silent bypass)', () => {
    const s = createScanner({ NODE_ENV: 'production' })
    expect(s).toBeInstanceOf(FailClosedScanner)
  })

  it('prod with clamd config => ClamAVScanner', () => {
    const s = createScanner({
      NODE_ENV: 'production',
      MEDIA_CLAMD_HOST: '127.0.0.1',
      MEDIA_CLAMD_PORT: '3310'
    })
    expect(s).toBeInstanceOf(ClamAVScanner)
  })

  it('prod with MEDIA_DISABLE_SCAN=1 is ignored (prod never bypasses)', () => {
    const s = createScanner({
      NODE_ENV: 'production',
      MEDIA_DISABLE_SCAN: '1'
    })
    expect(s).toBeInstanceOf(FailClosedScanner)
  })
})