// @vitest-environment node

import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createEvidenceRingServer } from '../server/index'
import { AuditStore } from '../server/audit/AuditStore'
import { SECURITY_WARNING_VALUE } from '../server/auth/MockSessionProvider'

const SECRET = 'access-control-test-hmac'

describe('demo access control + audit wiring', () => {
  let server: Awaited<ReturnType<typeof createEvidenceRingServer>>
  let baseUrl: string
  let audit: AuditStore

  beforeEach(async () => {
    audit = new AuditStore({
      dbPath: ':memory:',
      hmacSecret: SECRET,
      flushIntervalMs: 60_000,
      flushBatchSize: 100
    })
    server = await createEvidenceRingServer({
      dataFile: ':memory:',
      auditStore: audit,
      auditHmacSecret: SECRET
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

  function headers(role: string, extra?: Record<string, string>): HeadersInit {
    return {
      'x-demo-role': role,
      ...extra
    }
  }

  it('attaches the demo security warning header to API responses', async () => {
    const response = await fetch(`${baseUrl}/api/health`)
    expect(response.status).toBe(200)
    expect(response.headers.get('x-security-warning')).toBe(SECURITY_WARNING_VALUE)
  })

  it('blocks student access to /api/cohort with 403 and audits the denial', async () => {
    const response = await fetch(`${baseUrl}/api/cohort`, {
      headers: headers('student')
    })
    expect(response.status).toBe(403)
    const deniedBody = (await response.json()) as { error: string }
    expect(deniedBody.error).toMatch(/teacher or admin/i)

    await audit.flush()
    const logs = await audit.query({ action: 'view' })
    expect(
      logs.some(
        (entry) =>
          entry.resourceType === 'cohort' &&
          entry.result === 'denied' &&
          entry.actorRole === 'student'
      )
    ).toBe(true)
  })

  it('allows teacher access to /api/cohort and audits the view', async () => {
    const response = await fetch(`${baseUrl}/api/cohort`, {
      headers: headers('teacher')
    })
    expect(response.status).toBe(200)
    const cohortBody = (await response.json()) as { cohortName: string }
    expect(typeof cohortBody.cohortName).toBe('string')
    expect(cohortBody.cohortName.length).toBeGreaterThan(0)

    await audit.flush()
    const logs = await audit.query({ action: 'view' })
    expect(
      logs.some(
        (entry) =>
          entry.resourceType === 'cohort' &&
          entry.result === 'success' &&
          entry.actorRole === 'teacher'
      )
    ).toBe(true)
  })

  it('scopes evaluation history to the student owner and logs evaluate events', async () => {
    const studentCreate = await fetch(`${baseUrl}/api/evaluations`, {
      method: 'POST',
      headers: {
        ...headers('student'),
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        assignmentId: 'python-average',
        code: 'def calculate_average(scores):\n    return sum(scores) / len(scores)'
      })
    })
    expect(studentCreate.status).toBe(201)
    const created = (await studentCreate.json()) as {
      id: string
      studentId?: string
    }
    expect(created.studentId).toBe('learner-demo')

    // Teacher can list everything (demo single cohort).
    const teacherList = await fetch(
      `${baseUrl}/api/evaluations?assignmentId=python-average`,
      { headers: headers('teacher') }
    )
    expect(teacherList.status).toBe(200)
    const teacherHistory = (await teacherList.json()) as Array<{ id: string }>
    expect(teacherHistory.some((item) => item.id === created.id)).toBe(true)

    // Student still sees their own evaluation.
    const studentList = await fetch(
      `${baseUrl}/api/evaluations?assignmentId=python-average`,
      { headers: headers('student') }
    )
    expect(studentList.status).toBe(200)
    const studentHistory = (await studentList.json()) as Array<{
      id: string
      studentId?: string
    }>
    expect(studentHistory.every((item) => item.studentId === 'learner-demo')).toBe(
      true
    )
    expect(studentHistory.some((item) => item.id === created.id)).toBe(true)

    await audit.flush()
    const evaluateLogs = await audit.query({ action: 'evaluate' })
    expect(
      evaluateLogs.some(
        (entry) =>
          entry.resourceId === created.id &&
          entry.actorRole === 'student' &&
          entry.containerId !== null &&
          entry.result === 'success'
      )
    ).toBe(true)
  })

  it('restricts /api/audit to teacher/admin and supports studentId filter', async () => {
    await fetch(`${baseUrl}/api/evaluations`, {
      method: 'POST',
      headers: {
        ...headers('student'),
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        assignmentId: 'python-average',
        code: 'def calculate_average(scores):\n    return sum(scores) / len(scores)'
      })
    })

    const denied = await fetch(`${baseUrl}/api/audit`, {
      headers: headers('student')
    })
    expect(denied.status).toBe(403)

    const allowed = await fetch(
      `${baseUrl}/api/audit?studentId=learner-demo`,
      { headers: headers('teacher') }
    )
    expect(allowed.status).toBe(200)
    const logs = (await allowed.json()) as Array<{
      studentId: string | null
      action: string
    }>
    expect(logs.length).toBeGreaterThan(0)
    expect(
      logs.every(
        (entry) => entry.studentId === 'learner-demo' || entry.action === 'view'
      )
    ).toBe(true)
  })

  it('lets a student erase their own evaluation (right to erasure)', async () => {
    // Seed one evaluation owned by the student.
    const created = await fetch(`${baseUrl}/api/evaluations`, {
      method: 'POST',
      headers: headers('student', { 'content-type': 'application/json' }),
      body: JSON.stringify({
        assignmentId: 'python-average',
        code: 'def calculate_average(scores):\n    if not scores:\n        return 0\n    return sum(scores) / len(scores)'
      })
    })
    expect(created.status).toBe(201)
    const evaluation = (await created.json()) as { id: string }

    const deleted = await fetch(
      `${baseUrl}/api/evaluations/${evaluation.id}`,
      { method: 'DELETE', headers: headers('student') }
    )
    expect(deleted.status).toBe(200)
    const body = (await deleted.json()) as { id: string; deleted: boolean }
    expect(body).toEqual({ id: evaluation.id, deleted: true })

    // Gone afterwards.
    const gone = await fetch(
      `${baseUrl}/api/evaluations/${evaluation.id}`,
      { method: 'DELETE', headers: headers('student') }
    )
    expect(gone.status).toBe(404)

    // Deletion is audited.
    await audit.flush()
    const records = await audit.query({ action: 'delete', limit: 20 })
    expect(
      records.some(
        (row) => row.resourceId === evaluation.id && row.result === 'success'
      )
    ).toBe(true)
  })

  it('returns 404 when erasing an unknown evaluation', async () => {
    const response = await fetch(
      `${baseUrl}/api/evaluations/eval_does-not-exist`,
      { method: 'DELETE', headers: headers('student') }
    )
    expect(response.status).toBe(404)
  })
})
