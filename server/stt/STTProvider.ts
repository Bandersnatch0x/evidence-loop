/**
 * Speech-to-text provider abstraction (ADR-0005 §3).
 *
 * Runtime switch via `STT_PROVIDER=aliyun|webspeech|mock` (default: webspeech).
 * Aliyun NLS is the primary Chinese path; Web Speech is the browser fallback
 * (frontend-local). Backend keeps a no-op provider so `/api/multimodal/stt/*`
 * stays consistent across modes.
 */

export type STTProviderName = 'aliyun' | 'webspeech' | 'mock'

export interface STTStartRequest {
  /** Optional client session id for correlation / audit. */
  sessionId?: string
  /** BCP-47 language tag; defaults to zh-CN. */
  language?: string
}

export interface STTStartResult {
  provider: STTProviderName
  /**
   * WebSocket (or other) endpoint the client should open for streaming audio.
   * WebSpeech returns a sentinel so the client stays on the browser API.
   */
  endpoint: string
  /** Opaque session token / app-key bundle the client may need. */
  sessionToken?: string
  /** Human-readable note (e.g. "use browser Web Speech API"). */
  note?: string
}

export interface STTTranscriptInput {
  text: string
  sessionId?: string
}

export interface STTTranscriptResult {
  text: string
  provider: STTProviderName
}

export interface STTProvider {
  readonly name: STTProviderName
  startSession(request: STTStartRequest): Promise<STTStartResult>
  /**
   * Optional server-side finalize hook. Used when the provider streams through
   * the backend (Aliyun) or for Mock/tests. WebSpeech typically no-ops.
   */
  finalizeTranscript?(
    input: STTTranscriptInput
  ): Promise<STTTranscriptResult>
}

export function resolveSTTProviderName(
  environment: NodeJS.ProcessEnv = process.env
): STTProviderName {
  const raw = (environment.STT_PROVIDER ?? 'webspeech').trim().toLowerCase()
  if (raw === 'aliyun' || raw === 'webspeech' || raw === 'mock') {
    return raw
  }
  return 'webspeech'
}
