// @vitest-environment node

import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AuditStore } from '../server/audit/AuditStore'
import { createEvidenceRingServer } from '../server/index'

/**
 * Route-wiring smoke test.
 *
 * Proves the 7 delegated module routers (auth / questions / tutoring / import /
 * adaptive / student / teacher) are actually mounted in server/index.ts — i.e.
 * they respond with their own status codes rather than the main router's 404.
 * This guards against the波次1-3 regression where handle*Api existed but were
 * never wired into handleApi.
 */
const SECRET = 'route-wiring-hmac'

describe('module route wiring', () => {
  let server: Awaited<ReturnType<typeof createEvidenceRingServer>>
  let baseUrl: string

  beforeEach(async () => {
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
      productDbPath: ':memory:'
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${String(address.port)}`
  })

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  })

  it('mounts auth routes (register returns 201, not 404)', async () => {
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'wiring-teacher@test.dev',
        password: 'password-123',
        displayName: '接线老师'
      })
    })
    expect(response.status).toBe(201)
  })

  it('mounts question bank routes (teacher list returns 200)', async () => {
    const response = await fetch(`${baseUrl}/api/questions`, {
      headers: { 'x-demo-role': 'teacher' }
    })
    expect(response.status).toBe(200)
  })

  it('mounts question bank routes with a 403 for students (not 404)', async () => {
    const response = await fetch(`${baseUrl}/api/questions`, {
      headers: { 'x-demo-role': 'student' }
    })
    expect(response.status).toBe(403)
  })

  it('mounts adopt-solution (T09) for teachers', async () => {
    // Create a question first so adopt has a target.
    const created = await fetch(`${baseUrl}/api/questions`, {
      method: 'POST',
      headers: {
        'x-demo-role': 'teacher',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        questionBankId: 'wiring-bank',
        subject: 'math',
        questionType: 'choice',
        stem: 'wiring 1+1=?',
        payload: { kind: 'choice', correctOptionIds: ['B'] },
        kpIds: ['kp.wiring'],
        difficulty: 1
      })
    })
    expect(created.status).toBe(201)
    const question = (await created.json()) as { id: string }

    const adopted = await fetch(
      `${baseUrl}/api/questions/${encodeURIComponent(question.id)}/adopt-solution`,
      {
        method: 'POST',
        headers: {
          'x-demo-role': 'teacher',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ content: '标准解：选 B' })
      }
    )
    expect(adopted.status).toBe(200)
    const body = (await adopted.json()) as {
      solution: { content: string; source: string } | null
      tutoring: { mode: string }
    }
    expect(body.solution?.content).toContain('选 B')
    expect(body.solution?.source).toBe('authored')
    expect(body.tutoring.mode).toBe('rag_restate')
  })

  it('mounts student routes (mistakes returns 200 for a student)', async () => {
    const response = await fetch(`${baseUrl}/api/student/mistakes`, {
      headers: { 'x-demo-role': 'student' }
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { entries: unknown[] }
    expect(Array.isArray(body.entries)).toBe(true)
  })

  it('mounts student routes with 403 for teachers (not 404)', async () => {
    const response = await fetch(`${baseUrl}/api/student/mistakes`, {
      headers: { 'x-demo-role': 'teacher' }
    })
    expect(response.status).toBe(403)
  })

  it('mounts teacher routes (grading queue 403 for students, not 404)', async () => {
    const response = await fetch(`${baseUrl}/api/teacher/grading/tu-x`, {
      headers: { 'x-demo-role': 'student' }
    })
    expect(response.status).toBe(403)
  })

  it('mounts adaptive routes (next requires studentId → 400, not 404)', async () => {
    const response = await fetch(`${baseUrl}/api/adaptive/next`, {
      headers: { 'x-demo-role': 'student' }
    })
    // Adaptive route claimed the request (its own validation error, not the
    // main router's 404).
    expect(response.status).not.toBe(404)
  })

  it('mounts import routes (403 for students, not 404)', async () => {
    const response = await fetch(`${baseUrl}/api/import/drafts`, {
      headers: { 'x-demo-role': 'student' }
    })
    expect(response.status).toBe(403)
  })

  it('still returns 404 for a genuinely unknown API route', async () => {
    const response = await fetch(`${baseUrl}/api/does-not-exist`, {
      headers: { 'x-demo-role': 'teacher' }
    })
    expect(response.status).toBe(404)
  })

  it('end-to-end: teacher creates a teaching unit via wired route', async () => {
    const response = await fetch(`${baseUrl}/api/teacher/teaching-units`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-demo-role': 'teacher'
      },
      body: JSON.stringify({
        classId: 'cls-1',
        subjectId: 'subj-1',
        termId: 'term-1',
        taughtKpIds: ['kp-A']
      })
    })
    expect(response.status).toBe(201)
    const unit = (await response.json()) as { id: string; taughtKpIds: string[] }
    expect(unit.id.startsWith('tu_')).toBe(true)
    expect(unit.taughtKpIds).toEqual(['kp-A'])
  })

  it('lists teaching units for the demo teacher (incl. tu-demo seed)', async () => {
    const response = await fetch(`${baseUrl}/api/teacher/teaching-units`, {
      headers: { 'x-demo-role': 'teacher' }
    })
    expect(response.status).toBe(200)
    const units = (await response.json()) as Array<{
      id: string
      teacherId: string
    }>
    expect(Array.isArray(units)).toBe(true)
    // seedDemoProduct owns tu-demo as teacher-demo
    expect(units.some((u) => u.id === 'tu-demo')).toBe(true)
    expect(units.every((u) => u.teacherId === 'teacher-demo')).toBe(true)
  })
})
