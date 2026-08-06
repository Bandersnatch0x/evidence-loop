/**
 * httpUtils — shared HTTP transport helpers.
 *
 * Created in the C5 deepening (architecture review #35): previously every one
 * of the 15 route modules defined its own `respondJson` (and 13 defined their
 * own `readJsonBody`), so the transport layer was duplicated across the
 * codebase. This module is the single canonical home for those helpers plus
 * the shared `HttpError` — the seam between the HTTP layer and the domain.
 *
 * A module that needs to write a response imports `respondJson` from here
 * instead of re-defining it. `HttpError` is the one error type the transport
 * recognizes (statusCode → HTTP status).
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  SECURITY_WARNING_HEADER,
  SECURITY_WARNING_VALUE
} from '../auth/MockSessionProvider'

/** Max request body bytes accepted by readJsonBody (256 KiB). */
export const maxRequestBodyBytes = 256 * 1024

export class HttpError extends Error {
  public constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message)
  }
}

/** JSON headers applied to every respondJson response. */
export const JSON_HEADERS: Record<string, string> = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  [SECURITY_WARNING_HEADER]: SECURITY_WARNING_VALUE
}

/**
 * Write a JSON response with the shared security-warning header. `extraHeaders`
 * are merged last so a caller can override cache-control when needed.
 */
export function respondJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
  extraHeaders: Record<string, string> = {}
): void {
  response.writeHead(statusCode, { ...JSON_HEADERS, ...extraHeaders })
  response.end(JSON.stringify(payload))
}

/**
 * Read + parse a JSON request body (plain object), enforcing the max body
 * size and rejecting malformed JSON with a 400 HttpError.
 */
export async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Uint8Array[] = []
  let size = 0
  const declaredSize = Number(request.headers['content-length'] ?? 0)

  if (Number.isFinite(declaredSize) && declaredSize > maxRequestBodyBytes) {
    throw new HttpError(413, 'Request body is too large')
  }

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maxRequestBodyBytes) {
      throw new HttpError(413, 'Request body is too large')
    }
    chunks.push(buffer)
  }

  const body = Buffer.concat(chunks).toString('utf8')
  if (body.length === 0) return {}
  try {
    return JSON.parse(body) as unknown
  } catch {
    throw new HttpError(400, 'Malformed JSON request body')
  }
}