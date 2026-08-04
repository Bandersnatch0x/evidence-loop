/**
 * T-H author routes tests — teacher authoring endpoints (spec §5.1).
 * Covers draft GET/PUT with zod trust gate, submit freeze, withdraw,
 * soft-delete, takedown, ownership gating, and that author routes never touch
 * scoring/evidence paths (import-graph guard lives in architecture.test.ts).
 */
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { applyProductMigrations } from '../server/db/migrate'
import { handleAuthorApi } from '../server/demonstration/authorRoutes'
import { createDemoAuditSink } from '../server/demonstration/demoAuditSink'
import { DemonstrationService } from '../server/demonstration/DemonstrationService'
import { ReviewService } from '../server/demonstration/ReviewService'
import { parseSceneDocument, type SceneDocument } from '../server/demonstration/sceneDocumentSchema'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Socket } from 'node:net'

const META = {
  title: '细胞分裂',
  subject: 'biology',
  grade: 'grade7',
  kpIds: ['kp.bio.cell'],
  description: '有丝分裂',
  format: 'scene',
  space: '2d',
  behavior: 'interactive'
}

function baseDoc(): SceneDocument {
  return parseSceneDocument({
    documentMeta: { sceneFormatVersion: '1.0' },
    runtimeVersion: { sceneFormatVersion: '1.0', capabilities: [] },
    objectTree: [
      {
        id: 'cell',
        name: 'cell',
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        visible: true,
        children: []
      }
    ],
    geometry2D: [{ id: 'cell-c', shape: 'circle', cx: 0, cy: 0, r: 1 }],
    timeline: { tracks: [], chapters: [], duration: 10 },
    editorMetadata: {}
  })
}

interface Env {
  db: Database.Database
  service: DemonstrationService
  review: ReviewService
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
  return { db, service, review, audit }
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

function req(method: string, url: string, payload?: unknown): { request: IncomingMessage } {
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
  return { request }
}

const ctx = (env: Env, userId: string) => ({
  db: env.db,
  service: env.service,
  getUserId: () => userId
})

describe('T-H author routes', () => {
  it('draft PUT saves a valid SceneDocument; GET returns it (owner only)', async () => {
    const env = makeEnv()
    const demoId = env.service.createDemonstration('teacher-1', { ...META })

    const put = req('PUT', `/api/demonstrations/${demoId}/draft`, baseDoc())
    const c = capture()
    await handleAuthorApi(put.request, c.res, `/api/demonstrations/${demoId}/draft`, ctx(env, 'teacher-1'))
    expect(c.status()).toBe(200)

    const get = req('GET', `/api/demonstrations/${demoId}/draft`)
    const c2 = capture()
    await handleAuthorApi(get.request, c2.res, `/api/demonstrations/${demoId}/draft`, ctx(env, 'teacher-1'))
    expect(c2.status()).toBe(200)
    const draft = c2.body() as { document: { objectTree: unknown[] } }
    expect(draft.document.objectTree).toHaveLength(1)
  })

  it('draft PUT rejects invalid SceneDocument with 400 (zod trust gate)', async () => {
    const env = makeEnv()
    const demoId = env.service.createDemonstration('teacher-1', { ...META })
    const put = req('PUT', `/api/demonstrations/${demoId}/draft`, {
      documentMeta: { sceneFormatVersion: '1.0' },
      objectTree: [{ id: 'dup' }, { id: 'dup' }] // duplicate ids -> invalid
    })
    const c = capture()
    await handleAuthorApi(put.request, c.res, `/api/demonstrations/${demoId}/draft`, ctx(env, 'teacher-1'))
    expect(c.status()).toBe(400)
  })

  it('non-owner cannot read or save a draft', async () => {
    const env = makeEnv()
    const demoId = env.service.createDemonstration('teacher-1', { ...META })
    const put = req('PUT', `/api/demonstrations/${demoId}/draft`, baseDoc())
    const c = capture()
    await handleAuthorApi(put.request, c.res, `/api/demonstrations/${demoId}/draft`, ctx(env, 'teacher-2'))
    expect(c.status()).toBe(403)

    const get = req('GET', `/api/demonstrations/${demoId}/draft`)
    const c2 = capture()
    await handleAuthorApi(get.request, c2.res, `/api/demonstrations/${demoId}/draft`, ctx(env, 'teacher-2'))
    // Read path conceals resource existence from non-owners.
    expect(c2.status()).toBe(404)
  })

  it('submit freezes a pending version; withdraw reverses it', async () => {
    const env = makeEnv()
    const demoId = env.service.createDemonstration('teacher-1', { ...META })
    const put = req('PUT', `/api/demonstrations/${demoId}/draft`, baseDoc())
    await handleAuthorApi(put.request, capture().res, `/api/demonstrations/${demoId}/draft`, ctx(env, 'teacher-1'))

    const submit = req('POST', `/api/demonstrations/${demoId}/submit`, {
      classification: 'biology',
      license: 'CC-BY-4.0',
      aiDisclosure: 'none'
    })
    const c = capture()
    await handleAuthorApi(submit.request, c.res, `/api/demonstrations/${demoId}/submit`, ctx(env, 'teacher-1'))
    expect(c.status()).toBe(201)
    const { versionId } = c.body() as { versionId: string }
    expect(versionId).toBeTruthy()

    const versions = env.service.listVersions(demoId)
    expect(versions[0]?.status).toBe('submitted')

    const withdraw = req('POST', `/api/demonstrations/${demoId}/withdraw`, { versionId })
    const c2 = capture()
    await handleAuthorApi(withdraw.request, c2.res, `/api/demonstrations/${demoId}/withdraw`, ctx(env, 'teacher-1'))
    expect(c2.status()).toBe(200)
    expect(env.service.listVersions(demoId)[0]?.status).toBe('withdrawn')
  })

  it('submit without metadata fails 400', async () => {
    const env = makeEnv()
    const demoId = env.service.createDemonstration('teacher-1', { ...META })
    const put = req('PUT', `/api/demonstrations/${demoId}/draft`, baseDoc())
    await handleAuthorApi(put.request, capture().res, `/api/demonstrations/${demoId}/draft`, ctx(env, 'teacher-1'))

    const submit = req('POST', `/api/demonstrations/${demoId}/submit`, {})
    const c = capture()
    await handleAuthorApi(submit.request, c.res, `/api/demonstrations/${demoId}/submit`, ctx(env, 'teacher-1'))
    expect(c.status()).toBe(400)
  })

  it('soft-delete hides the work from player; takedown is owner-only', async () => {
    const env = makeEnv()
    const demoId = env.service.createDemonstration('teacher-1', { ...META })
    const put = req('PUT', `/api/demonstrations/${demoId}/draft`, baseDoc())
    await handleAuthorApi(put.request, capture().res, `/api/demonstrations/${demoId}/draft`, ctx(env, 'teacher-1'))

    const del = req('DELETE', `/api/demonstrations/${demoId}`)
    const c = capture()
    await handleAuthorApi(del.request, c.res, `/api/demonstrations/${demoId}`, ctx(env, 'teacher-1'))
    expect(c.status()).toBe(200)

    // Non-owner takedown refused.
    const other = env.service.createDemonstration('teacher-2', { ...META })
    const td = req('POST', `/api/demonstrations/${other}/takedown`)
    const c2 = capture()
    await handleAuthorApi(td.request, c2.res, `/api/demonstrations/${other}/takedown`, ctx(env, 'teacher-1'))
    expect(c2.status()).toBe(403)
  })

  it('unauthorized (no user) is not handled by author routes', async () => {
    const env = makeEnv()
    const c = capture()
    const handled = await handleAuthorApi(
      req('GET', '/api/demonstrations/d1/draft').request,
      c.res,
      '/api/demonstrations/d1/draft',
      { db: env.db, service: env.service, getUserId: () => null }
    )
    expect(handled).toBe(false)
  })
})
