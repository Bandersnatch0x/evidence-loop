// @vitest-environment node

import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AuditStore } from '../server/audit/AuditStore'
import { createEvidenceLoopServer } from '../server/index'

/**
 * Ticket 021 — multimodal compliance + teacher metadata view.
 * Covers: voice audit modality metadata (no transcript), response header,
 * teacher-only usage aggregation, and student privacy boundaries.
 */
describe('multimodal compliance (021)', () => {
  let server: Awaited<ReturnType<typeof createEvidenceLoopServer>>
  let baseUrl: string
  let audit: AuditStore
  const originalFlag = process.env.MULTIMODAL_ENABLED

  beforeEach(async () => {
    process.env.MULTIMODAL_ENABLED = 'true'
    audit = new AuditStore({
      dbPath: ':memory:',
      hmacSecret: 'multimodal-compliance-hmac',
      flushIntervalMs: 60_000,
      flushBatchSize: 100
    })
    server = await createEvidenceLoopServer({
      dataFile: ':memory:',
      auditStore: audit,
      auditHmacSecret: 'multimodal-compliance-hmac'
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

  function headers(role: string, extra?: Record<string, string>): HeadersInit {
    return {
      'x-demo-role': role,
      ...extra
    }
  }

  it('writes modality:voice audit metadata without transcript content', async () => {
    const secretPhrase = '哪里错了我是张三手机13800138000'
    const response = await fetch(`${baseUrl}/api/multimodal/ask`, {
      method: 'POST',
      headers: {
        ...headers('student'),
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        text: secretPhrase,
        durationMs: 2400
      })
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('x-modality-mode')).toBe('voice')

    await audit.flush()
    const logs = await audit.query({ limit: 50 })
    const voiceLog = logs.find((entry) => entry.modality === 'voice')
    expect(voiceLog).toBeDefined()
    if (voiceLog === undefined) {
      throw new Error('expected a voice audit event')
    }

    expect(voiceLog.studentId).toBe('learner-demo')
    expect(voiceLog.resourceId).toBe('multimodal-ask')
    expect(voiceLog.metadata).toMatchObject({
      durationMs: 2400,
      transcriptChars: secretPhrase.length
    })
    expect(typeof voiceLog.metadata?.piiHitCount).toBe('number')
    expect(Number(voiceLog.metadata?.piiHitCount)).toBeGreaterThan(0)

    // Hard privacy: full audit payload must not contain the transcript body.
    const serialized = JSON.stringify(voiceLog)
    expect(serialized).not.toContain(secretPhrase)
    expect(serialized).not.toContain('哪里错了')
    expect(serialized).not.toContain('13800138000')
    expect(serialized).not.toMatch(/"transcript"\s*:/)
  })

  it('exposes teacher multimodal usage aggregation as counts only', async () => {
    await fetch(`${baseUrl}/api/multimodal/ask`, {
      method: 'POST',
      headers: {
        ...headers('student'),
        'content-type': 'application/json'
      },
      body: JSON.stringify({ text: '帮我看看边界条件', durationMs: 1000 })
    })

    const studentDenied = await fetch(
      `${baseUrl}/api/cohort/multimodal-usage?classId=july-cohort`,
      { headers: headers('student') }
    )
    expect(studentDenied.status).toBe(403)

    const teacherOk = await fetch(
      `${baseUrl}/api/cohort/multimodal-usage?classId=july-cohort`,
      { headers: headers('teacher') }
    )
    expect(teacherOk.status).toBe(200)
    const usage = (await teacherOk.json()) as Array<{
      studentId: string
      voiceCount: number
      lastVoiceAt: string
      transcript?: string
      text?: string
    }>
    expect(usage.some((row) => row.studentId === 'learner-demo')).toBe(true)
    for (const row of usage) {
      expect(row.voiceCount).toBeGreaterThan(0)
      expect(typeof row.lastVoiceAt).toBe('string')
      expect(row.transcript).toBeUndefined()
      expect(row.text).toBeUndefined()
    }
    expect(JSON.stringify(usage)).not.toContain('帮我看看边界条件')
  })

  it('blocks students from reading other learners transcript content via audit API', async () => {
    // Seed a voice event for learner-demo (student role maps to this id).
    await fetch(`${baseUrl}/api/multimodal/ask`, {
      method: 'POST',
      headers: {
        ...headers('student'),
        'content-type': 'application/json'
      },
      body: JSON.stringify({ text: '第二段哪里可以改进？' })
    })

    const studentAudit = await fetch(`${baseUrl}/api/audit`, {
      headers: headers('student')
    })
    expect(studentAudit.status).toBe(403)

    // Even teachers only receive sanitized metadata — never the free-text body.
    const teacherAudit = await fetch(
      `${baseUrl}/api/audit?studentId=learner-demo`,
      { headers: headers('teacher') }
    )
    expect(teacherAudit.status).toBe(200)
    const bodyText = await teacherAudit.text()
    expect(bodyText).not.toContain('第二段哪里可以改进')
    const records = JSON.parse(bodyText) as Array<{
      modality?: string | null
      metadata?: Record<string, unknown> | null
      studentId?: string | null
    }>
    const voice = records.find((row) => row.modality === 'voice')
    expect(voice).toBeDefined()
    expect(voice?.metadata).toBeDefined()
    expect(voice?.metadata?.transcript).toBeUndefined()
    expect(voice?.metadata?.text).toBeUndefined()
  })

  it('requires classId on multimodal-usage and never writes raw audio paths', async () => {
    const missing = await fetch(`${baseUrl}/api/cohort/multimodal-usage`, {
      headers: headers('teacher')
    })
    expect(missing.status).toBe(400)

    await fetch(`${baseUrl}/api/multimodal/ask`, {
      method: 'POST',
      headers: {
        ...headers('student'),
        'content-type': 'application/json'
      },
      body: JSON.stringify({ text: '第 3 步为什么错？', durationMs: 900 })
    })
    await audit.flush()
    const logs = await audit.query({ limit: 20 })
    for (const entry of logs) {
      const blob = JSON.stringify(entry)
      expect(blob).not.toMatch(/\.wav|\.webm|\.mp3|audioPath|rawAudio/i)
    }
  })
})
