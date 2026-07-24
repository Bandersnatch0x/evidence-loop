/**
 * Auth HTTP surface (T02). Not wired into server/index.ts — coordinator mounts
 * `tryHandleAuthRoute` on `/api/auth/*` during assembly.
 *
 * Endpoints:
 *   POST /api/auth/register          teacher self-register
 *   POST /api/auth/login             email/学号 + password (or activation code)
 *   POST /api/auth/activate          student first-login set password
 *   POST /api/auth/logout
 *   GET  /api/auth/me
 *   POST /api/auth/password          change password (authenticated)
 *   POST /api/auth/students/import   teacher roster import → activation codes
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import type { AuthService, PublicAuthUser } from './AuthService'
import {
  clearSessionCookie,
  readSessionId,
  SESSION_COOKIE_NAME,
  setSessionCookie
} from './cookies'
import { AuthError, authStatusCode, isAuthError } from './errors'
import type { SessionProvider } from './SessionProvider'

const maxBodyBytes = 64 * 1024
const DEFAULT_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60

const registerSchema = z.object({
  email: z.string().min(3).max(200),
  password: z.string().min(8).max(200),
  displayName: z.string().min(1).max(80)
})

const loginSchema = z.object({
  loginId: z.string().min(1).max(200),
  password: z.string().min(1).max(200)
})

const activateSchema = z.object({
  studentNumber: z.string().min(1).max(64),
  activationCode: z.string().min(1).max(64),
  newPassword: z.string().min(8).max(200)
})

const changePasswordSchema = z.object({
  newPassword: z.string().min(8).max(200)
})

const importStudentsSchema = z.object({
  students: z
    .array(
      z.object({
        studentNumber: z.string().min(1).max(64),
        displayName: z.string().min(1).max(80)
      })
    )
    .min(1)
    .max(500)
})

export interface AuthRouteDeps {
  auth: AuthService
  /** Optional SessionProvider fallback for demo-mode import tests. */
  sessions?: SessionProvider
  cookieName?: string
  sessionTtlSeconds?: number
  secureCookie?: boolean
}

/**
 * Attempt to handle an auth route. Returns true if the path was claimed
 * (response is fully written), false if the caller should continue routing.
 */
export async function tryHandleAuthRoute(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  deps: AuthRouteDeps
): Promise<boolean> {
  if (!requestUrl.pathname.startsWith('/api/auth')) {
    return false
  }

  const method = (request.method ?? 'GET').toUpperCase()
  const path = requestUrl.pathname
  const cookieName = deps.cookieName ?? SESSION_COOKIE_NAME
  const ttlSeconds = deps.sessionTtlSeconds ?? DEFAULT_SESSION_TTL_SECONDS

  try {
    if (path === '/api/auth/register' && method === 'POST') {
      const body = registerSchema.parse(await readJsonBody(request))
      const result = deps.auth.registerTeacher(body)
      setSessionCookie(response, result.sessionId, {
        cookieName,
        maxAgeSeconds: ttlSeconds,
        secure: deps.secureCookie
      })
      respondJson(response, 201, {
        user: result.user,
        mustChangePassword: result.mustChangePassword,
        expiresAt: result.expiresAt
      })
      return true
    }

    if (path === '/api/auth/login' && method === 'POST') {
      const body = loginSchema.parse(await readJsonBody(request))
      const result = deps.auth.login(body)
      setSessionCookie(response, result.sessionId, {
        cookieName,
        maxAgeSeconds: ttlSeconds,
        secure: deps.secureCookie
      })
      respondJson(response, 200, {
        user: result.user,
        mustChangePassword: result.mustChangePassword,
        expiresAt: result.expiresAt
      })
      return true
    }

    if (path === '/api/auth/activate' && method === 'POST') {
      const body = activateSchema.parse(await readJsonBody(request))
      const result = deps.auth.activateStudent(body)
      setSessionCookie(response, result.sessionId, {
        cookieName,
        maxAgeSeconds: ttlSeconds,
        secure: deps.secureCookie
      })
      respondJson(response, 200, {
        user: result.user,
        mustChangePassword: result.mustChangePassword,
        expiresAt: result.expiresAt
      })
      return true
    }

    if (path === '/api/auth/logout' && method === 'POST') {
      const sessionId = readSessionId(request, cookieName)
      if (sessionId !== undefined) {
        deps.auth.logout(sessionId)
      }
      clearSessionCookie(response, {
        cookieName,
        secure: deps.secureCookie
      })
      respondJson(response, 200, { ok: true })
      return true
    }

    if (path === '/api/auth/me' && method === 'GET') {
      const sessionId = readSessionId(request, cookieName)
      if (sessionId === undefined) {
        respondJson(response, 401, { error: 'Not authenticated' })
        return true
      }
      const resolved = deps.auth.resolveSession(sessionId)
      if (resolved === null) {
        clearSessionCookie(response, {
          cookieName,
          secure: deps.secureCookie
        })
        respondJson(response, 401, { error: 'Not authenticated' })
        return true
      }
      respondJson(response, 200, {
        user: resolved.user,
        mustChangePassword: resolved.mustChangePassword,
        expiresAt: resolved.expiresAt
      })
      return true
    }

    if (path === '/api/auth/password' && method === 'POST') {
      const actor = requireActor(request, deps, cookieName)
      const body = changePasswordSchema.parse(await readJsonBody(request))
      deps.auth.changePassword(actor, body.newPassword)
      respondJson(response, 200, { ok: true })
      return true
    }

    if (path === '/api/auth/students/import' && method === 'POST') {
      const actor = requireActor(request, deps, cookieName)
      const body = importStudentsSchema.parse(await readJsonBody(request))
      const imported = deps.auth.importStudents(actor, body.students)
      respondJson(response, 201, { students: imported })
      return true
    }

    respondJson(response, 404, { error: 'Not found' })
    return true
  } catch (error) {
    if (isAuthError(error)) {
      respondJson(response, authStatusCode(error), { error: error.message })
      return true
    }
    if (error instanceof z.ZodError) {
      respondJson(response, 400, {
        error: 'Invalid request body',
        details: error.flatten()
      })
      return true
    }
    if (error instanceof HttpBodyError) {
      respondJson(response, error.statusCode, { error: error.message })
      return true
    }
    console.error('auth route error:', error)
    respondJson(response, 500, { error: 'Internal server error' })
    return true
  }
}

function requireActor(
  request: IncomingMessage,
  deps: AuthRouteDeps,
  cookieName: string
): PublicAuthUser {
  const sessionId = readSessionId(request, cookieName)
  if (sessionId !== undefined) {
    const resolved = deps.auth.resolveSession(sessionId)
    if (resolved !== null) {
      return resolved.user
    }
  }

  if (deps.sessions !== undefined) {
    try {
      const sessionUser = deps.sessions.resolve(request)
      if (sessionUser.role === 'student' || sessionUser.role === 'teacher') {
        return {
          userId: sessionUser.userId,
          role: sessionUser.role,
          displayName: sessionUser.displayName,
          loginId: sessionUser.userId,
          studentId: sessionUser.studentId
        }
      }
    } catch {
      // fall through to unauthorized
    }
  }

  throw new AuthError('unauthorized', 'Not authenticated')
}

class HttpBodyError extends Error {
  public constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message)
    this.name = 'HttpBodyError'
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Uint8Array[] = []
  let size = 0
  const declaredSize = Number(request.headers['content-length'] ?? 0)
  if (Number.isFinite(declaredSize) && declaredSize > maxBodyBytes) {
    throw new HttpBodyError(413, 'Request body is too large')
  }

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maxBodyBytes) {
      throw new HttpBodyError(413, 'Request body is too large')
    }
    chunks.push(buffer)
  }

  const body = Buffer.concat(chunks).toString('utf8')
  if (body.length === 0) return {}
  try {
    return JSON.parse(body) as unknown
  } catch {
    throw new HttpBodyError(400, 'Malformed JSON request body')
  }
}

function respondJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown
): void {
  if (response.headersSent) {
    response.end()
    return
  }
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  })
  response.end(JSON.stringify(payload))
}
