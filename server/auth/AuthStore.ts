/**
 * SQLite persistence for credentials + sessions, hanging on T01 `users`.
 * Schema bootstrap is idempotent so auth can open any product DB.
 */
import { randomBytes } from 'node:crypto'
import type Database from 'better-sqlite3'

export type ProductAuthRole = 'student' | 'teacher'

export interface AuthUserRow {
  id: string
  personId: string
  role: ProductAuthRole
  loginId: string
  displayName: string
  createdAt: string
}

export interface AuthCredentialRow {
  userId: string
  passwordHash: string | null
  activationCodeHash: string | null
  mustChangePassword: boolean
  createdAt: string
  updatedAt: string
}

export interface AuthSessionRow {
  id: string
  userId: string
  role: ProductAuthRole
  expiresAt: string
  createdAt: string
}

export interface CreateUserInput {
  id?: string
  personId?: string
  role: ProductAuthRole
  loginId: string
  displayName: string
  createdAt?: string
  passwordHash?: string | null
  activationCodeHash?: string | null
  mustChangePassword?: boolean
}

const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

export class AuthStore {
  public constructor(private readonly db: Database.Database) {
    ensureAuthSchema(this.db)
  }

  public findUserByLoginId(loginId: string): AuthUserRow | null {
    const row = this.db
      .prepare(
        `SELECT id, person_id, role, login_id, display_name, created_at
         FROM users WHERE login_id = ?`
      )
      .get(loginId) as UserSqlRow | undefined
    return row ? mapUser(row) : null
  }

  public findUserById(userId: string): AuthUserRow | null {
    const row = this.db
      .prepare(
        `SELECT id, person_id, role, login_id, display_name, created_at
         FROM users WHERE id = ?`
      )
      .get(userId) as UserSqlRow | undefined
    return row ? mapUser(row) : null
  }

  public getCredential(userId: string): AuthCredentialRow | null {
    const row = this.db
      .prepare(
        `SELECT user_id, password_hash, activation_code_hash,
                must_change_password, created_at, updated_at
         FROM auth_credentials WHERE user_id = ?`
      )
      .get(userId) as CredentialSqlRow | undefined
    return row ? mapCredential(row) : null
  }

  public createUser(input: CreateUserInput): AuthUserRow {
    const now = input.createdAt ?? new Date().toISOString()
    const user: AuthUserRow = {
      id: input.id ?? `user_${randomBytes(12).toString('hex')}`,
      personId: input.personId ?? `person_${randomBytes(12).toString('hex')}`,
      role: input.role,
      loginId: input.loginId,
      displayName: input.displayName,
      createdAt: now
    }

    const insertUser = this.db.prepare(
      `INSERT INTO users (id, person_id, role, login_id, display_name, created_at)
       VALUES (@id, @personId, @role, @loginId, @displayName, @createdAt)`
    )
    const insertCred = this.db.prepare(
      `INSERT INTO auth_credentials
         (user_id, password_hash, activation_code_hash, must_change_password, created_at, updated_at)
       VALUES (@userId, @passwordHash, @activationCodeHash, @mustChangePassword, @createdAt, @updatedAt)`
    )

    const run = this.db.transaction(() => {
      insertUser.run({
        id: user.id,
        personId: user.personId,
        role: user.role,
        loginId: user.loginId,
        displayName: user.displayName,
        createdAt: user.createdAt
      })
      insertCred.run({
        userId: user.id,
        passwordHash: input.passwordHash ?? null,
        activationCodeHash: input.activationCodeHash ?? null,
        mustChangePassword: input.mustChangePassword === true ? 1 : 0,
        createdAt: now,
        updatedAt: now
      })
    })
    run()
    return user
  }

  public setPassword(
    userId: string,
    passwordHash: string,
    options: { clearActivation?: boolean; mustChangePassword?: boolean } = {}
  ): void {
    const now = new Date().toISOString()
    const clearActivation = options.clearActivation ?? true
    const mustChange = options.mustChangePassword === true ? 1 : 0
    if (clearActivation) {
      this.db
        .prepare(
          `UPDATE auth_credentials
           SET password_hash = @passwordHash,
               activation_code_hash = NULL,
               must_change_password = @mustChangePassword,
               updated_at = @updatedAt
           WHERE user_id = @userId`
        )
        .run({
          userId,
          passwordHash,
          mustChangePassword: mustChange,
          updatedAt: now
        })
      return
    }
    this.db
      .prepare(
        `UPDATE auth_credentials
         SET password_hash = @passwordHash,
             must_change_password = @mustChangePassword,
             updated_at = @updatedAt
         WHERE user_id = @userId`
      )
      .run({
        userId,
        passwordHash,
        mustChangePassword: mustChange,
        updatedAt: now
      })
  }

  public createSession(
    userId: string,
    role: ProductAuthRole,
    options: { ttlMs?: number; sessionId?: string; now?: Date } = {}
  ): AuthSessionRow {
    const now = options.now ?? new Date()
    const ttlMs = options.ttlMs ?? DEFAULT_SESSION_TTL_MS
    const session: AuthSessionRow = {
      id: options.sessionId ?? randomBytes(32).toString('base64url'),
      userId,
      role,
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
      createdAt: now.toISOString()
    }
    this.db
      .prepare(
        `INSERT INTO auth_sessions (id, user_id, role, expires_at, created_at)
         VALUES (@id, @userId, @role, @expiresAt, @createdAt)`
      )
      .run(session)
    return session
  }

  public findSession(sessionId: string): AuthSessionRow | null {
    const row = this.db
      .prepare(
        `SELECT id, user_id, role, expires_at, created_at
         FROM auth_sessions WHERE id = ?`
      )
      .get(sessionId) as SessionSqlRow | undefined
    return row ? mapSession(row) : null
  }

  public deleteSession(sessionId: string): void {
    this.db.prepare(`DELETE FROM auth_sessions WHERE id = ?`).run(sessionId)
  }

  public deleteSessionsForUser(userId: string): void {
    this.db.prepare(`DELETE FROM auth_sessions WHERE user_id = ?`).run(userId)
  }

  public purgeExpiredSessions(now: Date = new Date()): number {
    const result = this.db
      .prepare(`DELETE FROM auth_sessions WHERE expires_at <= ?`)
      .run(now.toISOString())
    return Number(result.changes)
  }
}

export function ensureAuthSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_credentials (
      user_id TEXT PRIMARY KEY,
      password_hash TEXT,
      activation_code_hash TEXT,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user
      ON auth_sessions (user_id);
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires
      ON auth_sessions (expires_at);
  `)
}

interface UserSqlRow {
  id: string
  person_id: string
  role: string
  login_id: string
  display_name: string
  created_at: string
}

interface CredentialSqlRow {
  user_id: string
  password_hash: string | null
  activation_code_hash: string | null
  must_change_password: number
  created_at: string
  updated_at: string
}

interface SessionSqlRow {
  id: string
  user_id: string
  role: string
  expires_at: string
  created_at: string
}

function mapUser(row: UserSqlRow): AuthUserRow {
  if (row.role !== 'student' && row.role !== 'teacher') {
    throw new Error(`Unexpected user role in DB: ${row.role}`)
  }
  return {
    id: row.id,
    personId: row.person_id,
    role: row.role,
    loginId: row.login_id,
    displayName: row.display_name,
    createdAt: row.created_at
  }
}

function mapCredential(row: CredentialSqlRow): AuthCredentialRow {
  return {
    userId: row.user_id,
    passwordHash: row.password_hash,
    activationCodeHash: row.activation_code_hash,
    mustChangePassword: row.must_change_password === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapSession(row: SessionSqlRow): AuthSessionRow {
  if (row.role !== 'student' && row.role !== 'teacher') {
    throw new Error(`Unexpected session role in DB: ${row.role}`)
  }
  return {
    id: row.id,
    userId: row.user_id,
    role: row.role,
    expiresAt: row.expires_at,
    createdAt: row.created_at
  }
}
