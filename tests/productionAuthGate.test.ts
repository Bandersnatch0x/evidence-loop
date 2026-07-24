// @vitest-environment node

import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AuditStore } from '../server/audit/AuditStore'
import { createEvidenceLoopServer } from '../server/index'

/**
 * Production auth-gate regression test.
 *
 * Guards the critical finding from the code review: under NODE_ENV=production
 * the X-Demo-Role header MUST NOT elevate privileges. The server must use the
 * RealSessionProvider, so an unauthenticated request (no session cookie) is
 * refused with 401 — even when X-Demo-Role: admin is sent.
 *
 * This is the test that would have caught the original backdoor.
 */
describe('production auth gate (X-Demo-Role backdoor closed)', () => {
  let server: Awaited<ReturnType<typeof createEvidenceLoopServer>>
  let baseUrl: string
  let previousNodeEnv: string | undefined

  beforeEach(async () => {
    previousNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    const audit = new AuditStore({
      dbPath: ':memory:',
      hmacSecret: 'prod-auth-gate-hmac',
      flushIntervalMs: 60_000
    })
    server = await createEvidenceLoopServer({
      dataFile: ':memory:',
      auditStore: audit,
      auditHmacSecret: 'prod-auth-gate-hmac',
      memoryDbPath: ':memory:',
      productDbPath: ':memory:'
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${String(address.port)}`
  })

  afterEach(async () => {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousNodeEnv
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  })

  it('refuses teacher routes with X-Demo-Role: teacher and no session (401)', async () => {
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
    // In production, no valid session cookie → 401, not 201.
    expect(response.status).toBe(401)
  })

  it('refuses admin-only routes with X-Demo-Role: admin and no session', async () => {
    const response = await fetch(`${baseUrl}/api/cohort`, {
      headers: { 'x-demo-role': 'admin' }
    })
    expect(response.status).toBe(401)
  })

  it('still allows health check without auth', async () => {
    const response = await fetch(`${baseUrl}/api/health`)
    expect(response.status).toBe(200)
  })

  it('still allows teacher registration (entry to a real session)', async () => {
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'gate-teacher@test.dev',
        password: 'password-123',
        displayName: '注册老师'
      })
    })
    expect(response.status).toBe(201)
  })
})
