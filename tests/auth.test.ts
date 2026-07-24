// @vitest-environment node

import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveAuthMode } from '../server/auth/authMode'
import { tryHandleAuthRoute } from '../server/auth/authRoutes'
import { AuthService } from '../server/auth/AuthService'
import { AuthStore } from '../server/auth/AuthStore'
import { createSessionProvider } from '../server/auth/createSessionProvider'
import { AuthError, isAuthError } from '../server/auth/errors'
import { MockSessionProvider } from '../server/auth/MockSessionProvider'
import {
  generateActivationCode,
  hashPassword,
  verifyPassword
} from '../server/auth/password'
import { RealSessionProvider } from '../server/auth/RealSessionProvider'
import { openMemoryDatabase } from '../server/db/memorySchema'

function makeAuth() {
  const db = openMemoryDatabase(':memory:')
  const store = new AuthStore(db)
  const auth = new AuthService(store)
  return { db, store, auth }
}

function cookieFromSetCookie(header: string | null): string {
  if (header === null) return ''
  // Node may join multiple Set-Cookie with comma; take first pair.
  const first = header.split(',')[0] ?? header
  const pair = first.split(';')[0] ?? ''
  return pair.trim()
}

/** Minimal request stub for SessionProvider.resolve unit tests. */
function fakeRequest(
  headers: IncomingMessage['headers']
): IncomingMessage {
  return { headers } as unknown as IncomingMessage
}

describe('password scrypt helpers', () => {
  it('hashes and verifies with scrypt encoding', () => {
    const encoded = hashPassword('correct horse battery')
    expect(encoded.startsWith('scrypt$')).toBe(true)
    expect(verifyPassword('correct horse battery', encoded)).toBe(true)
    expect(verifyPassword('wrong password!!', encoded)).toBe(false)
  })

  it('rejects malformed encodings', () => {
    expect(verifyPassword('x', 'not-a-hash')).toBe(false)
    expect(verifyPassword('x', 'bcrypt$foo')).toBe(false)
  })

  it('generates non-empty activation codes', () => {
    const a = generateActivationCode()
    const b = generateActivationCode()
    expect(a.length).toBeGreaterThan(4)
    expect(a).not.toBe(b)
  })
})

describe('auth mode switch', () => {
  it('defaults to mock in dev (no env)', () => {
    expect(resolveAuthMode({})).toBe('mock')
  })

  it('defaults to real in production (closes X-Demo-Role backdoor)', () => {
    expect(resolveAuthMode({ NODE_ENV: 'production' })).toBe('real')
  })

  it('DEMO_AUTH=true forces mock even in production (explicit demo backdoor)', () => {
    expect(
      resolveAuthMode({ NODE_ENV: 'production', DEMO_AUTH: 'true' })
    ).toBe('mock')
  })

  it('AUTH_MODE=real selects real', () => {
    expect(resolveAuthMode({ AUTH_MODE: 'real' })).toBe('real')
  })

  it('AUTH_MODE=mock forces mock even in production', () => {
    expect(
      resolveAuthMode({ NODE_ENV: 'production', AUTH_MODE: 'mock' })
    ).toBe('mock')
  })

  it('DEMO_AUTH=true forces mock even if AUTH_MODE=real', () => {
    expect(
      resolveAuthMode({ AUTH_MODE: 'real', DEMO_AUTH: 'true' })
    ).toBe('mock')
  })

  it('createSessionProvider returns Mock under mock mode', () => {
    const provider = createSessionProvider({ mode: 'mock' })
    expect(provider).toBeInstanceOf(MockSessionProvider)
  })

  it('createSessionProvider returns Real under real mode', () => {
    const db = openMemoryDatabase(':memory:')
    const provider = createSessionProvider({ mode: 'real', db })
    expect(provider).toBeInstanceOf(RealSessionProvider)
  })
})

describe('AuthService teacher register + login', () => {
  it('registers a teacher and logs in with email+password', () => {
    const { auth } = makeAuth()
    const registered = auth.registerTeacher({
      email: 't.zhang@school.example',
      password: 'secure-pass-1',
      displayName: '张老师'
    })
    expect(registered.user.role).toBe('teacher')
    expect(registered.user.loginId).toBe('t.zhang@school.example')
    expect(registered.sessionId.length).toBeGreaterThan(10)
    expect(registered.mustChangePassword).toBe(false)

    const login = auth.login({
      loginId: 't.zhang@school.example',
      password: 'secure-pass-1'
    })
    expect(login.user.userId).toBe(registered.user.userId)

    expect(() =>
      auth.login({
        loginId: 't.zhang@school.example',
        password: 'wrong-password'
      })
    ).toThrow(AuthError)
  })

  it('rejects duplicate teacher email', () => {
    const { auth } = makeAuth()
    auth.registerTeacher({
      email: 'dup@school.example',
      password: 'secure-pass-1',
      displayName: 'A'
    })
    expect(() =>
      auth.registerTeacher({
        email: 'dup@school.example',
        password: 'secure-pass-2',
        displayName: 'B'
      })
    ).toThrow(/already registered/i)
  })

  it('rejects short passwords', () => {
    const { auth } = makeAuth()
    expect(() =>
      auth.registerTeacher({
        email: 'short@school.example',
        password: 'short',
        displayName: 'S'
      })
    ).toThrow(/at least/i)
  })
})

describe('student import + activation flow', () => {
  it('teacher imports students with one-time activation codes', () => {
    const { auth } = makeAuth()
    const teacher = auth.registerTeacher({
      email: 'import@school.example',
      password: 'secure-pass-1',
      displayName: '导入老师'
    })

    const imported = auth.importStudents(teacher.user, [
      { studentNumber: '20260001', displayName: '学生甲' },
      { studentNumber: '20260002', displayName: '学生乙' }
    ])
    expect(imported).toHaveLength(2)
    expect(imported[0]?.activationCode.length).toBeGreaterThan(4)

    // Students cannot self-register as teachers with student numbers as email...
    // Student first login via activate
    const first = imported[0]
    if (first === undefined) throw new Error('missing import row')
    const activated = auth.activateStudent({
      studentNumber: first.loginId,
      activationCode: first.activationCode,
      newPassword: 'student-pass-9'
    })
    expect(activated.user.role).toBe('student')
    expect(activated.user.studentId).toBe(activated.user.userId)
    expect(activated.mustChangePassword).toBe(false)

    // Activation code is single-use
    expect(() =>
      auth.activateStudent({
        studentNumber: first.loginId,
        activationCode: first.activationCode,
        newPassword: 'another-pass-9'
      })
    ).toThrow(AuthError)

    // Subsequent login uses password
    const login = auth.login({
      loginId: first.loginId,
      password: 'student-pass-9'
    })
    expect(login.user.userId).toBe(activated.user.userId)
  })

  it('allows provisional login with activation code then forces password change flag', () => {
    const { auth } = makeAuth()
    const teacher = auth.registerTeacher({
      email: 'prov@school.example',
      password: 'secure-pass-1',
      displayName: 'T'
    })
    const [row] = auth.importStudents(teacher.user, [
      { studentNumber: '20261111', displayName: '临时' }
    ])
    if (row === undefined) throw new Error('missing row')

    const provisional = auth.login({
      loginId: row.loginId,
      password: row.activationCode
    })
    expect(provisional.mustChangePassword).toBe(true)
  })

  it('forbids student actors from importing roster', () => {
    const { auth } = makeAuth()
    const teacher = auth.registerTeacher({
      email: 'forbid@school.example',
      password: 'secure-pass-1',
      displayName: 'T'
    })
    const [row] = auth.importStudents(teacher.user, [
      { studentNumber: '20262222', displayName: 'S' }
    ])
    if (row === undefined) throw new Error('missing')
    const student = auth.activateStudent({
      studentNumber: row.loginId,
      activationCode: row.activationCode,
      newPassword: 'student-pass-9'
    })
    expect(() =>
      auth.importStudents(student.user, [
        { studentNumber: '20263333', displayName: 'X' }
      ])
    ).toThrow(/Only teachers/i)
  })
})

describe('server-side session + RealSessionProvider', () => {
  it('resolves SessionUser from cookie session id', () => {
    const { auth, store } = makeAuth()
    const session = auth.registerTeacher({
      email: 'sess@school.example',
      password: 'secure-pass-1',
      displayName: '会话老师'
    })
    const provider = new RealSessionProvider({ store })
    const user = provider.resolve(
      fakeRequest({ cookie: `el_sid=${session.sessionId}` })
    )

    expect(user.userId).toBe(session.user.userId)
    expect(user.role).toBe('teacher')
    expect(user.actorSource).toBe('auth')
  })

  it('throws unauthorized when cookie missing or invalid', () => {
    const { store } = makeAuth()
    const provider = new RealSessionProvider({ store })
    expect(() => provider.resolve(fakeRequest({}))).toThrow(AuthError)

    try {
      provider.resolve(fakeRequest({ cookie: 'el_sid=does-not-exist' }))
      expect.unreachable('should throw')
    } catch (error) {
      expect(isAuthError(error)).toBe(true)
    }
  })

  it('logout invalidates the session cookie', () => {
    const { auth, store } = makeAuth()
    const session = auth.registerTeacher({
      email: 'out@school.example',
      password: 'secure-pass-1',
      displayName: '退'
    })
    auth.logout(session.sessionId)
    const provider = new RealSessionProvider({ store })
    expect(() =>
      provider.resolve(fakeRequest({ cookie: `el_sid=${session.sessionId}` }))
    ).toThrow(/Session not found|Not authenticated/i)
  })
})

describe('MockSessionProvider demo backdoor', () => {
  it('marks demo principals with actorSource=demo', () => {
    const provider = new MockSessionProvider()
    const student = provider.resolve(
      fakeRequest({ 'x-demo-role': 'student' })
    )
    expect(student.actorSource).toBe('demo')
    expect(student.role).toBe('student')

    const teacher = provider.resolve(
      fakeRequest({ 'x-demo-role': 'teacher' })
    )
    expect(teacher.actorSource).toBe('demo')
    expect(teacher.role).toBe('teacher')
  })
})

describe('auth HTTP routes', () => {
  const servers: Array<ReturnType<typeof createServer>> = []

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()))
          })
      )
    )
  })

  async function startAuthServer() {
    const { auth, store } = makeAuth()
    const sessions = new RealSessionProvider({ store })
    const server = createServer((request, response) => {
      const url = new URL(
        request.url ?? '/',
        `http://${request.headers.host ?? '127.0.0.1'}`
      )
      void tryHandleAuthRoute(request, response, url, {
        auth,
        sessions,
        secureCookie: false
      }).then((handled) => {
        if (!handled && !response.headersSent) {
          response.writeHead(404)
          response.end('nope')
        }
      })
    })
    servers.push(server)
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address() as AddressInfo
    const baseUrl = `http://127.0.0.1:${String(address.port)}`
    return { baseUrl, auth, store }
  }

  it('POST /api/auth/register sets HttpOnly session cookie', async () => {
    const { baseUrl } = await startAuthServer()
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'route@school.example',
        password: 'secure-pass-1',
        displayName: '路由老师'
      })
    })
    expect(response.status).toBe(201)
    const setCookie = response.headers.get('set-cookie')
    expect(setCookie).toMatch(/el_sid=/)
    expect(setCookie?.toLowerCase()).toMatch(/httponly/)
    const body = (await response.json()) as {
      user: { role: string; loginId: string }
    }
    expect(body.user.role).toBe('teacher')
    expect(body.user.loginId).toBe('route@school.example')
  })

  it('login → me → logout round-trip', async () => {
    const { baseUrl } = await startAuthServer()
    await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'round@school.example',
        password: 'secure-pass-1',
        displayName: '往返'
      })
    })

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        loginId: 'round@school.example',
        password: 'secure-pass-1'
      })
    })
    expect(login.status).toBe(200)
    const cookie = cookieFromSetCookie(login.headers.get('set-cookie'))
    expect(cookie.startsWith('el_sid=')).toBe(true)

    const me = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { cookie }
    })
    expect(me.status).toBe(200)
    const meBody = (await me.json()) as { user: { loginId: string } }
    expect(meBody.user.loginId).toBe('round@school.example')

    const logout = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { cookie }
    })
    expect(logout.status).toBe(200)

    const meAfter = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { cookie }
    })
    expect(meAfter.status).toBe(401)
  })

  it('teacher import + student activate via HTTP', async () => {
    const { baseUrl } = await startAuthServer()
    const reg = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'http-import@school.example',
        password: 'secure-pass-1',
        displayName: 'HTTP老师'
      })
    })
    const teacherCookie = cookieFromSetCookie(reg.headers.get('set-cookie'))

    const importRes = await fetch(`${baseUrl}/api/auth/students/import`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: teacherCookie
      },
      body: JSON.stringify({
        students: [{ studentNumber: '20269999', displayName: 'HTTP学生' }]
      })
    })
    expect(importRes.status).toBe(201)
    const importBody = (await importRes.json()) as {
      students: Array<{ loginId: string; activationCode: string }>
    }
    const student = importBody.students[0]
    if (student === undefined) throw new Error('no student')

    const activate = await fetch(`${baseUrl}/api/auth/activate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        studentNumber: student.loginId,
        activationCode: student.activationCode,
        newPassword: 'student-pass-9'
      })
    })
    expect(activate.status).toBe(200)
    const activateBody = (await activate.json()) as {
      user: { role: string }
    }
    expect(activateBody.user.role).toBe('student')
  })

  it('rejects invalid JWT-less session as 401 on /me', async () => {
    // Decision: opaque server session, not JWT — garbage cookie must fail.
    const { baseUrl } = await startAuthServer()
    const me = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { cookie: 'el_sid=eyJhbGciOiJIUzI1NiJ9.fake.sig' }
    })
    expect(me.status).toBe(401)
  })
})
