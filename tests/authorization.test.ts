// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { authorizeAccess } from '../server/auth/authorization'
import type { SessionUser } from '../server/auth/SessionProvider'
import { openMemoryDatabase } from '../server/db/memorySchema'

function user(overrides: Partial<SessionUser>): SessionUser {
  return {
    userId: 'student-user',
    role: 'student',
    displayName: 'User',
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

describe('authorizeAccess', () => {
  let db: Database.Database

  beforeEach(() => {
    db = openMemoryDatabase(':memory:')
    seedReviewer(db, 'reviewer-1')
  })

  afterEach(() => {
    db.close()
  })

  it('allows ordinary teachers/admins and denies students for teaching policy', () => {
    expect(authorizeAccess(db, user({ userId: 'teacher-1', role: 'teacher' }), {
      purpose: 'teaching'
    })).toEqual({ allowed: true })
    expect(authorizeAccess(db, user({ role: 'student' }), {
      purpose: 'teaching'
    })).toEqual({ allowed: false, reason: 'role' })
  })

  it('denies reviewer-flagged teachers all teaching and student-data access', () => {
    const reviewer = user({ userId: 'reviewer-1', role: 'teacher' })
    expect(authorizeAccess(db, reviewer, { purpose: 'teaching' }))
      .toEqual({ allowed: false, reason: 'reviewer-isolated' })
    expect(authorizeAccess(db, reviewer, {
      purpose: 'student-data',
      studentId: 'student-2'
    })).toEqual({ allowed: false, reason: 'reviewer-isolated' })
  })

  it('allows students only their own record, with userId demo fallback', () => {
    expect(authorizeAccess(db, user({ studentId: 'student-1' }), {
      purpose: 'student-data',
      studentId: 'student-1'
    })).toEqual({ allowed: true })
    expect(authorizeAccess(db, user({ studentId: 'student-1' }), {
      purpose: 'student-data',
      studentId: 'student-2'
    })).toEqual({ allowed: false, reason: 'student-isolated' })
    expect(authorizeAccess(db, user({ userId: 'demo-1', studentId: undefined }), {
      purpose: 'student-data',
      studentId: 'demo-1'
    })).toEqual({ allowed: true })
  })

  it('allows ordinary teachers/admins to access student data', () => {
    expect(authorizeAccess(db, user({ userId: 'teacher-1', role: 'teacher' }), {
      purpose: 'student-data',
      studentId: 'student-9'
    })).toEqual({ allowed: true })
  })
})
