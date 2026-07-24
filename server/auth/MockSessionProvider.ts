import type { IncomingMessage } from 'node:http'
import {
  isDemoRole,
  type DemoRole,
  type SessionProvider,
  type SessionUser
} from './SessionProvider'

export const DEMO_ROLE_HEADER = 'x-demo-role'

/** Hard-coded demo principals — not authentication, just role switching. */
export const DEMO_USERS: Record<DemoRole, SessionUser> = {
  student: {
    userId: 'learner-demo',
    role: 'student',
    displayName: '当前演示学员',
    studentId: 'learner-demo',
    cohortId: 'july-cohort',
    actorSource: 'demo'
  },
  teacher: {
    userId: 'teacher-demo',
    role: 'teacher',
    displayName: '演示教师',
    cohortId: 'july-cohort',
    actorSource: 'demo'
  },
  admin: {
    userId: 'admin-demo',
    role: 'admin',
    displayName: '演示管理员',
    actorSource: 'demo'
  }
}

/**
 * Demo / AUTH_MODE=mock session provider.
 * `X-Demo-Role` is intentionally only meaningful when this provider is installed
 * (i.e. AUTH_MODE=mock or DEMO_AUTH=true). Production uses RealSessionProvider.
 */
export class MockSessionProvider implements SessionProvider {
  public resolve(request: IncomingMessage): SessionUser {
    const rawHeader = request.headers[DEMO_ROLE_HEADER]
    const raw = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader
    const normalized = (raw ?? 'student').trim().toLowerCase()

    if (isDemoRole(normalized)) {
      return DEMO_USERS[normalized]
    }

    // Unknown role falls back to student — never elevates privileges.
    return DEMO_USERS.student
  }
}

export const SECURITY_WARNING_HEADER = 'X-Security-Warning'
export const SECURITY_WARNING_VALUE =
  'Demo environment - no authentication'
