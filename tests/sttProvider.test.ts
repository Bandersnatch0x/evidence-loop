// @vitest-environment node

import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AuditStore } from '../server/audit/AuditStore'
import { createEvidenceLoopServer } from '../server/index'
import { AliyunSTTProvider } from '../server/stt/AliyunSTTProvider'
import { createSTTProvider } from '../server/stt/createSTTProvider'
import { MockSTTProvider } from '../server/stt/MockSTTProvider'
import { resolveSTTProviderName } from '../server/stt/STTProvider'
import { WebSpeechSTTProvider } from '../server/stt/WebSpeechSTTProvider'

describe('STT providers', () => {
  it('defaults to webspeech when STT_PROVIDER is unset or unknown', () => {
    expect(resolveSTTProviderName({})).toBe('webspeech')
    expect(resolveSTTProviderName({ STT_PROVIDER: 'nope' })).toBe('webspeech')
    expect(resolveSTTProviderName({ STT_PROVIDER: 'aliyun' })).toBe('aliyun')
    expect(resolveSTTProviderName({ STT_PROVIDER: 'mock' })).toBe('mock')
  })

  it('WebSpeechSTTProvider returns a local sentinel endpoint (browser fallback)', async () => {
    const provider = new WebSpeechSTTProvider()
    const result = await provider.startSession({ language: 'zh-CN' })
    expect(result.provider).toBe('webspeech')
    expect(result.endpoint).toBe('webspeech://local')
    expect(result.note).toMatch(/Web Speech/i)
  })

  it('AliyunSTTProvider rejects when credentials are missing', async () => {
    const provider = new AliyunSTTProvider({}, {})
    await expect(provider.startSession({})).rejects.toThrow(/ALIYUN_NLS/)
  })

  it('AliyunSTTProvider returns a gateway WebSocket URL when configured', async () => {
    const provider = new AliyunSTTProvider({
      appKey: 'test-app-key',
      token: 'test-token',
      gatewayUrl: 'wss://nls-gateway.example/ws/v1'
    })
    const result = await provider.startSession({ language: 'zh-CN' })
    expect(result.provider).toBe('aliyun')
    expect(result.endpoint).toContain('wss://nls-gateway.example/ws/v1')
    expect(result.endpoint).toContain('token=test-token')
    expect(result.sessionToken).toBe('test-app-key')
  })

  it('MockSTTProvider supports start failure and empty transcript boundaries', async () => {
    const failing = new MockSTTProvider({ failStart: true })
    await expect(failing.startSession({})).rejects.toThrow(/start failed/)

    const ok = new MockSTTProvider({ transcript: '  讲解平方  ' })
    const started = await ok.startSession({ sessionId: 's1' })
    expect(started.provider).toBe('mock')
    expect(started.endpoint).toBe('mock://stt')

    const finalized = await ok.finalizeTranscript({ text: 'ignored' })
    expect(finalized.text).toBe('讲解平方')

    const empty = new MockSTTProvider()
    await expect(empty.finalizeTranscript({ text: '   ' })).rejects.toThrow(
      /empty/
    )
  })

  it('createSTTProvider selects the configured implementation', () => {
    expect(createSTTProvider({ STT_PROVIDER: 'webspeech' }).name).toBe(
      'webspeech'
    )
    expect(createSTTProvider({ STT_PROVIDER: 'mock' }).name).toBe('mock')
    expect(createSTTProvider({ STT_PROVIDER: 'aliyun' }).name).toBe('aliyun')
  })
})

describe('POST /api/multimodal/stt/*', () => {
  let server: Awaited<ReturnType<typeof createEvidenceLoopServer>>
  let baseUrl: string
  const originalFlag = process.env.MULTIMODAL_ENABLED
  const originalProvider = process.env.STT_PROVIDER

  beforeEach(async () => {
    delete process.env.MULTIMODAL_ENABLED
    process.env.STT_PROVIDER = 'mock'
    server = await createEvidenceLoopServer({
      dataFile: ':memory:',
      auditStore: new AuditStore({
        dbPath: ':memory:',
        hmacSecret: 'stt-api-test-hmac'
      }),
      sttProvider: new MockSTTProvider()
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
    if (originalProvider === undefined) {
      delete process.env.STT_PROVIDER
    } else {
      process.env.STT_PROVIDER = originalProvider
    }
  })

  it('responds 503 when multimodal is disabled', async () => {
    const response = await fetch(`${baseUrl}/api/multimodal/stt/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    })
    expect(response.status).toBe(503)
    expect(response.headers.get('x-feature-disabled')).toBe('multimodal')
  })

  it('returns a mock endpoint when enabled (Web Speech fallback path stays available)', async () => {
    process.env.MULTIMODAL_ENABLED = 'true'
    const response = await fetch(`${baseUrl}/api/multimodal/stt/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ language: 'zh-CN' })
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      provider: string
      endpoint: string
    }
    expect(body.provider).toBe('mock')
    expect(body.endpoint).toBe('mock://stt')
  })

  it('rejects finalize transcripts that contain PII', async () => {
    process.env.MULTIMODAL_ENABLED = 'true'
    const response = await fetch(`${baseUrl}/api/multimodal/stt/finalize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '我是张三，学号 20190567' })
    })
    expect(response.status).toBe(422)
    const body = (await response.json()) as {
      error: string
      piiDetected: boolean
    }
    expect(body.piiDetected).toBe(true)
    expect(body.error).toMatch(/个人身份信息|中文姓名|学号/)
  })

  it('accepts a clean finalize transcript', async () => {
    process.env.MULTIMODAL_ENABLED = 'true'
    const response = await fetch(`${baseUrl}/api/multimodal/stt/finalize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '请讲解平方项' })
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      text: string
      piiDetected: boolean
      provider: string
    }
    expect(body.text).toBe('请讲解平方项')
    expect(body.piiDetected).toBe(false)
    expect(body.provider).toBe('mock')
  })
})
