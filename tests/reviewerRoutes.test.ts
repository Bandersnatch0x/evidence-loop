// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createEvidenceRingServer } from '../server/index'
import { AuditStore } from '../server/audit/AuditStore'
import { openMemoryDatabase } from '../server/db/memorySchema'
import { DemonstrationService } from '../server/demonstration/DemonstrationService'
import { ReviewService } from '../server/demonstration/ReviewService'
import { createDemoAuditSink } from '../server/demonstration/demoAuditSink'
import { parseSceneDocument } from '../server/demonstration/sceneDocumentSchema'
import type { SessionProvider, SessionUser } from '../server/auth/SessionProvider'

/**
 * T-F HTTP route tests (spec §5.2/§5.3): server wiring, route validation,
 * authorization (reviewer flag gate), and the end-to-end reviewer flow over
 * HTTP (queue / approve / reject / evidence panel / forced takedown / appeals /
 * reports) plus audit persistence.
 *
 * The product DB is injected (seeded with a reviewer-flagged user) so the
 * reviewer authorization check (users.public_library_reviewer) resolves
 * against real rows; a test session provider selects the principal per request.
 */

const SECRET = 'reviewer-routes-hmac'

const baseDoc = () =>
  parseSceneDocument({
    documentMeta: { sceneFormatVersion: '1.0' },
    geometry3D: [{ id: 'box1', kind: 'box' }]
  })

const META = {
  title: '演示',
  description: '演示说明',
  subject: 'physics',
  grade: 'high',
  format: 'scene',
  space: '3d',
  behavior: 'static',
  kpIds: []
}

function seedUser(
  db: ReturnType<typeof openMemoryDatabase>,
  id: string,
  reviewer: boolean,
  role: 'teacher' | 'student' = 'teacher'
): void {
  db.prepare(
    `INSERT INTO users (id, person_id, role, login_id, display_name, created_at, public_library_reviewer)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, `p-${id}`, role, `login-${id}`, id, new Date().toISOString(), reviewer ? 1 : 0)
}

class TestSessionProvider implements SessionProvider {
  private current: SessionUser
  public constructor(initial: SessionUser) {
    this.current = initial
  }
  public set(principal: SessionUser): void {
    this.current = principal
  }
  public resolve(): SessionUser {
    return this.current
  }
}

const REVIEWER: SessionUser = {
  userId: 'reviewer-1',
  role: 'teacher',
  displayName: 'Reviewer',
  actorSource: 'demo'
}
const TEACHER: SessionUser = {
  userId: 'teacher-1',
  role: 'teacher',
  displayName: 'Teacher',
  actorSource: 'demo'
}
const STUDENT: SessionUser = {
  userId: 'student-1',
  role: 'student',
  displayName: 'Student',
  studentId: 'student-1',
  actorSource: 'demo'
}

/** Recursively collect every object key in a JSON-serialisable value. */
function collectKeys(value: unknown, into: string[] = []): string[] {
  if (value !== null && typeof value === 'object') {
    if (Array.isArray(value)) {
      for (const item of value) collectKeys(item, into)
    } else {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        into.push(key)
        collectKeys(child, into)
      }
    }
  }
  return into
}

interface Fixture {
  db: ReturnType<typeof openMemoryDatabase>
  audit: AuditStore
  demo: DemonstrationService
  review: ReviewService
  sessions: TestSessionProvider
  server: Awaited<ReturnType<typeof createEvidenceRingServer>>
  baseUrl: string
  /** A submitted (pending) version by teacher-1. */
  submittedVersionId: string
  submittedDemoId: string
  /** An approved (published) version by teacher-1. */
  publishedVersionId: string
  publishedDemoId: string
}

async function makeFixture(): Promise<Fixture> {
  const db = openMemoryDatabase(':memory:')
  seedUser(db, 'reviewer-1', true)
  seedUser(db, 'reviewer-2', true)
  seedUser(db, 'teacher-1', false)
  seedUser(db, 'student-1', false, 'student')
  const demo = new DemonstrationService({ db })
  const review = new ReviewService({ db })

  // A submitted (pending) version.
  const submittedDemoId = demo.createDemonstration('teacher-1', { ...META })
  demo.saveDraft(submittedDemoId, 'teacher-1', baseDoc())
  const submittedVersionId = demo.submit(submittedDemoId, 'teacher-1', {
    classification: 'physics',
    license: 'CC-BY-4.0',
    aiDisclosure: 'none'
  })

  // An approved (published) version (different demo so it can be reported).
  const publishedDemoId = demo.createDemonstration('teacher-1', {
    ...META,
    title: '已发布'
  })
  demo.saveDraft(publishedDemoId, 'teacher-1', baseDoc())
  const publishedVersionId = demo.submit(publishedDemoId, 'teacher-1', {
    classification: 'physics',
    license: 'CC-BY-4.0',
    aiDisclosure: 'none'
  })
  review.approve('reviewer-1', publishedVersionId)

  const audit = new AuditStore({ dbPath: ':memory:', hmacSecret: SECRET })
  const sessions = new TestSessionProvider(REVIEWER)
  const mediaDataRoot = await mkdtemp(join(tmpdir(), 'reviewer-routes-'))
  const server = await createEvidenceRingServer({
    dataFile: ':memory:',
    auditStore: audit,
    auditHmacSecret: SECRET,
    memoryDbPath: ':memory:',
    productDb: db,
    mediaDataRoot,
    sessionProvider: sessions
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  return {
    db,
    audit,
    demo,
    review,
    sessions,
    server,
    baseUrl: `http://127.0.0.1:${String(address.port)}`,
    submittedVersionId,
    submittedDemoId,
    publishedVersionId,
    publishedDemoId
  }
}

describe('T-F reviewer HTTP routes', () => {
  let fx: Fixture

  beforeEach(async () => {
    fx = await makeFixture()
  })

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      fx.server.close((error) => (error ? reject(error) : resolve()))
    })
    // The server does not own the injected product DB (ownsProductDb=false);
    // close it here to release the in-memory handle.
    try {
      fx.db.close()
    } catch {
      // already closed - ignore
    }
  })

  describe('server wiring + authorization', () => {
    it('GET /api/reviewer/queue: reviewer 200, non-reviewer 403', async () => {
      fx.sessions.set(REVIEWER)
      const ok = await fetch(`${fx.baseUrl}/api/reviewer/queue`)
      expect(ok.status).toBe(200)
      const body = (await ok.json()) as { versions: unknown[]; reports: unknown[] }
      expect(Array.isArray(body.versions)).toBe(true)
      expect(body.versions).toHaveLength(1) // the submitted version

      fx.sessions.set(TEACHER)
      const denied = await fetch(`${fx.baseUrl}/api/reviewer/queue`)
      expect(denied.status).toBe(403)

      fx.sessions.set(STUDENT)
      const studentDenied = await fetch(`${fx.baseUrl}/api/reviewer/queue`)
      expect(studentDenied.status).toBe(403)
    })

    it('evidence panel: reviewer 200 with panel shape, non-reviewer 403', async () => {
      fx.sessions.set(REVIEWER)
      const res = await fetch(
        `${fx.baseUrl}/api/reviewer/versions/${fx.publishedVersionId}`
      )
      expect(res.status).toBe(200)
      const panel = (await res.json()) as {
        version: { id: string; license: string }
        snapshotValid: boolean
        mediaManifest: unknown[]
        reports: unknown[]
        reviewHistory: unknown[]
      }
      expect(panel.version.id).toBe(fx.publishedVersionId)
      expect(panel.version.license).toBe('CC-BY-4.0')
      expect(panel.snapshotValid).toBe(true)

      fx.sessions.set(TEACHER)
      const denied = await fetch(
        `${fx.baseUrl}/api/reviewer/versions/${fx.publishedVersionId}`
      )
      expect(denied.status).toBe(403)
    })

    it('unknown reviewer route falls through to 404 (route is mounted)', async () => {
      fx.sessions.set(REVIEWER)
      const res = await fetch(`${fx.baseUrl}/api/reviewer/does-not-exist`)
      expect(res.status).toBe(404)
    })
  })

  describe('approve / reject', () => {
    it('reviewer approves a submitted version over HTTP', async () => {
      fx.sessions.set(REVIEWER)
      const res = await fetch(
        `${fx.baseUrl}/api/reviewer/versions/${fx.submittedVersionId}/approve`,
        { method: 'POST' }
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as { versionId: string; status: string }
      expect(body.status).toBe('approved')
      // Content unchanged (immutable iron law).
      const versions = fx.demo.listVersions(fx.submittedDemoId)
      const approved = versions.find((v) => v.id === fx.submittedVersionId)!
      expect(approved.status).toBe('approved')
    })

    it('non-reviewer approve -> 403', async () => {
      fx.sessions.set(TEACHER)
      const res = await fetch(
        `${fx.baseUrl}/api/reviewer/versions/${fx.submittedVersionId}/approve`,
        { method: 'POST' }
      )
      expect(res.status).toBe(403)
    })

    it('approve unknown version -> 404', async () => {
      fx.sessions.set(REVIEWER)
      const res = await fetch(`${fx.baseUrl}/api/reviewer/versions/missing/approve`, {
        method: 'POST'
      })
      expect(res.status).toBe(404)
    })

    it('approve an already-approved version -> 409', async () => {
      fx.sessions.set(REVIEWER)
      const res = await fetch(
        `${fx.baseUrl}/api/reviewer/versions/${fx.publishedVersionId}/approve`,
        { method: 'POST' }
      )
      expect(res.status).toBe(409)
    })

    it('reviewer rejects with a reason; reason persisted, content unchanged', async () => {
      fx.sessions.set(REVIEWER)
      const snapshotBefore = fx.demo
        .listVersions(fx.submittedDemoId)
        .find((v) => v.id === fx.submittedVersionId)!.snapshotDocumentJson
      const res = await fetch(
        `${fx.baseUrl}/api/reviewer/versions/${fx.submittedVersionId}/reject`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reason: 'low quality' })
        }
      )
      expect(res.status).toBe(200)
      const rejected = fx.demo
        .listVersions(fx.submittedDemoId)
        .find((v) => v.id === fx.submittedVersionId)!
      expect(rejected.status).toBe('rejected')
      expect(rejected.reviewerNote).toBe('low quality')
      expect(rejected.snapshotDocumentJson).toBe(snapshotBefore)
    })

    it('reject without a reason -> 400', async () => {
      fx.sessions.set(REVIEWER)
      const res = await fetch(
        `${fx.baseUrl}/api/reviewer/versions/${fx.submittedVersionId}/reject`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }
      )
      expect(res.status).toBe(400)
    })
  })

  describe('reports', () => {
    it('any logged-in user can report a published demo; report lands in the queue', async () => {
      fx.sessions.set(STUDENT)
      const res = await fetch(
        `${fx.baseUrl}/api/publications/${fx.publishedDemoId}/reports`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ category: 'copyright', reason: '未授权转载' })
        }
      )
      expect(res.status).toBe(201)
      const report = (await res.json()) as { id: string; status: string }
      expect(report.status).toBe('open')

      // The report is now visible in the reviewer queue.
      fx.sessions.set(REVIEWER)
      const queue = await fetch(`${fx.baseUrl}/api/reviewer/queue`)
      const body = (await queue.json()) as { reports: Array<{ id: string }> }
      expect(body.reports.some((r) => r.id === report.id)).toBe(true)
    })

    it('rejects invalid report bodies', async () => {
      fx.sessions.set(TEACHER)
      const missing = await fetch(
        `${fx.baseUrl}/api/publications/${fx.publishedDemoId}/reports`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ category: 'copyright' })
        }
      )
      expect(missing.status).toBe(400)

      const badCategory = await fetch(
        `${fx.baseUrl}/api/publications/${fx.publishedDemoId}/reports`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ category: 'bogus', reason: 'r' })
        }
      )
      expect(badCategory.status).toBe(400)
    })

    it('report on unknown demo -> 404', async () => {
      fx.sessions.set(TEACHER)
      const res = await fetch(`${fx.baseUrl}/api/publications/missing/reports`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ category: 'spam', reason: 'r' })
      })
      expect(res.status).toBe(404)
    })

    it('reviewer resolves an open report; it leaves the open queue + audits', async () => {
      fx.sessions.set(STUDENT)
      const create = await fetch(
        `${fx.baseUrl}/api/publications/${fx.publishedDemoId}/reports`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ category: 'spam', reason: 'r' })
        }
      )
      const report = (await create.json()) as { id: string; status: string }

      fx.sessions.set(REVIEWER)
      const resolve = await fetch(`${fx.baseUrl}/api/reviewer/reports/${report.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'resolved', note: 'confirmed violation' })
      })
      expect(resolve.status).toBe(200)
      const resolved = (await resolve.json()) as { status: string }
      expect(resolved.status).toBe('resolved')

      // No longer in the open queue.
      const queue = await fetch(`${fx.baseUrl}/api/reviewer/queue`)
      const qb = (await queue.json()) as { reports: Array<{ id: string }> }
      expect(qb.reports.some((r) => r.id === report.id)).toBe(false)

      // Create + resolve are both on the HMAC chain as `report` actions.
      await fx.audit.flush()
      const records = await fx.audit.query({ action: 'report' })
      expect(records.length).toBe(2)
      expect((await fx.audit.verifyIntegrity()).valid).toBe(true)
    })

    it('reviewer resolve rejects a bad status / missing note -> 400', async () => {
      fx.sessions.set(STUDENT)
      const create = await fetch(
        `${fx.baseUrl}/api/publications/${fx.publishedDemoId}/reports`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ category: 'spam', reason: 'r' })
        }
      )
      const report = (await create.json()) as { id: string }

      fx.sessions.set(REVIEWER)
      const badStatus = await fetch(`${fx.baseUrl}/api/reviewer/reports/${report.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'wat', note: 'n' })
      })
      expect(badStatus.status).toBe(400)

      const missingNote = await fetch(`${fx.baseUrl}/api/reviewer/reports/${report.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'dismissed', note: '' })
      })
      expect(missingNote.status).toBe(400)
    })

    it('non-reviewer cannot resolve a report -> 403', async () => {
      fx.sessions.set(STUDENT)
      const create = await fetch(
        `${fx.baseUrl}/api/publications/${fx.publishedDemoId}/reports`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ category: 'spam', reason: 'r' })
        }
      )
      const report = (await create.json()) as { id: string }

      fx.sessions.set(TEACHER) // teacher is not a reviewer
      const res = await fetch(`${fx.baseUrl}/api/reviewer/reports/${report.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'resolved', note: 'n' })
      })
      expect(res.status).toBe(403)
    })

    it('rejects a report whose reason contains PII -> 422', async () => {
      fx.sessions.set(STUDENT)
      const res = await fetch(
        `${fx.baseUrl}/api/publications/${fx.publishedDemoId}/reports`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ category: 'other', reason: 'contact me at 13800138000' })
        }
      )
      expect(res.status).toBe(422)
    })

    it('rejects a duplicate open report from the same reporter -> 400', async () => {
      fx.sessions.set(STUDENT)
      const first = await fetch(
        `${fx.baseUrl}/api/publications/${fx.publishedDemoId}/reports`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ category: 'spam', reason: 'r' })
        }
      )
      expect(first.status).toBe(201)
      const second = await fetch(
        `${fx.baseUrl}/api/publications/${fx.publishedDemoId}/reports`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ category: 'spam', reason: 'r2' })
        }
      )
      expect(second.status).toBe(400)
    })
  })

  describe('forced takedown', () => {
    it('reviewer forced takedown hides the demo and returns notifications + deadline', async () => {
      fx.sessions.set(REVIEWER)
      const res = await fetch(
        `${fx.baseUrl}/api/reviewer/publications/${fx.publishedDemoId}/takedown`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reason: 'copyright infringement' })
        }
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        takedown: boolean
        replaceDeadline: string
        notifications: unknown[]
      }
      expect(body.takedown).toBe(true)
      expect(Date.parse(body.replaceDeadline)).toBeGreaterThan(Date.now())
      // No references in this fixture -> no recipients, but the field exists.
      expect(Array.isArray(body.notifications)).toBe(true)
    })

    it('forced takedown without a reason -> 400', async () => {
      fx.sessions.set(REVIEWER)
      const res = await fetch(
        `${fx.baseUrl}/api/reviewer/publications/${fx.publishedDemoId}/takedown`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }
      )
      expect(res.status).toBe(400)
    })

    it('non-reviewer forced takedown -> 403', async () => {
      fx.sessions.set(TEACHER)
      const res = await fetch(
        `${fx.baseUrl}/api/reviewer/publications/${fx.publishedDemoId}/takedown`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reason: 'x' })
        }
      )
      expect(res.status).toBe(403)
    })

    it('forced takedown on unknown demo -> 404 with demonstration-not-found message', async () => {
      fx.sessions.set(REVIEWER)
      const res = await fetch(`${fx.baseUrl}/api/reviewer/publications/missing/takedown`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'x' })
      })
      expect(res.status).toBe(404)
      const body = (await res.json()) as { error: string }
      // DemoNotFoundError, not DemoVersionNotFoundError (a takedown targets a demo).
      expect(body.error).toMatch(/Demonstration not found/)
      expect(body.error).not.toMatch(/version/i)
    })
  })

  describe('appeals', () => {
    it('owner appeals a rejected version; reviewer resolves denied (uphold)', async () => {
      // Reject the submitted version first so there is an adverse decision.
      fx.review.reject('reviewer-1', fx.submittedVersionId, 'low quality')

      fx.sessions.set(TEACHER) // teacher-1 owns the demo
      const create = await fetch(
        `${fx.baseUrl}/api/publications/${fx.submittedDemoId}/appeals`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ versionId: fx.submittedVersionId, reason: 'please reconsider' })
        }
      )
      expect(create.status).toBe(201)
      const appeal = (await create.json()) as { id: string; status: string }
      expect(appeal.status).toBe('open')

      // Reviewer lists open appeals then resolves.
      fx.sessions.set(REVIEWER)
      const list = await fetch(`${fx.baseUrl}/api/reviewer/appeals`)
      expect(list.status).toBe(200)
      const listBody = (await list.json()) as { appeals: Array<{ id: string }> }
      expect(listBody.appeals.some((a) => a.id === appeal.id)).toBe(true)

      const resolve = await fetch(`${fx.baseUrl}/api/reviewer/appeals/${appeal.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'denied', note: 'upheld' })
      })
      expect(resolve.status).toBe(200)
      const resolved = (await resolve.json()) as { status: string }
      expect(resolved.status).toBe('denied')

      // Deny upholds the rejection: the version stays rejected.
      const version = fx.demo.listVersions(fx.submittedDemoId).find((v) => v.id === fx.submittedVersionId)!
      expect(version.status).toBe('rejected')
    })

    it('reviewer approves a rejection appeal -> version returns to submitted (re-review)', async () => {
      fx.review.reject('reviewer-1', fx.submittedVersionId, 'low quality')

      fx.sessions.set(TEACHER)
      const create = await fetch(
        `${fx.baseUrl}/api/publications/${fx.submittedDemoId}/appeals`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ versionId: fx.submittedVersionId, reason: 'please reconsider' })
        }
      )
      const appeal = (await create.json()) as { id: string }

      fx.sessions.set(REVIEWER)
      const resolve = await fetch(`${fx.baseUrl}/api/reviewer/appeals/${appeal.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'approved', note: 're-review' })
      })
      expect(resolve.status).toBe(200)

      // Approved rejection appeal restores the version to the review queue.
      const version = fx.demo.listVersions(fx.submittedDemoId).find((v) => v.id === fx.submittedVersionId)!
      expect(version.status).toBe('submitted')
    })

    it('reviewer approves a takedown appeal -> demo identity restored (un-takedown)', async () => {
      fx.sessions.set(REVIEWER)
      await fetch(
        `${fx.baseUrl}/api/reviewer/publications/${fx.publishedDemoId}/takedown`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reason: 'copyright infringement' })
        }
      )
      const takenDown = fx.db
        .prepare(`SELECT deleted_at FROM teaching_demonstrations WHERE id = ?`)
        .get(fx.publishedDemoId) as { deleted_at: string | null }
      expect(takenDown.deleted_at).not.toBeNull()

      fx.sessions.set(TEACHER) // owner appeals the takedown (no versionId)
      const create = await fetch(
        `${fx.baseUrl}/api/publications/${fx.publishedDemoId}/appeals`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reason: 'please restore' })
        }
      )
      expect(create.status).toBe(201)
      const appeal = (await create.json()) as { id: string }

      fx.sessions.set(REVIEWER)
      const resolve = await fetch(`${fx.baseUrl}/api/reviewer/appeals/${appeal.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'approved', note: 'takedown overturned' })
      })
      expect(resolve.status).toBe(200)

      // Approved takedown appeal restores the demo identity.
      const restored = fx.db
        .prepare(`SELECT deleted_at FROM teaching_demonstrations WHERE id = ?`)
        .get(fx.publishedDemoId) as { deleted_at: string | null }
      expect(restored.deleted_at).toBeNull()
    })

    it('non-owner cannot create an appeal -> 403', async () => {
      fx.sessions.set(STUDENT)
      const res = await fetch(
        `${fx.baseUrl}/api/publications/${fx.publishedDemoId}/appeals`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reason: 'x' })
        }
      )
      expect(res.status).toBe(403)
    })

    it('cannot appeal a published (non-adverse) demo -> 400', async () => {
      fx.sessions.set(TEACHER) // owner, but no adverse decision exists
      const res = await fetch(
        `${fx.baseUrl}/api/publications/${fx.publishedDemoId}/appeals`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reason: 'reconsider' })
        }
      )
      expect(res.status).toBe(400)
    })

    it('non-reviewer cannot resolve an appeal -> 403', async () => {
      fx.review.reject('reviewer-1', fx.submittedVersionId, 'low quality')
      fx.sessions.set(TEACHER)
      const create = await fetch(
        `${fx.baseUrl}/api/publications/${fx.submittedDemoId}/appeals`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ versionId: fx.submittedVersionId, reason: 'reconsider' })
        }
      )
      const appeal = (await create.json()) as { id: string }
      fx.sessions.set(TEACHER) // teacher is not a reviewer
      const res = await fetch(`${fx.baseUrl}/api/reviewer/appeals/${appeal.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'approved', note: 'ok' })
      })
      expect(res.status).toBe(403)
    })

    it('rejects a duplicate open appeal from the same appellant -> 400', async () => {
      fx.review.reject('reviewer-1', fx.submittedVersionId, 'low quality')
      fx.sessions.set(TEACHER)
      const first = await fetch(
        `${fx.baseUrl}/api/publications/${fx.submittedDemoId}/appeals`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ versionId: fx.submittedVersionId, reason: 'reconsider' })
        }
      )
      expect(first.status).toBe(201)
      const second = await fetch(
        `${fx.baseUrl}/api/publications/${fx.submittedDemoId}/appeals`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ versionId: fx.submittedVersionId, reason: 'reconsider again' })
        }
      )
      expect(second.status).toBe(400)
    })
  })

  describe('audit persistence over HTTP', () => {
    it('approve writes a governance audit record on the HMAC chain', async () => {
      fx.sessions.set(REVIEWER)
      const res = await fetch(
        `${fx.baseUrl}/api/reviewer/versions/${fx.submittedVersionId}/approve`,
        { method: 'POST' }
      )
      expect(res.status).toBe(200)

      await fx.audit.flush()
      const records = await fx.audit.query({ action: 'approve' })
      expect(records.length).toBe(1)
      expect(records[0]?.resourceType).toBe('demonstration')
      expect(records[0]?.actorId).toBe('reviewer-1')
      expect((await fx.audit.verifyIntegrity()).valid).toBe(true)
    })

    it('report create writes a report audit record', async () => {
      fx.sessions.set(TEACHER)
      await fetch(`${fx.baseUrl}/api/publications/${fx.publishedDemoId}/reports`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ category: 'spam', reason: 'r' })
      })
      await fx.audit.flush()
      const records = await fx.audit.query({ action: 'report' })
      expect(records.length).toBe(1)
      expect(records[0]?.resourceType).toBe('publication')
    })

    it('forced takedown writes a takedown audit record with forced=true', async () => {
      fx.sessions.set(REVIEWER)
      await fetch(
        `${fx.baseUrl}/api/reviewer/publications/${fx.publishedDemoId}/takedown`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reason: 'copyright infringement' })
        }
      )
      await fx.audit.flush()
      const records = await fx.audit.query({ action: 'takedown' })
      expect(records.length).toBe(1)
      expect(records[0]?.resourceType).toBe('demonstration')
      expect(records[0]?.metadata?.forced).toBe(true)
      expect((await fx.audit.verifyIntegrity()).valid).toBe(true)
    })
  })

  describe('evidence panel read-tolerance + privacy (spec §2.8 / §3.4 / §4.4)', () => {
    it('panel tolerates a corrupt snapshot (read-tolerant, spec §4.4)', async () => {
      fx.db
        .prepare(`UPDATE demonstration_versions SET snapshot_document_json = ? WHERE id = ?`)
        .run('{this is not valid json', fx.publishedVersionId)
      fx.sessions.set(REVIEWER)
      const res = await fetch(`${fx.baseUrl}/api/reviewer/versions/${fx.publishedVersionId}`)
      expect(res.status).toBe(200)
      const panel = (await res.json()) as { snapshotValid: boolean; snapshot: unknown }
      expect(panel.snapshotValid).toBe(false)
      expect(panel.snapshot).toBeNull()
    })

    it('panel carries no teaching-private data fields (spec §2.8 / §3.4)', async () => {
      fx.sessions.set(REVIEWER)
      const res = await fetch(`${fx.baseUrl}/api/reviewer/versions/${fx.publishedVersionId}`)
      expect(res.status).toBe(200)
      const panel: unknown = await res.json()
      const keys = collectKeys(panel)
      const forbidden = [
        'studentId', 'student', 'score', 'grade', 'attempt', 'mastery',
        'cohort', 'classId', 'enrollmentId', 'teachingUnitId', 'kpId',
        'personId', 'loginId', 'passwordHash'
      ]
      const hits = keys.filter((k) => forbidden.includes(k))
      expect(hits, `panel leaked teaching-private keys: ${hits.join(', ')}`).toEqual([])
    })
  })

  describe('demo audit sink governance mapping (spec §5.7)', () => {
    it('upgrade_reference event is recorded on the HMAC chain (not silently dropped)', async () => {
      const sink = createDemoAuditSink(fx.audit)
      sink({
        action: 'demo.upgrade_reference',
        actorId: 't-j',
        actorRole: 'system',
        resourceType: 'demonstration',
        resourceId: 'demo-x',
        detailJson: '{}'
      })
      await fx.audit.flush()
      const records = await fx.audit.query({ action: 'upgrade_reference' })
      expect(records.length).toBe(1)
      expect(records[0]?.resourceType).toBe('demonstration')
      expect((await fx.audit.verifyIntegrity()).valid).toBe(true)
    })
  })

  describe('reviewer isolation from teaching / audit data (spec §2.8)', () => {
    it('reviewer-flagged principal cannot view /api/audit (403); teacher can (200)', async () => {
      fx.sessions.set(REVIEWER)
      const denied = await fetch(`${fx.baseUrl}/api/audit`)
      expect(denied.status).toBe(403)

      fx.sessions.set(TEACHER)
      const ok = await fetch(`${fx.baseUrl}/api/audit`)
      expect(ok.status).toBe(200)
    })

    it('reviewer-flagged principal cannot view /api/cohort (403); teacher can (200)', async () => {
      fx.sessions.set(REVIEWER)
      const denied = await fetch(`${fx.baseUrl}/api/cohort`)
      expect(denied.status).toBe(403)

      fx.sessions.set(TEACHER)
      const ok = await fetch(`${fx.baseUrl}/api/cohort`)
      expect(ok.status).toBe(200)
    })
  })
})
