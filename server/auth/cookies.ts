import type { IncomingMessage, ServerResponse } from 'node:http'

/** Default session cookie name (opaque server-side session id). */
export const SESSION_COOKIE_NAME = 'el_sid'

/**
 * Parse a Cookie header into a flat map. Duplicate keys keep the last value.
 * Values are not URI-decoded beyond a best-effort decodeURIComponent.
 */
export function parseCookieHeader(
  header: string | string[] | undefined
): Record<string, string> {
  const raw = Array.isArray(header) ? header.join(';') : (header ?? '')
  const out: Record<string, string> = {}
  for (const part of raw.split(';')) {
    const trimmed = part.trim()
    if (trimmed.length === 0) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const name = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim()
    if (name.length === 0) continue
    out[name] = safeDecode(value)
  }
  return out
}

export function readSessionId(
  request: IncomingMessage,
  cookieName: string = SESSION_COOKIE_NAME
): string | undefined {
  const cookies = parseCookieHeader(request.headers.cookie)
  const value = cookies[cookieName]
  if (value === undefined || value.length === 0) return undefined
  return value
}

export interface SessionCookieOptions {
  cookieName?: string
  maxAgeSeconds: number
  /** Defaults to true when NODE_ENV === 'production'. */
  secure?: boolean
  sameSite?: 'Lax' | 'Strict' | 'None'
  path?: string
}

export function setSessionCookie(
  response: ServerResponse,
  sessionId: string,
  options: SessionCookieOptions
): void {
  const name = options.cookieName ?? SESSION_COOKIE_NAME
  const path = options.path ?? '/'
  const sameSite = options.sameSite ?? 'Lax'
  const secure =
    options.secure ?? process.env.NODE_ENV === 'production'
  const parts = [
    `${name}=${sessionId}`,
    `Path=${path}`,
    'HttpOnly',
    `SameSite=${sameSite}`,
    `Max-Age=${String(options.maxAgeSeconds)}`
  ]
  if (secure) parts.push('Secure')
  appendSetCookie(response, parts.join('; '))
}

export function clearSessionCookie(
  response: ServerResponse,
  options: Pick<SessionCookieOptions, 'cookieName' | 'path' | 'secure' | 'sameSite'> = {}
): void {
  const name = options.cookieName ?? SESSION_COOKIE_NAME
  const path = options.path ?? '/'
  const sameSite = options.sameSite ?? 'Lax'
  const secure =
    options.secure ?? process.env.NODE_ENV === 'production'
  const parts = [
    `${name}=`,
    `Path=${path}`,
    'HttpOnly',
    `SameSite=${sameSite}`,
    'Max-Age=0'
  ]
  if (secure) parts.push('Secure')
  appendSetCookie(response, parts.join('; '))
}

function appendSetCookie(response: ServerResponse, value: string): void {
  const existing = response.getHeader('Set-Cookie')
  if (existing === undefined) {
    response.setHeader('Set-Cookie', value)
    return
  }
  if (Array.isArray(existing)) {
    response.setHeader('Set-Cookie', [...existing.map(String), value])
    return
  }
  response.setHeader('Set-Cookie', [String(existing), value])
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
