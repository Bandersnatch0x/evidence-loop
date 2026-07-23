import type { IncomingMessage } from 'node:http'

/** Demo / production role set for access control. */
export type DemoRole = 'student' | 'teacher' | 'admin'

export interface SessionUser {
  userId: string
  role: DemoRole
  displayName: string
  /** Present for student sessions; used to scope evaluation ownership. */
  studentId?: string
  /** Present for teacher sessions; demo uses a single cohort. */
  cohortId?: string
}

/**
 * Session abstraction. Demo uses header-based MockSessionProvider;
 * production can swap in CasSessionProvider (or JWT) without touching routes.
 */
export interface SessionProvider {
  resolve(request: IncomingMessage): SessionUser
}

export const DEMO_ROLES = ['student', 'teacher', 'admin'] as const satisfies readonly DemoRole[]

export function isDemoRole(value: string): value is DemoRole {
  return (DEMO_ROLES as readonly string[]).includes(value)
}
