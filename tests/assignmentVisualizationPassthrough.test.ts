// @vitest-environment node

/**
 * ADR-0015 Phase 5 — student-facing visualization passthrough.
 *
 * Teacher adopts visualization on a private question → student GET
 * /api/assignments/:questionId receives a projected Assignment shell with
 * visualization. Demo registry path still merges seed:<id> visualization.
 */
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AuditStore } from '../server/audit/AuditStore'
import { createEvidenceRingServer } from '../server/index'
import type { Assignment, Question, Visualization } from '../shared/contracts'

const SECRET = 'viz-passthrough-hmac'

const helixViz: Visualization = {
  kind: 'curve',
  points: [
    [1, 0, 0],
    [0, 1, 1],
    [-1, 0, 2],
    [0, -1, 3]
  ],
  label: '磁场螺旋'
}

describe('assignment visualization passthrough (Phase 5)', () => {
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

  async function createPrivateQuestion(): Promise<Question> {
    const created = await fetch(`${baseUrl}/api/questions`, {
      method: 'POST',
      headers: {
        'x-demo-role': 'teacher',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        questionBankId: 'passthrough-bank',
        subject: 'physics',
        questionType: 'fill_blank',
        stem: '带电粒子在匀强磁场中的运动轨迹是什么？',
        payload: { kind: 'fill_blank', acceptedAnswers: ['螺旋线'] },
        kpIds: ['kp.physics.em.magnetic_force'],
        difficulty: 3
      })
    })
    expect(created.status).toBe(201)
    return (await created.json()) as Question
  }

  it('adopt-visualization no longer persists or migrates (column deleted, #30)', async () => {
    const question = await createPrivateQuestion()

    const adopt = await fetch(
      `${baseUrl}/api/questions/${encodeURIComponent(question.id)}/adopt-visualization`,
      {
        method: 'POST',
        headers: {
          'x-demo-role': 'teacher',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ visualization: helixViz })
      }
    )
    expect(adopt.status).toBe(200)

    const studentView = await fetch(
      `${baseUrl}/api/assignments/${encodeURIComponent(question.id)}`,
      { headers: { 'x-demo-role': 'student' } }
    )
    expect(studentView.status).toBe(200)
    const assignment = (await studentView.json()) as Assignment
    expect(assignment.id).toBe(question.id)
    // Phase C (#30): the legacy visualization column is deleted and adopt no
    // longer migrates into a demonstration — the field and demos are absent.
    expect(assignment.visualization).toBeUndefined()
    expect(assignment.demonstrations).toBeUndefined()
  })

  it('serves a private question without any legacy visualization', async () => {
    const question = await createPrivateQuestion()

    const studentView = await fetch(
      `${baseUrl}/api/assignments/${encodeURIComponent(question.id)}`,
      { headers: { 'x-demo-role': 'student' } }
    )
    expect(studentView.status).toBe(200)
    const assignment = (await studentView.json()) as Assignment
    expect(assignment.visualization).toBeUndefined()
  })

  it('returns 404 for unknown private ids', async () => {
    const response = await fetch(
      `${baseUrl}/api/assignments/${encodeURIComponent('q-does-not-exist')}`,
      { headers: { 'x-demo-role': 'student' } }
    )
    expect(response.status).toBe(404)
  })

  it('still serves demo assignments without visualization', async () => {
    const response = await fetch(`${baseUrl}/api/assignments/python-average`, {
      headers: { 'x-demo-role': 'student' }
    })
    expect(response.status).toBe(200)
    const assignment = (await response.json()) as Assignment
    expect(assignment.id).toBe('python-average')
    expect(assignment.visualization).toBeUndefined()
  })

  it('serves pre-seeded magnetic helix curve on demo assignment (preset demo, #32)', async () => {
    const response = await fetch(
      `${baseUrl}/api/assignments/physics-magnetic-helix`,
      { headers: { 'x-demo-role': 'student' } }
    )
    expect(response.status).toBe(200)
    const assignment = (await response.json()) as Assignment
    expect(assignment.id).toBe('physics-magnetic-helix')
    // #32: the preset demonstration is created directly by the seed path
    // (not legacy migration) and resolved as the primary reference.
    expect(assignment.visualization).toBeUndefined()
    const primary = assignment.demonstrations?.find((r) => r.role === 'primary')
    expect(primary).toBeDefined()
    expect(primary?.versionId).toBeTruthy()
  })

  it('serves pre-seeded DNA double helix demo assignment (preset demo, #32)', async () => {
    const response = await fetch(
      `${baseUrl}/api/assignments/bio-dna-double-helix`,
      { headers: { 'x-demo-role': 'student' } }
    )
    expect(response.status).toBe(200)
    const assignment = (await response.json()) as Assignment
    expect(assignment.id).toBe('bio-dna-double-helix')
    const primary = assignment.demonstrations?.find((r) => r.role === 'primary')
    expect(primary).toBeDefined()
    expect(primary?.versionId).toBeTruthy()
  })

  it('allows student preview-visualization without persisting', async () => {
    const response = await fetch(
      `${baseUrl}/api/student/preview-visualization`,
      {
        method: 'POST',
        headers: {
          'x-demo-role': 'student',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ description: '   ' })
      }
    )
    // Empty description → 400; proves route is mounted for students (not 403/404).
    expect([400, 422]).toContain(response.status)

    const noAuth = await fetch(`${baseUrl}/api/student/preview-visualization`, {
      method: 'POST',
      headers: {
        'x-demo-role': 'teacher',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ description: '水分子' })
    })
    // Teacher role has no studentId → 403 on student routes.
    expect(noAuth.status).toBe(403)
  })

  it('serves pre-seeded circuit demo assignment (preset demo, #32)', async () => {
    const response = await fetch(
      `${baseUrl}/api/assignments/numeric-ohm-law`,
      { headers: { 'x-demo-role': 'student' } }
    )
    expect(response.status).toBe(200)
    const assignment = (await response.json()) as Assignment
    expect(assignment.id).toBe('numeric-ohm-law')
    const primary = assignment.demonstrations?.find((r) => r.role === 'primary')
    expect(primary).toBeDefined()
    expect(primary?.versionId).toBeTruthy()
  })

  it('scores a private fill_blank question via payload projection', async () => {
    const question = await createPrivateQuestion()
    // Correct answer for createPrivateQuestion payload: 螺旋线
    const start = await fetch(`${baseUrl}/api/student/practice`, {
      method: 'POST',
      headers: {
        'x-demo-role': 'student',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        questionId: question.id,
        teachingUnitId: 'tu-demo',
        termId: 'term-demo',
        mode: 'practice'
      })
    })
    expect(start.status).toBe(201)
    const started = (await start.json()) as { attemptId: string }

    const evaluate = await fetch(`${baseUrl}/api/evaluations`, {
      method: 'POST',
      headers: {
        'x-demo-role': 'student',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        assignmentId: question.id,
        code: '螺旋线',
        attemptId: started.attemptId
      })
    })
    expect(evaluate.status).toBe(201)
    const result = (await evaluate.json()) as {
      score: number
      status: string
      evidence: Array<{ id: string; state: string }>
    }
    expect(result.status).toBe('completed')
    expect(result.score).toBe(100)
    expect(
      result.evidence.some((e) => e.id === 'answer-match' && e.state === 'passed')
    ).toBe(true)
  })
})
