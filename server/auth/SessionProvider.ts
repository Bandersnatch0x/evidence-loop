import type { IncomingMessage } from 'node:http'
import type { DemoRole } from '../../shared/contracts'

/** Demo / production role set for access control. */
export type { DemoRole }

export interface SessionUser {
  userId: string
  role: DemoRole
  displayName: string
  /** Present for student sessions; used to scope evaluation ownership. */
  studentId?: string
  /** Present for teacher sessions; demo uses a single cohort. */
  cohortId?: string
  /**
   * Provenance of the session principal (T02).
   * - demo: MockSessionProvider / AUTH_MODE=mock
   * - auth: RealSessionProvider server-side session
   */
  actorSource?: 'demo' | 'auth'
}

/**
 * Session abstraction. Demo uses header-based MockSessionProvider;
 * production swaps in RealSessionProvider (cookie → SQLite session) without
 * touching business routes. Interface shape is stable (expand-contract).
 */
export interface SessionProvider {
  resolve(request: IncomingMessage): SessionUser
}

export const DEMO_ROLES = ['student', 'teacher', 'admin', 'parent'] as const satisfies readonly DemoRole[]

export function isDemoRole(value: string): value is DemoRole {
  return (DEMO_ROLES as readonly string[]).includes(value)
}
