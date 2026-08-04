/**
 * T-J reference + notification tests — fixed-version semantics, manual
 * upgrade, supplementary ≤8 enforcement, notification channel persistence,
 * and the reference UI API surface (spec §5.6/§2.7, ticket 08/12/13).
 */
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { applyProductMigrations } from '../server/db/migrate'
import { ReferenceService, MAX_SUPPLEMENTARY } from '../server/demonstration/ReferenceService'
import { NotificationService } from '../server/demonstration/NotificationService'
import { DemonstrationService } from '../server/demonstration/DemonstrationService'
import { ReviewService } from '../server/demonstration/ReviewService'
import { createDemoAuditSink } from '../server/demonstration/demoAuditSink'
import { handleReferenceApi } from '../server/demonstration/referenceRoutes'
import { parseSceneDocument, type SceneDocument } from '../server/demonstration/sceneDocumentSchema'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Socket } from 'node:net'

const META = {
  title: '电磁感应',
  subject: 'physics',
  grade: 'grade9',
  kpIds: ['kp.phy.induction'],
  description: '线圈切割磁感线',
  format: 'scene',
  space: '3d',
  behavior: 'interactive'
}

function baseDoc(): SceneDocument {
  return parseSceneDocument({
    documentMeta: { sceneFormatVersion: '1.0' },
    runtimeVersion: { sceneFormatVersion: '1.0', capabilities: [] },
    objectTree: [],
    geometry2D: [],
    timeline: { tracks: [], chapters: [], duration: 10 },
    editorMetadata: {}
  })
}

interface Env {
  db: Database.Database
  service: DemonstrationService
  review: ReviewService
  references: ReferenceService
  notifications: NotificationService
  audit: ReturnType<typeof createDemoAuditSink>
}

function makeEnv(): Env {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  applyProductMigrations(db)
  db.prepare(
    `INSERT INTO users (id, person_id, role, login_id, display_name, created_at, public_library_reviewer)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run('reviewer-1', 'p-reviewer-1', 'teacher', 'login-reviewer-1', 'reviewer-1', new Date().toISOString(), 1)
  const audit = createDemoAuditSink({ enqueue: () => {} } as never)
  const service = new DemonstrationService({ db, audit })
  const review = new ReviewService({ db, audit })
  const references = new ReferenceService({ db, audit })
  const notifications = new NotificationService({ db })
  return { db, service, review, references, notifications, audit }
}

/** Publish a demo and return its current approved version id. */
function publish(env: Env, owner = 'teacher-1'): { demoId: string; versionId: string } {
  const demoId = env.service.createDemonstration(owner, { ...META })
  env.service.saveDraft(demoId, owner, baseDoc())
  const versionId = env.service.submit(demoId, owner, {
    classification: 'physics',
    license: 'CC-BY-4.0',
    aiDisclosure: 'none'
  })
  env.review.approve('reviewer-1', versionId)
  return { demoId, versionId }
}

function seedQuestion(env: Env, id: string, author = 'teacher-1'): void {
  env.db
    .prepare(
      `INSERT INTO questions (id, question_bank_id, author_id, subject, question_type, stem, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, 'qb-1', author, 'physics', 'choice', '题', '{}', new Date().toISOString())
}

function capture(): { res: ServerResponse; status: () => number; body: () => unknown } {
  let status = 0
  let body = ''
  const res = {
    writeHead: (code: number) => {
      status = code
    },
    end: (chunk?: unknown) => {
      body = typeof chunk === 'string' ? chunk : JSON.stringify(chunk ?? '')
    }
  } as unknown as ServerResponse
  return {
    res,
    status: () => status,
    body: () => JSON.parse(body) as unknown
  }
}

function req(method: string, url: string, payload?: unknown): { request: IncomingMessage; url: URL } {
  const socket = {} as Socket
  const body = payload === undefined ? null : JSON.stringify(payload)
  const request = {
    method,
    headers: { 'content-length': body === null ? '0' : String(Buffer.byteLength(body)) },
    socket,
    [Symbol.asyncIterator]: function* () {
      if (body !== null) yield Buffer.from(body)
    }
  } as unknown as IncomingMessage
  return { request, url: new URL(url, 'http://localhost') }
}

const ctx = (env: Env, userId = 'teacher-1', role = 'teacher') => ({
  db: env.db,
  references: env.references,
  notifications: env.notifications,
  getUserId: () => userId,
  getRole: () => role
})

describe('T-J references (fixed version, no drift)', () => {
  it('binds a fixed approved version; list preserves order and role', () => {
    const env = makeEnv()
    seedQuestion(env, 'q1')
    const { versionId } = publish(env)
    env.references.setReferences('teacher-1', 'teacher', {
      questionId: 'q1',
      entries: [{ demoVersionId: versionId, role: 'primary' }]
    })
    const refs = env.references.listReferences('q1', 'question')
    expect(refs).toHaveLength(1)
    expect(refs[0]?.role).toBe('primary')
    expect(refs[0]?.demoVersionId).toBe(versionId)
  })

  it('upgrade requires explicit action and same-demonstration target', () => {
    const env = makeEnv()
    seedQuestion(env, 'q1')
    const { demoId, versionId: v1 } = publish(env)
    env.references.setReferences('teacher-1', 'teacher', {
      questionId: 'q1',
      entries: [{ demoVersionId: v1, role: 'primary' }]
    })
    const refId = env.references.listReferences('q1', 'question')[0]!.id
    // Newer version of the same demo.
    env.service.saveDraft(demoId, 'teacher-1', baseDoc())
    const v2 = env.service.submit(demoId, 'teacher-1', {
      classification: 'physics',
      license: 'CC-BY-4.0',
      aiDisclosure: 'none'
    })
    env.review.approve('reviewer-1', v2)
    // Automatic drift: reference still points at v1.
    expect(env.references.listReferences('q1', 'question')[0]!.demoVersionId).toBe(v1)
    // Manual upgrade.
    env.references.upgradeReference('teacher-1', 'teacher', refId, v2)
    expect(env.references.listReferences('q1', 'question')[0]!.demoVersionId).toBe(v2)
    // Cross-demo upgrade refused.
    const other = publish(env)
    expect(() => env.references.upgradeReference('teacher-1', 'teacher', refId, other.versionId)).toThrow()
  })

  it('supplementary count capped at MAX_SUPPLEMENTARY (service layer)', () => {
    const env = makeEnv()
    seedQuestion(env, 'q1')
    const versions: string[] = []
    for (let i = 0; i < MAX_SUPPLEMENTARY + 2; i += 1) {
      versions.push(publish(env).versionId)
    }
    expect(() =>
      env.references.setReferences('teacher-1', 'teacher', {
        questionId: 'q1',
        entries: versions.map((v) => ({ demoVersionId: v, role: 'supplementary' }))
      })
    ).toThrow()
  })

  it('non-teacher cannot bind references', () => {
    const env = makeEnv()
    seedQuestion(env, 'q1')
    const { versionId } = publish(env)
    expect(() =>
      env.references.setReferences('student-1', 'student', {
        questionId: 'q1',
        entries: [{ demoVersionId: versionId, role: 'primary' }]
      })
    ).toThrow()
  })
})

describe('T-J notification channel', () => {
  it('persists new-version notifications to the demo_notifications table', () => {
    const env = makeEnv()
    seedQuestion(env, 'q1')
    const { demoId, versionId: v1 } = publish(env)
    env.references.setReferences('teacher-1', 'teacher', {
      questionId: 'q1',
      entries: [{ demoVersionId: v1, role: 'primary' }]
    })
    // New version published → notify referencing teacher.
    env.service.saveDraft(demoId, 'teacher-1', baseDoc())
    const v2 = env.service.submit(demoId, 'teacher-1', {
      classification: 'physics',
      license: 'CC-BY-4.0',
      aiDisclosure: 'none'
    })
    env.review.approve('reviewer-1', v2)
    const emitted = env.notifications.onNewVersion(v1, v2)
    expect(emitted.length).toBeGreaterThan(0)
    env.notifications.persist(emitted)
    const list = env.notifications.listForTeacher('teacher-1')
    expect(list.length).toBeGreaterThan(0)
    expect(list[0]?.kind).toBe('new_version')
    // Mark read.
    env.notifications.markRead(list[0]!.id, 'teacher-1')
    expect(env.notifications.listForTeacher('teacher-1')[0]?.readAt).not.toBeNull()
  })

  it('forced takedown emits source_unavailable + deadline', () => {
    const env = makeEnv()
    seedQuestion(env, 'q1')
    const { demoId, versionId } = publish(env)
    env.references.setReferences('teacher-1', 'teacher', {
      questionId: 'q1',
      entries: [{ demoVersionId: versionId, role: 'primary' }]
    })
    const emitted = env.notifications.onForcedTakedown(demoId, '侵权', '2030-01-01T00:00:00Z')
    const mine = emitted.filter((n) => n.recipientId === 'teacher-1')
    expect(mine.length).toBeGreaterThan(0)
    expect(mine[0]?.kind).toBe('forced_takedown')
    expect(mine[0]?.detail.replaceDeadline).toBe('2030-01-01T00:00:00Z')
  })
})

describe('T-J reference HTTP routes', () => {
  it('PUT then GET /api/references round-trips order', async () => {
    const env = makeEnv()
    seedQuestion(env, 'q1')
    const { versionId } = publish(env)
    const put = req('PUT', '/api/references?questionId=q1', {
      entries: [{ demoVersionId: versionId, role: 'primary' }]
    })
    const c = capture()
    await handleReferenceApi(put.request, c.res, '/api/references', put.url, ctx(env))
    expect(c.status()).toBe(200)

    const get = req('GET', '/api/references?questionId=q1')
    const c2 = capture()
    await handleReferenceApi(get.request, c2.res, '/api/references', get.url, ctx(env))
    expect(c2.status()).toBe(200)
    const body = c2.body() as { references: Array<{ demoVersionId: string; role: string }> }
    expect(body.references).toHaveLength(1)
    expect(body.references[0]?.demoVersionId).toBe(versionId)
  })

  it('upgrade endpoint works over HTTP; remove endpoint unbinds', async () => {
    const env = makeEnv()
    seedQuestion(env, 'q1')
    const { demoId, versionId: v1 } = publish(env)
    await handleReferenceApi(
      req('PUT', '/api/references?questionId=q1', { entries: [{ demoVersionId: v1, role: 'primary' }] }).request,
      capture().res,
      '/api/references',
      req('PUT', '/api/references?questionId=q1', { entries: [{ demoVersionId: v1, role: 'primary' }] }).url,
      ctx(env)
    )
    const refId = env.references.listReferences('q1', 'question')[0]!.id
    env.service.saveDraft(demoId, 'teacher-1', baseDoc())
    const v2 = env.service.submit(demoId, 'teacher-1', {
      classification: 'physics',
      license: 'CC-BY-4.0',
      aiDisclosure: 'none'
    })
    env.review.approve('reviewer-1', v2)

    const up = req('POST', `/api/references/${refId}/upgrade`, { newVersionId: v2 })
    const c = capture()
    await handleReferenceApi(up.request, c.res, `/api/references/${refId}/upgrade`, up.url, ctx(env))
    expect(c.status()).toBe(200)
    expect(env.references.listReferences('q1', 'question')[0]!.demoVersionId).toBe(v2)

    const del = req('DELETE', `/api/references/${refId}`)
    const c2 = capture()
    await handleReferenceApi(del.request, c2.res, `/api/references/${refId}`, del.url, ctx(env))
    expect(c2.status()).toBe(200)
    expect(env.references.listReferences('q1', 'question')).toHaveLength(0)
  })

  it('notification endpoints list and mark read', async () => {
    const env = makeEnv()
    seedQuestion(env, 'q1')
    const { versionId } = publish(env)
    env.references.setReferences('teacher-1', 'teacher', {
      questionId: 'q1',
      entries: [{ demoVersionId: versionId, role: 'primary' }]
    })
    env.notifications.persist(env.notifications.onNewVersion(versionId, versionId))

    const get = req('GET', '/api/notifications/demo')
    const c = capture()
    await handleReferenceApi(get.request, c.res, '/api/notifications/demo', get.url, ctx(env))
    expect(c.status()).toBe(200)
    const body = c.body() as { notifications: Array<{ id: string }> }
    expect(body.notifications.length).toBeGreaterThan(0)

    const read = req('POST', `/api/notifications/demo/${body.notifications[0]!.id}/read`)
    const c2 = capture()
    await handleReferenceApi(read.request, c2.res, `/api/notifications/demo/${body.notifications[0]!.id}/read`, read.url, ctx(env))
    expect(c2.status()).toBe(200)
    expect(env.notifications.listForTeacher('teacher-1')[0]?.readAt).not.toBeNull()
  })
})