import type { ServerResponse } from 'node:http'
import {
  SECURITY_WARNING_HEADER,
  SECURITY_WARNING_VALUE
} from '../auth/MockSessionProvider'
import { assertNoPII, PIIError } from '../pii/PIIDetector'
import type { STTProvider, STTStartRequest } from '../stt/STTProvider'
import { FEATURE_DISABLED_HEADER } from './askRoute'

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  [SECURITY_WARNING_HEADER]: SECURITY_WARNING_VALUE
} as const

export interface STTStartBody {
  sessionId?: string
  language?: string
}

export interface STTFinalizeBody {
  text: string
  sessionId?: string
}

/**
 * POST /api/multimodal/stt/start — return provider endpoint / token.
 * When multimodal is disabled, respond 503 with X-Feature-Disabled (ADR-0005 §8).
 */
export async function respondSTTStart(
  response: ServerResponse,
  featureEnabled: boolean,
  provider: STTProvider,
  body: STTStartBody
): Promise<void> {
  if (!featureEnabled) {
    response.writeHead(503, {
      ...JSON_HEADERS,
      [FEATURE_DISABLED_HEADER]: 'multimodal'
    })
    response.end(JSON.stringify({ error: 'Multimodal feature is disabled' }))
    return
  }

  const request: STTStartRequest = {
    sessionId: body.sessionId,
    language: body.language
  }

  try {
    const result = await provider.startSession(request)
    response.writeHead(200, JSON_HEADERS)
    response.end(JSON.stringify(result))
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to start STT session'
    response.writeHead(503, JSON_HEADERS)
    response.end(JSON.stringify({ error: message }))
  }
}

/**
 * Optional finalize path: run PII gate on a transcript before it is accepted
 * into any downstream store / ask pipeline (ticket 007 + ADR-0005 §7).
 */
export async function respondSTTFinalize(
  response: ServerResponse,
  featureEnabled: boolean,
  provider: STTProvider,
  body: STTFinalizeBody
): Promise<void> {
  if (!featureEnabled) {
    response.writeHead(503, {
      ...JSON_HEADERS,
      [FEATURE_DISABLED_HEADER]: 'multimodal'
    })
    response.end(JSON.stringify({ error: 'Multimodal feature is disabled' }))
    return
  }

  const text = body.text.trim()
  if (text.length === 0) {
    response.writeHead(400, JSON_HEADERS)
    response.end(JSON.stringify({ error: 'Transcript text is required' }))
    return
  }

  try {
    assertNoPII('transcript', text)
  } catch (error) {
    if (error instanceof PIIError) {
      response.writeHead(422, JSON_HEADERS)
      response.end(
        JSON.stringify({
          error: error.message,
          piiDetected: true
        })
      )
      return
    }
    throw error
  }

  if (provider.finalizeTranscript === undefined) {
    response.writeHead(200, JSON_HEADERS)
    response.end(
      JSON.stringify({
        text,
        provider: provider.name,
        piiDetected: false
      })
    )
    return
  }

  try {
    const result = await provider.finalizeTranscript({
      text,
      sessionId: body.sessionId
    })
    response.writeHead(200, JSON_HEADERS)
    response.end(
      JSON.stringify({
        ...result,
        piiDetected: false
      })
    )
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to finalize transcript'
    response.writeHead(400, JSON_HEADERS)
    response.end(JSON.stringify({ error: message }))
  }
}
