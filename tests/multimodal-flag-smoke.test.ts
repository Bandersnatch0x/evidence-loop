// @vitest-environment node

import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuditStore } from '../server/audit/AuditStore'
import { createEvidenceLoopServer } from '../server/index'

/**
 * Feature-flag smoke test (ADR-0005 §8 red line): with MULTIMODAL_ENABLED
 * off, every pre-Phase-1 API must behave exactly as before, and every
 * /api/multimodal/* route must fall back to 503 + X-Feature-Disabled. The
 * frontend must not mount <VoiceCompanion>/<OverlayLayer> either.
 *
 * The server half boots a real HTTP server with the flag unset; the frontend
 * half asserts the App gate reacts to the flag via the mocked isMultimodalEnabled.
 */

describe('MULTIMODAL_ENABLED=false — server APIs unchanged', () => {
  let server: Awaited<ReturnType<typeof createEvidenceLoopServer>>
  let baseUrl: string
  const originalFlag = process.env.MULTIMODAL_ENABLED

  beforeEach(async () => {
    delete process.env.MULTIMODAL_ENABLED
    server = await createEvidenceLoopServer({
      dataFile: ':memory:',
      auditStore: new AuditStore({
        dbPath: ':memory:',
        hmacSecret: 'multimodal-flag-smoke-hmac'
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

  it('serves /api/health unchanged', async () => {
    const response = await fetch(`${baseUrl}/api/health`)

    expect(response.status).toBe(200)
    expect(response.headers.get('x-feature-disabled')).toBeNull()
    await expect(response.json()).resolves.toMatchObject({
      status: 'ok',
      runner: 'python-subprocess'
    })
  })

  it('runs the evidence scoring loop on /api/evaluations unchanged', async () => {
    const response = await fetch(`${baseUrl}/api/evaluations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        assignmentId: 'python-average',
        code: 'def calculate_average(scores):\n    if not scores:\n        return 0\n    return sum(scores) / len(scores)'
      })
    })

    expect(response.status).toBe(201)
    const body = (await response.json()) as { status: string; score: number }
    expect(body.status).toBe('completed')
    expect(body.score).toBe(100)
  })

  it('serves /api/cohort for teachers unchanged', async () => {
    const response = await fetch(`${baseUrl}/api/cohort`, {
      headers: { 'x-demo-role': 'teacher' }
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as { cohortName: string }
    expect(typeof body.cohortName).toBe('string')
  })

  it('serves /api/mastery/:studentId unchanged (empty profile)', async () => {
    const response = await fetch(`${baseUrl}/api/mastery/anon-student`, {
      headers: { 'x-demo-role': 'teacher' }
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({})
  })

  it('returns 503 + X-Feature-Disabled for every /api/multimodal/* route', async () => {
    const ask = await fetch(`${baseUrl}/api/multimodal/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '看看这道题' })
    })
    expect(ask.status).toBe(503)
    expect(ask.headers.get('x-feature-disabled')).toBe('multimodal')
    // Flag-off path must not advertise a voice modality mode.
    expect(ask.headers.get('x-modality-mode')).toBeNull()

    const sttStart = await fetch(`${baseUrl}/api/multimodal/stt/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    })
    expect(sttStart.status).toBe(503)
    expect(sttStart.headers.get('x-feature-disabled')).toBe('multimodal')

    const sttFinalize = await fetch(`${baseUrl}/api/multimodal/stt/finalize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'hello' })
    })
    expect(sttFinalize.status).toBe(503)
    expect(sttFinalize.headers.get('x-feature-disabled')).toBe('multimodal')
  })

  it('does not write voice audit events when multimodal is disabled', async () => {
    await fetch(`${baseUrl}/api/multimodal/ask`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-demo-role': 'student'
      },
      body: JSON.stringify({ text: 'flag off should not audit voice' })
    })

    // Flag-off ask must not enqueue modality:voice (teacher audit would expose it).
    const teacherAudit = await fetch(
      `${baseUrl}/api/audit?studentId=learner-demo`,
      { headers: { 'x-demo-role': 'teacher' } }
    )
    expect(teacherAudit.status).toBe(200)
    const records = (await teacherAudit.json()) as Array<{
      modality?: string | null
      resourceId?: string | null
    }>
    expect(
      records.some(
        (row) =>
          row.modality === 'voice' && row.resourceId === 'multimodal-ask'
      )
    ).toBe(false)
  })
})

describe('MULTIMODAL_ENABLED=false — frontend does not mount multimodal UI', () => {
  afterEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
  })

  it('isMultimodalEnabled() is false without VITE_MULTIMODAL_ENABLED, so App gates VoiceCompanion/OverlayLayer', async () => {
    vi.stubEnv('VITE_MULTIMODAL_ENABLED', '')
    const { isMultimodalEnabled } = await import('../src/config/features')

    // The App renders <VoiceCompanion/>/<OverlayLayer/> only when this is true
    // (see src/App.tsx). With the flag off the branch is dead, so the
    // multimodal UI never mounts on the pre-Phase-1 stable loop.
    // Mount-level assertion lives in tests/App.test.tsx (jsdom).
    expect(isMultimodalEnabled()).toBe(false)
  })
})
