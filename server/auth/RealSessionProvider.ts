/**
 * Real (production) session resolver: HttpOnly cookie → SQLite session row.
 *
 * T02 decision: server-side sessions, not bare JWT. The cookie carries an
 * opaque session id; auth state lives in `auth_sessions` (revocable).
 *
 * Alias: AuthSessionProvider (decision naming).
 */
import type { IncomingMessage } from 'node:http'
import type Database from 'better-sqlite3'
import { AuthStore } from './AuthStore'
import { readSessionId, SESSION_COOKIE_NAME } from './cookies'
import { AuthError } from './errors'
import type { SessionProvider, SessionUser } from './SessionProvider'

export type RealSessionProviderOptions =
  | {
      store: AuthStore
      cookieName?: string
    }
  | {
      db: Database.Database
      store?: AuthStore
      cookieName?: string
    }

export class RealSessionProvider implements SessionProvider {
  private readonly store: AuthStore
  private readonly cookieName: string

  public constructor(options: RealSessionProviderOptions) {
    if ('store' in options && options.store !== undefined) {
      this.store = options.store
    } else if ('db' in options) {
      this.store = new AuthStore(options.db)
    } else {
      throw new Error('RealSessionProvider requires db or store')
    }
    this.cookieName = options.cookieName ?? SESSION_COOKIE_NAME
  }

  public resolve(request: IncomingMessage): SessionUser {
    const sessionId = readSessionId(request, this.cookieName)
    if (sessionId === undefined) {
      throw new AuthError('unauthorized', 'Not authenticated')
    }

    const session = this.store.findSession(sessionId)
    if (session === null) {
      throw new AuthError('unauthorized', 'Session not found')
    }
    if (Date.parse(session.expiresAt) <= Date.now()) {
      this.store.deleteSession(sessionId)
      throw new AuthError('unauthorized', 'Session expired')
    }

    const user = this.store.findUserById(session.userId)
    if (user === null) {
      this.store.deleteSession(sessionId)
      throw new AuthError('unauthorized', 'User not found')
    }

    const sessionUser: SessionUser = {
      userId: user.id,
      role: user.role,
      displayName: user.displayName,
      actorSource: 'auth'
    }
    if (user.role === 'student') {
      sessionUser.studentId = user.id
    }
    return sessionUser
  }
}

/** Decision-doc name for the same provider. */
export { RealSessionProvider as AuthSessionProvider }
