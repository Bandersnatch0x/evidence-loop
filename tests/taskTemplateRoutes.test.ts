// @vitest-environment node
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import Database from 'better-sqlite3'
import type { DeployTaskTemplateResult } from '../shared/contracts'
import {
  handleTaskTemplateApi,
  TaskTemplateError,
  type TaskTemplateRouteContext
} from '../server/taskTemplate'
import type { TaskTemplateService } from '../server/taskTemplate'
import type { SessionUser } from '../server/auth/SessionProvider'

const servers: Array<{ close: () => Promise<void> }> = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((entry) => entry.close()))
})

function sampleResult(): DeployTaskTemplateResult {
  return {
    template: {
      id: 'tpl.math.simplify',
      name: '代数式化简：完全平方展开',
      subject: 'math',
      kpIds: ['kp.math.algebra.simplify'],
      questionId: 'expression-perfect-square',
      description: '展开完全平方',
      estimatedMinutes: 8,
      difficulty: 2
    },
    assignment: {
      teachingUnitId: 'tu-demo',
      kind: 'handpick',
      paperId: 'paper-1',
      attemptIds: ['att-1'],
      studentIds: ['learner-demo'],
      questionIds: ['expression-perfect-square'],
      mode: 'assessment',
      createdAt: '2026-08-10T00:00:00.000Z'
    }
  }
}

const teacherUser: SessionUser = {
  userId: 'teacher-1',
  role: 'teacher',
  displayName: '演示教师'
}

const studentUser: SessionUser = {
  userId: 'student-1',
  role: 'student',
  displayName: '演示学生'
}

function startServer(overrides: {
  service?: Partial<TaskTemplateService>
  user?: SessionUser
} = {}): Promise<{ url: string; close: () => Promise<void> }> {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      public_library_reviewer INTEGER NOT NULL DEFAULT 0
    );
  `)
  const service = {
    list: vi.fn(() => Promise.resolve([sampleResult().template])),
    deploy: vi.fn(() => Promise.resolve(sampleResult())),
    ...overrides.service
  } as unknown as TaskTemplateService
  const user = overrides.user ?? teacherUser
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
    const context: TaskTemplateRouteContext = {
      db,
      taskTemplates: service,
      user,
      org: {
        getTeachingUnit: () => ({
          id: 'tu-demo',
          teacherId: 'teacher-1',
          classId: 'class-demo',
          subjectId: 'subject-math',
          termId: 'term-demo',
          taughtKpIds: ['kp.math.algebra.simplify']
        }),
        listEnrolledStudentIds: () => ['learner-demo']
      }
    }
    void handleTaskTemplateApi(request, response, requestUrl, context).then(
      (handled) => {
        if (!handled) response.writeHead(404).end('not mine')
      }
    )
  })
  return new Promise((resolveServer) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      const entry = {
        url: `http://127.0.0.1:${String(port)}`,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done())
          })
      }
      servers.push(entry)
      resolveServer(entry)
    })
  })
}

describe('handleTaskTemplateApi', () => {
  it('GET /api/teacher/task-templates returns the catalog', async () => {
    const server = await startServer()
    const response = await fetch(`${server.url}/api/teacher/task-templates`)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { templates: unknown[] }
    expect(body.templates).toHaveLength(1)
    expect(body.templates[0]).toMatchObject({ id: 'tpl.math.simplify' })
  })

  it('POST /:id/deploy creates an assignment for the unit teacher', async () => {
    const server = await startServer()
    const response = await fetch(
      `${server.url}/api/teacher/task-templates/tpl.math.simplify/deploy`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ teachingUnitId: 'tu-demo' })
      }
    )
    expect(response.status).toBe(201)
    const body = (await response.json()) as DeployTaskTemplateResult
    expect(body.assignment.studentIds).toEqual(['learner-demo'])
  })

  it('deploy requires teachingUnitId', async () => {
    const server = await startServer()
    const response = await fetch(
      `${server.url}/api/teacher/task-templates/tpl.math.simplify/deploy`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({})
      }
    )
    expect(response.status).toBe(400)
  })

  it('deploy rejects a student session', async () => {
    const server = await startServer({ user: studentUser })
    const response = await fetch(
      `${server.url}/api/teacher/task-templates/tpl.math.simplify/deploy`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ teachingUnitId: 'tu-demo' })
      }
    )
    expect(response.status).toBe(403)
  })

  it('deploy rejects a teacher who does not own the unit', async () => {
    const server = await startServer({
      user: { ...teacherUser, userId: 'teacher-other' }
    })
    const response = await fetch(
      `${server.url}/api/teacher/task-templates/tpl.math.simplify/deploy`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ teachingUnitId: 'tu-demo' })
      }
    )
    expect(response.status).toBe(403)
  })

  it('maps an unknown template to 404', async () => {
    const server = await startServer({
      service: {
        deploy: vi.fn(() => {
          throw new TaskTemplateError(
            'Task template not found: tpl.nope',
            404
          )
        })
      }
    })
    const response = await fetch(
      `${server.url}/api/teacher/task-templates/tpl.nope/deploy`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ teachingUnitId: 'tu-demo' })
      }
    )
    expect(response.status).toBe(404)
  })

  it('non-template paths fall through (return false)', async () => {
    const server = await startServer()
    const response = await fetch(`${server.url}/api/teacher/other`)
    expect(response.status).toBe(404)
  })
})
