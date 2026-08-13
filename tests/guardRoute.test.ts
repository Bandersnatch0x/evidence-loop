// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import type { ServerResponse } from 'node:http'
import { guardRoute } from '../server/http/guardRoute'
import type { SessionUser } from '../server/auth/SessionProvider'
import { openMemoryDatabase } from '../server/db/memorySchema'

function user(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    userId: 'user-1',
    role: 'teacher',
    displayName: 'Teacher',
    ...overrides
  }
}

function seedReviewer(db: Database.Database, id: string): void {
  db.prepare(
    `INSERT INTO users (
      id, person_id, role, login_id, display_name, created_at,
      public_library_reviewer
    ) VALUES (?, ?, ?, ?, ?, ?, 1)`
  ).run(id, `person-${id}`, 'teacher', `login-${id}`, id, new Date().toISOString())
}

interface MockResponse extends ServerResponse {
  statusCode: number
  body: unknown
}

function mockResponse(): MockResponse {
  const state: { statusCode: number; body: unknown } = {
    statusCode: 0,
    body: undefined
  }
  const response = {
    statusCode: 0,
    body: undefined as unknown,
    headersSent: false,
    writeHead(code: number) {
      state.statusCode = code
      response.statusCode = code
      return response
    },
    end(payload?: string) {
      if (payload) {
        state.body = JSON.parse(payload)
        response.body = state.body
      }
    }
  }
  return response as unknown as MockResponse
}

describe('guardRoute', () => {
  let db: Database.Database
  const enqueue = vi.fn()

  beforeEach(() => {
    db = openMemoryDatabase(':memory:')
    seedReviewer(db, 'reviewer-1')
    enqueue.mockReset()
  })

  afterEach(() => {
    db.close()
  })

  it('allows teaching access and returns a bound auditor', () => {
    const response = mockResponse()
    const result = guardRoute({
      db,
      audit: { enqueue },
      user: user({ role: 'teacher' }),
      response,
      request: { purpose: 'teaching' },
      action: 'view',
      resourceType: 'cohort',
      forbidden: {
        default: 'Forbidden: cohort view requires teacher or admin role',
        'reviewer-isolated':
          'Forbidden: public-library reviewers may not view cohort data'
      }
    })

    expect(result.allowed).toBe(true)
    if (!result.allowed) return
    result.auditor.record({ result: 'success' })
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'view',
        resourceType: 'cohort',
        result: 'success'
      })
    )
    expect(response.statusCode).toBe(0)
  })

  it('denies students on teaching routes with role message', () => {
    const response = mockResponse()
    const result = guardRoute({
      db,
      audit: { enqueue },
      user: user({ role: 'student' }),
      response,
      request: { purpose: 'teaching' },
      action: 'view',
      resourceType: 'cohort',
      forbidden: {
        default: 'Forbidden: cohort view requires teacher or admin role',
        'reviewer-isolated':
          'Forbidden: public-library reviewers may not view cohort data'
      }
    })

    expect(result).toEqual({ allowed: false })
    expect(response.statusCode).toBe(403)
    expect(response.body).toEqual({
      error: 'Forbidden: cohort view requires teacher or admin role'
    })
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        result: 'denied',
        action: 'view',
        resourceType: 'cohort'
      })
    )
  })

  it('denies reviewers with reviewer-isolated message and metadata', () => {
    const response = mockResponse()
    const result = guardRoute({
      db,
      audit: { enqueue },
      user: user({ userId: 'reviewer-1', role: 'teacher' }),
      response,
      request: { purpose: 'teaching' },
      action: 'view',
      resourceType: 'audit',
      forbidden: {
        default: 'Forbidden: audit log requires teacher or admin role',
        'reviewer-isolated':
          'Forbidden: public-library reviewers may not view audit data'
      }
    })

    expect(result).toEqual({ allowed: false })
    expect(response.body).toEqual({
      error: 'Forbidden: public-library reviewers may not view audit data'
    })
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        result: 'denied',
        metadata: { reason: 'reviewer-isolated' }
      })
    )
  })

  it('student-data gate can omit reviewer reason stamp', () => {
    const response = mockResponse()
    guardRoute({
      db,
      audit: { enqueue },
      user: user({ role: 'student', studentId: 's1' }),
      response,
      request: { purpose: 'student-data', studentId: 's2' },
      action: 'view',
      resourceType: 'knowledge',
      forbidden: 'Forbidden: cannot view mastery for this student',
      studentId: 's2',
      deniedMetadata: { resource: 'mastery' },
      stampReviewerReason: false
    })

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        result: 'denied',
        studentId: 's2',
        metadata: { resource: 'mastery' }
      })
    )
  })
})
