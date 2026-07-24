/**
 * Auth use-cases: teacher self-register, student import/activate, login/logout.
 * Password hashing uses node:crypto scrypt (see password.ts).
 */
import type { AuthStore, AuthUserRow, ProductAuthRole } from './AuthStore'
import { AuthError } from './errors'
import {
  generateActivationCode,
  hashActivationCode,
  hashPassword,
  verifyActivationCode,
  verifyPassword
} from './password'

const MIN_PASSWORD_LENGTH = 8
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

export interface TeacherRegisterInput {
  email: string
  password: string
  displayName: string
}

export interface LoginInput {
  loginId: string
  password: string
}

export interface StudentImportRow {
  studentNumber: string
  displayName: string
}

export interface ImportedStudent {
  userId: string
  loginId: string
  displayName: string
  activationCode: string
}

export interface ActivateStudentInput {
  studentNumber: string
  activationCode: string
  newPassword: string
}

export interface AuthSessionResult {
  sessionId: string
  expiresAt: string
  user: PublicAuthUser
  mustChangePassword: boolean
}

export interface PublicAuthUser {
  userId: string
  role: ProductAuthRole
  displayName: string
  loginId: string
  studentId?: string
}

export class AuthService {
  public constructor(
    private readonly store: AuthStore,
    private readonly options: { sessionTtlMs?: number } = {}
  ) {}

  public registerTeacher(input: TeacherRegisterInput): AuthSessionResult {
    const email = input.email.trim().toLowerCase()
    const displayName = input.displayName.trim()
    assertEmail(email)
    assertDisplayName(displayName)
    assertPassword(input.password)

    if (this.store.findUserByLoginId(email) !== null) {
      throw new AuthError('conflict', 'Email already registered')
    }

    const user = this.store.createUser({
      role: 'teacher',
      loginId: email,
      displayName,
      passwordHash: hashPassword(input.password),
      mustChangePassword: false
    })

    return this.openSession(user, false)
  }

  public login(input: LoginInput): AuthSessionResult {
    const loginId = input.loginId.trim()
    if (loginId.length === 0) {
      throw new AuthError('validation', 'loginId is required')
    }
    if (input.password.length === 0) {
      throw new AuthError('validation', 'password is required')
    }

    const user = this.store.findUserByLoginId(loginId)
    if (user === null) {
      throw new AuthError('unauthorized', 'Invalid credentials')
    }
    const cred = this.store.getCredential(user.id)
    if (cred === null) {
      throw new AuthError('unauthorized', 'Invalid credentials')
    }

    // Student first-login may still be on activation code only.
    if (cred.passwordHash === null) {
      if (
        cred.activationCodeHash === null ||
        !verifyActivationCode(input.password, cred.activationCodeHash)
      ) {
        throw new AuthError('unauthorized', 'Invalid credentials')
      }
      return this.openSession(user, true)
    }

    if (!verifyPassword(input.password, cred.passwordHash)) {
      throw new AuthError('unauthorized', 'Invalid credentials')
    }

    return this.openSession(user, cred.mustChangePassword)
  }

  /**
   * Student first login: student number + one-time activation code → set password.
   * Activation code is invalidated after success.
   */
  public activateStudent(input: ActivateStudentInput): AuthSessionResult {
    const studentNumber = input.studentNumber.trim()
    if (studentNumber.length === 0) {
      throw new AuthError('validation', 'studentNumber is required')
    }
    assertPassword(input.newPassword)

    const user = this.store.findUserByLoginId(studentNumber)
    if (user === null || user.role !== 'student') {
      throw new AuthError('unauthorized', 'Invalid activation credentials')
    }
    const cred = this.store.getCredential(user.id)
    if (cred === null || cred.activationCodeHash === null) {
      throw new AuthError('unauthorized', 'Invalid activation credentials')
    }
    if (!verifyActivationCode(input.activationCode, cred.activationCodeHash)) {
      throw new AuthError('unauthorized', 'Invalid activation credentials')
    }

    this.store.setPassword(user.id, hashPassword(input.newPassword), {
      clearActivation: true,
      mustChangePassword: false
    })
    // Invalidate any provisional sessions opened via activation-code login.
    this.store.deleteSessionsForUser(user.id)

    return this.openSession(user, false)
  }

  /**
   * Teacher imports a roster. Creates student users with one-time activation codes.
   * Students cannot self-register.
   */
  public importStudents(
    actor: PublicAuthUser,
    rows: StudentImportRow[]
  ): ImportedStudent[] {
    if (actor.role !== 'teacher') {
      throw new AuthError('forbidden', 'Only teachers can import students')
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new AuthError('validation', 'At least one student is required')
    }

    const imported: ImportedStudent[] = []
    for (const row of rows) {
      const studentNumber = row.studentNumber.trim()
      const displayName = row.displayName.trim()
      if (studentNumber.length === 0) {
        throw new AuthError('validation', 'studentNumber is required')
      }
      assertDisplayName(displayName)
      if (this.store.findUserByLoginId(studentNumber) !== null) {
        throw new AuthError(
          'conflict',
          `Student number already exists: ${studentNumber}`
        )
      }
      const activationCode = generateActivationCode()
      const user = this.store.createUser({
        role: 'student',
        loginId: studentNumber,
        displayName,
        passwordHash: null,
        activationCodeHash: hashActivationCode(activationCode),
        mustChangePassword: true
      })
      imported.push({
        userId: user.id,
        loginId: user.loginId,
        displayName: user.displayName,
        activationCode
      })
    }
    return imported
  }

  public changePassword(
    actor: PublicAuthUser,
    newPassword: string
  ): void {
    assertPassword(newPassword)
    const user = this.store.findUserById(actor.userId)
    if (user === null) {
      throw new AuthError('not_found', 'User not found')
    }
    this.store.setPassword(user.id, hashPassword(newPassword), {
      clearActivation: true,
      mustChangePassword: false
    })
  }

  public logout(sessionId: string): void {
    this.store.deleteSession(sessionId)
  }

  public getPublicUser(userId: string): PublicAuthUser | null {
    const user = this.store.findUserById(userId)
    if (user === null) return null
    return toPublic(user)
  }

  public resolveSession(sessionId: string): AuthSessionResult | null {
    const session = this.store.findSession(sessionId)
    if (session === null) return null
    if (Date.parse(session.expiresAt) <= Date.now()) {
      this.store.deleteSession(sessionId)
      return null
    }
    const user = this.store.findUserById(session.userId)
    if (user === null) {
      this.store.deleteSession(sessionId)
      return null
    }
    const cred = this.store.getCredential(user.id)
    return {
      sessionId: session.id,
      expiresAt: session.expiresAt,
      user: toPublic(user),
      mustChangePassword: cred?.mustChangePassword ?? false
    }
  }

  private openSession(
    user: AuthUserRow,
    mustChangePassword: boolean
  ): AuthSessionResult {
    const session = this.store.createSession(user.id, user.role, {
      ttlMs: this.options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS
    })
    return {
      sessionId: session.id,
      expiresAt: session.expiresAt,
      user: toPublic(user),
      mustChangePassword
    }
  }
}

function toPublic(user: AuthUserRow): PublicAuthUser {
  const base: PublicAuthUser = {
    userId: user.id,
    role: user.role,
    displayName: user.displayName,
    loginId: user.loginId
  }
  if (user.role === 'student') {
    return { ...base, studentId: user.id }
  }
  return base
}

function assertPassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new AuthError(
      'validation',
      `Password must be at least ${String(MIN_PASSWORD_LENGTH)} characters`
    )
  }
}

function assertEmail(email: string): void {
  if (!EMAIL_RE.test(email)) {
    throw new AuthError('validation', 'Invalid email address')
  }
}

function assertDisplayName(displayName: string): void {
  if (displayName.length === 0) {
    throw new AuthError('validation', 'displayName is required')
  }
  if (displayName.length > 80) {
    throw new AuthError('validation', 'displayName is too long')
  }
}
