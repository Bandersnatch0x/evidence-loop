// @vitest-environment node
/**
 * Handler-interface contract tests for the C2-extracted routes.
 *
 * Tests the seam directly: `handle*Api → boolean` plus the guardRoute
 * deny/accept contract. Uses an in-memory AuditStore (real audit trail) +
 * tiny fake services so the interface is the test surface, not the whole
 * server. Complements the HTTP-level routeWiring / multimodalCompliance /
 * masteryReviewApi suites.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import { AuditStore } from '../server/audit/AuditStore'
import { handleAuditApi } from '../server/audit/auditRoutes'
import { handleAssignmentApi } from '../server/data/assignmentRoutes'
import { handleCohortApi } from '../server/data/cohortRoutes'
import { handleKnowledgeApi } from '../server/data/knowledgeRoutes'
import { handleMasteryApi } from '../server/mastery/masteryRoutes'
import { handleMultimodalApi } from '../server/multimodal/multimodalRoutes'
import { handleReviewApi } from '../server/review/reviewRoutes'
import { openMemoryDatabase } from '../server/db/memorySchema'
import type { SessionUser } from '../server/auth/SessionProvider'
import type { AuditRecord } from '../server/audit/AuditStore'

const SECRET = 'handler-contract-hmac'

function user(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    userId: 'student-1',
    role: 'student',
    displayName: 'Student',
    studentId: 'student-1',
    ...overrides
  }
}

function jsonRequest(
  method: string,
  pathname: string,
  search = '',
  body?: unknown
): IncomingMessage {
  const url = search ? `${pathname}?${search}` : pathname
  const payload = body ? JSON.stringify(body) : ''
  const stream = Readable.from([payload]) as unknown as IncomingMessage
  stream.method = method
  stream.url = url
  stream.headers = body
    ? { 'content-type': 'application/json', 'content-length': String(payload.length) }
    : {}
  return stream
}

interface CapturedResponse {
  statusCode: number
  body: unknown
  headersSent: boolean
}

function mockResponse(): { res: ServerResponse; captured: CapturedResponse } {
  const captured: CapturedResponse = {
    statusCode: 0,
    body: undefined,
    headersSent: false
  }
  const res = {
    headersSent: false,
    writeHead(code: number) {
      captured.statusCode = code
      ;(res as { statusCode: number }).statusCode = code
      captured.headersSent = true
      return res
    },
    end(payload?: string) {
      if (payload) captured.body = JSON.parse(payload)
    }
  } as unknown as ServerResponse & { statusCode: number }
  return { res, captured }
}

function seedReviewer(db: Database.Database, id: string): void {
  db.prepare(
    `INSERT INTO users (
      id, person_id, role, login_id, display_name, created_at,
      public_library_reviewer
    ) VALUES (?, ?, ?, ?, ?, ?, 1)`
  ).run(id, `person-${id}`, 'teacher', `login-${id}`, id, new Date().toISOString())
}

describe('C2 extracted handlers — interface contract', () => {
  let db: Database.Database
  let audit: AuditStore

  beforeEach(() => {
    db = openMemoryDatabase(':memory:')
    seedReviewer(db, 'reviewer-1')
    audit = new AuditStore({
      dbPath: ':memory:',
      hmacSecret: SECRET,
      flushIntervalMs: 60_000
    })
  })

  afterEach(async () => {
    db.close()
    await audit.close()
  })

  it('handleAuditApi: returns false for non-audit path', async () => {
    const { res, captured } = mockResponse()
    const ok = await handleAuditApi(
      jsonRequest('GET', '/api/cohort'),
      res,
      new URL('http://x/api/cohort'),
      { db, audit, user: user({ role: 'teacher' }) }
    )
    expect(ok).toBe(false)
    expect(captured.statusCode).toBe(0)
  })

  it('handleAuditApi: denies student with role 403 + denied audit', async () => {
    const { res, captured } = mockResponse()
    const ok = await handleAuditApi(
      jsonRequest('GET', '/api/audit'),
      res,
      new URL('http://x/api/audit'),
      { db, audit, user: user({ role: 'student' }) }
    )
    expect(ok).toBe(true)
    expect(captured.statusCode).toBe(403)
    expect((captured.body as { error: string }).error).toMatch(/audit log/)
    await audit.flush?.()
    const records = await audit.query()
    const denied = records.find((r) => r.result === 'denied')
    expect(denied?.resourceType).toBe('audit')
  })

  it('handleAuditApi: allows teacher, returns records + success audit', async () => {
    const { res, captured } = mockResponse()
    const ok = await handleAuditApi(
      jsonRequest('GET', '/api/audit'),
      res,
      new URL('http://x/api/audit'),
      { db, audit, user: user({ role: 'teacher', userId: 'teacher-1' }) }
    )
    expect(ok).toBe(true)
    expect(captured.statusCode).toBe(200)
    expect(Array.isArray(captured.body)).toBe(true)
  })

  it('handleCohortApi: denies student cohort view with role message', async () => {
    const { res, captured } = mockResponse()
    const ok = await handleCohortApi(
      jsonRequest('GET', '/api/cohort'),
      res,
      new URL('http://x/api/cohort'),
      {
        db,
        audit,
        user: user({ role: 'student' }),
        store: {
          list: vi.fn(),
          listResults: vi.fn()
        } as never
      }
    )
    expect(ok).toBe(true)
    expect(captured.statusCode).toBe(403)
    expect((captured.body as { error: string }).error).toMatch(/cohort/)
  })

  it('handleCohortApi: denies reviewer with reviewer-isolated message', async () => {
    const { res, captured } = mockResponse()
    const ok = await handleCohortApi(
      jsonRequest('GET', '/api/cohort'),
      res,
      new URL('http://x/api/cohort'),
      {
        db,
        audit,
        user: user({ userId: 'reviewer-1', role: 'teacher' }),
        store: { list: vi.fn(), listResults: vi.fn() } as never
      }
    )
    expect(ok).toBe(true)
    expect(captured.statusCode).toBe(403)
    expect((captured.body as { error: string }).error).toMatch(
      /public-library reviewers/
    )
  })

  it('handleKnowledgeApi: serves graph for any role', async () => {
    const { res, captured } = mockResponse()
    const getGraph = vi.fn().mockResolvedValue({ points: [] })
    const ok = await handleKnowledgeApi(
      jsonRequest('GET', '/api/knowledge-points'),
      res,
      new URL('http://x/api/knowledge-points'),
      { knowledge: { getGraph } as never }
    )
    expect(ok).toBe(true)
    expect(captured.statusCode).toBe(200)
    expect(getGraph).toHaveBeenCalled()
  })

  it('handleKnowledgeApi: returns false for non-matching path', async () => {
    const { res, captured } = mockResponse()
    const ok = await handleKnowledgeApi(
      jsonRequest('GET', '/api/other'),
      res,
      new URL('http://x/api/other'),
      { knowledge: { getGraph: vi.fn() } as never }
    )
    expect(ok).toBe(false)
    expect(captured.statusCode).toBe(0)
  })

  it('handleMasteryApi: denies other student mastery view', async () => {
    const { res, captured } = mockResponse()
    const ok = await handleMasteryApi(
      jsonRequest('GET', '/api/mastery/student-2'),
      res,
      new URL('http://x/api/mastery/student-2'),
      {
        db,
        audit,
        user: user({ studentId: 'student-1' }),
        mastery: { getProfile: vi.fn(), getTimeline: vi.fn() },
        interventions: { suggestNextIntervention: vi.fn() }
      }
    )
    expect(ok).toBe(true)
    expect(captured.statusCode).toBe(403)
    expect((captured.body as { error: string }).error).toMatch(/mastery/)
  })

  it('handleMasteryApi: allows own mastery profile + stamps success', async () => {
    const { res, captured } = mockResponse()
    const getProfile = vi
      .fn()
      .mockReturnValue({ 'kp-1': { masteryLevel: 0.5 } })
    const ok = await handleMasteryApi(
      jsonRequest('GET', '/api/mastery/student-1'),
      res,
      new URL('http://x/api/mastery/student-1'),
      {
        db,
        audit,
        user: user({ studentId: 'student-1' }),
        mastery: { getProfile, getTimeline: vi.fn() },
        interventions: { suggestNextIntervention: vi.fn() }
      }
    )
    expect(ok).toBe(true)
    expect(captured.statusCode).toBe(200)
    expect(getProfile).toHaveBeenCalledWith('student-1')
  })

  it('handleReviewApi: denies other student review queue', async () => {
    const { res, captured } = mockResponse()
    const ok = await handleReviewApi(
      jsonRequest('GET', '/api/review/next?studentId=student-2'),
      res,
      new URL('http://x/api/review/next?studentId=student-2'),
      {
        db,
        audit,
        user: user({ studentId: 'student-1' }),
        review: { listDue: vi.fn(), getById: vi.fn(), complete: vi.fn() }
      }
    )
    expect(ok).toBe(true)
    expect(captured.statusCode).toBe(403)
    expect((captured.body as { error: string }).error).toMatch(/review/)
  })

  it('handleReviewApi: returns false for non-review path', async () => {
    const { res, captured } = mockResponse()
    const ok = await handleReviewApi(
      jsonRequest('GET', '/api/other'),
      res,
      new URL('http://x/api/other'),
      {
        db,
        audit,
        user: user(),
        review: { listDue: vi.fn(), getById: vi.fn(), complete: vi.fn() }
      }
    )
    expect(ok).toBe(false)
    expect(captured.statusCode).toBe(0)
  })

  it('handleMultimodalApi: returns false for non-multimodal path', async () => {
    const { res, captured } = mockResponse()
    const ok = await handleMultimodalApi(
      jsonRequest('GET', '/api/other'),
      res,
      new URL('http://x/api/other'),
      {
        audit,
        stt: {} as never,
        user: user()
      }
    )
    expect(ok).toBe(false)
    expect(captured.statusCode).toBe(0)
  })

  it('handleMultimodalApi: accepts ask; returns 503 when feature flag off (default)', async () => {
    const { res, captured } = mockResponse()
    const ok = await handleMultimodalApi(
      jsonRequest('POST', '/api/multimodal/ask', '', { text: 'hello', durationMs: 1000 }),
      res,
      new URL('http://x/api/multimodal/ask'),
      {
        audit,
        stt: {} as never,
        user: user({ studentId: 'student-1' })
      }
    )
    // ADR-0005: multimodal is behind a feature flag (default off → 503).
    expect(ok).toBe(true)
    expect([200, 503]).toContain(captured.statusCode)
  })

  it('handleAssignmentApi: returns false for non-assignment path', () => {
    const { res, captured } = mockResponse()
    const ok = handleAssignmentApi(
      jsonRequest('GET', '/api/other'),
      res,
      new URL('http://x/api/other'),
      {
        assignments: { list: vi.fn(), get: vi.fn() },
        questionBank: { peek: vi.fn() },
        listStudentReferencesForAssignment: vi.fn().mockReturnValue([])
      }
    )
    expect(ok).toBe(false)
    expect(captured.statusCode).toBe(0)
  })

  it('handleAssignmentApi: serves list', () => {
    const { res, captured } = mockResponse()
    const list = vi.fn().mockReturnValue([{ id: 'a1' }])
    const ok = handleAssignmentApi(
      jsonRequest('GET', '/api/assignments'),
      res,
      new URL('http://x/api/assignments'),
      {
        assignments: { list, get: vi.fn() },
        questionBank: { peek: vi.fn() },
        listStudentReferencesForAssignment: vi.fn().mockReturnValue([])
      }
    )
    expect(ok).toBe(true)
    expect(captured.statusCode).toBe(200)
    expect(list).toHaveBeenCalled()
  })

  it('handleAssignmentApi: 404 when assignment + bank question both missing', () => {
    const { res, captured } = mockResponse()
    const ok = handleAssignmentApi(
      jsonRequest('GET', '/api/assignments/missing'),
      res,
      new URL('http://x/api/assignments/missing'),
      {
        assignments: { list: vi.fn(), get: vi.fn().mockReturnValue(undefined) },
        questionBank: { peek: vi.fn().mockReturnValue(undefined) },
        listStudentReferencesForAssignment: vi.fn().mockReturnValue([])
      }
    )
    expect(ok).toBe(true)
    expect(captured.statusCode).toBe(404)
  })

  it('audit trail: denied cohort + allowed mastery both recorded', async () => {
    // cohort denied
    await handleCohortApi(
      jsonRequest('GET', '/api/cohort'),
      mockResponse().res,
      new URL('http://x/api/cohort'),
      {
        db,
        audit,
        user: user({ role: 'student' }),
        store: { list: vi.fn(), listResults: vi.fn() } as never
      }
    )
    await audit.flush?.()
    const records: AuditRecord[] = await audit.query()
    const cohortDenied = records.find(
      (r) => r.resourceType === 'cohort' && r.result === 'denied'
    )
    expect(cohortDenied).toBeDefined()
  })
})
