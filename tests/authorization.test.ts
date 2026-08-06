// @vitest-environment node
/** authorization — shared route-access helpers (C4 deepening, #38). */
import { describe, it, expect } from 'vitest'
import { canAccessStudent } from '../server/auth/authorization'
import type { SessionUser } from '../server/auth/SessionProvider'

function user(overrides: Partial<SessionUser>): SessionUser {
  return {
    userId: 'u1',
    role: 'student',
    ...overrides
  } as SessionUser
}

describe('canAccessStudent', () => {
  it('allows teachers and admins to access any student', () => {
    expect(canAccessStudent(user({ role: 'teacher' }), 'student-9')).toBe(true)
    expect(canAccessStudent(user({ role: 'admin' }), 'student-9')).toBe(true)
  })

  it('allows a student to access their own record', () => {
    expect(
      canAccessStudent(user({ studentId: 's1' }), 's1')
    ).toBe(true)
  })

  it('denies a student access to another student\'s record', () => {
    expect(
      canAccessStudent(user({ studentId: 's1' }), 's2')
    ).toBe(false)
  })

  it('falls back to userId for demo sessions without a studentId', () => {
    expect(
      canAccessStudent(user({ userId: 'demo-1', studentId: undefined }), 'demo-1')
    ).toBe(true)
    expect(
      canAccessStudent(user({ userId: 'demo-1', studentId: undefined }), 'other')
    ).toBe(false)
  })

  it('denies unknown roles', () => {
    expect(
      canAccessStudent(user({ role: 'public_reviewer' as SessionUser['role'] }), 's1')
    ).toBe(false)
  })
})