// @vitest-environment node

import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AuditStore } from '../server/audit/AuditStore'
import { createEvidenceLoopServer } from '../server/index'
import { parseDirectives } from '../shared/protocol/multimodalDirective'

describe('POST /api/multimodal/ask', () => {
  let server: Awaited<ReturnType<typeof createEvidenceLoopServer>>
  let baseUrl: string
  const originalFlag = process.env.MULTIMODAL_ENABLED

  beforeEach(async () => {
    delete process.env.MULTIMODAL_ENABLED
    server = await createEvidenceLoopServer({
      dataFile: ':memory:',
      auditStore: new AuditStore({
        dbPath: ':memory:',
        hmacSecret: 'multimodal-ask-test-hmac'
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
  })

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
    if (originalFlag === undefined) {
      delete process.env.MULTIMODAL_ENABLED
    } else {
      process.env.MULTIMODAL_ENABLED = originalFlag
    }
  })

  it('responds 503 with X-Feature-Disabled when the flag is off', async () => {
    const response = await fetch(`${baseUrl}/api/multimodal/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '看看这道题' })
    })

    expect(response.status).toBe(503)
    expect(response.headers.get('x-feature-disabled')).toBe('multimodal')
  })

  it('returns a parseable dual-channel llmOutput when enabled', async () => {
    process.env.MULTIMODAL_ENABLED = 'true'
    const response = await fetch(`${baseUrl}/api/multimodal/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '看看这道题' })
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('x-modality-mode')).toBe('voice')
    const body = (await response.json()) as {
      llmOutput: string
      temperature: number
    }
    const parsed = parseDirectives(body.llmOutput)

    expect(parsed.spokenText.length).toBeGreaterThan(0)
    expect(body.temperature).toBeGreaterThanOrEqual(0.2)
    expect(body.temperature).toBeLessThanOrEqual(0.3)
    expect(parsed.directives).toEqual(
      expect.arrayContaining([
        { kind: 'speak', text: 'x 的平方加 3' },
        { kind: 'display', text: 'x^2+3' },
        {
          kind: 'highlight',
          selector: '[data-katex-id="math-1-step-2"]'
        }
      ])
    )
  })

  it('rejects an empty text body with 400 regardless of the flag', async () => {
    const response = await fetch(`${baseUrl}/api/multimodal/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '' })
    })

    expect(response.status).toBe(400)
  })
})
