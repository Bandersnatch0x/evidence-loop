/**
 * multimodalRoutes — voice ask + STT start/finalize HTTP surface.
 *
 * Extracted from server/index.ts (architecture deepening C2).
 * ADR-0005: feature-flag gated; audit metadata only (no transcript body).
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import type { AuditStore } from '../audit/AuditStore'
import { createRouteAuditor } from '../audit/routeAudit'
import type { SessionUser } from '../auth/SessionProvider'
import { isMultimodalEnabled } from '../config/features'
import { readJsonBody, respondJson } from '../http/httpUtils'
import { findPIIInText } from '../pii/PIIDetector'
import type { STTProvider } from '../stt/STTProvider'
import { respondMultimodalAsk } from './askRoute'
import { respondSTTFinalize, respondSTTStart } from './sttRoute'

const multimodalAskSchema = z.object({
  text: z.string().min(1).max(2000),
  /** Client-reported recording duration in ms (metadata only; never stored as audio). */
  durationMs: z.number().int().nonnegative().max(600_000).optional()
})

const sttStartSchema = z.object({
  sessionId: z.string().min(1).max(128).optional(),
  language: z.string().min(2).max(32).optional()
})

const sttFinalizeSchema = z.object({
  text: z.string().min(1).max(4000),
  sessionId: z.string().min(1).max(128).optional()
})

export interface MultimodalRouteContext {
  audit: AuditStore
  stt: STTProvider
  user: SessionUser
}

/**
 * Handle POST /api/multimodal/ask, /stt/start, /stt/finalize.
 * Returns false when the path is not a multimodal route.
 */
export async function handleMultimodalApi(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  context: MultimodalRouteContext
): Promise<boolean> {
  const { pathname } = requestUrl
  if (!pathname.startsWith('/api/multimodal/')) return false

  const { audit, stt, user } = context

  if (request.method === 'POST' && pathname === '/api/multimodal/ask') {
    const parsed = multimodalAskSchema.safeParse(await readJsonBody(request))
    if (!parsed.success) {
      respondJson(response, 400, {
        error: 'Invalid multimodal ask request'
      })
      return true
    }

    const featureEnabled = isMultimodalEnabled()
    const transcript = parsed.data.text
    const piiHits = findPIIInText('voice_transcript', transcript)
    const studentId = user.studentId ?? user.userId

    // ADR-0005 §7: audit metadata only — duration, char count, PII hit count.
    // Never persist the transcript body or raw audio bytes.
    if (featureEnabled) {
      createRouteAuditor(audit, user, {
        action: 'view',
        resourceType: 'system'
      }).record({
        resourceId: 'multimodal-ask',
        studentId,
        result: 'success',
        modality: 'voice',
        metadata: {
          durationMs: parsed.data.durationMs ?? null,
          transcriptChars: transcript.length,
          piiHitCount: piiHits.length
        }
      })
    }

    respondMultimodalAsk(response, featureEnabled)
    return true
  }

  if (request.method === 'POST' && pathname === '/api/multimodal/stt/start') {
    const parsed = sttStartSchema.safeParse(await readJsonBody(request))
    if (!parsed.success) {
      respondJson(response, 400, {
        error: 'Invalid STT start request'
      })
      return true
    }
    await respondSTTStart(
      response,
      isMultimodalEnabled(),
      stt,
      parsed.data
    )
    return true
  }

  if (request.method === 'POST' && pathname === '/api/multimodal/stt/finalize') {
    const parsed = sttFinalizeSchema.safeParse(await readJsonBody(request))
    if (!parsed.success) {
      respondJson(response, 400, {
        error: 'Invalid STT finalize request'
      })
      return true
    }
    await respondSTTFinalize(
      response,
      isMultimodalEnabled(),
      stt,
      parsed.data
    )
    return true
  }

  return false
}
