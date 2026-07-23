import type {
  STTProvider,
  STTStartRequest,
  STTStartResult,
  STTTranscriptInput,
  STTTranscriptResult
} from './STTProvider'

/**
 * Backend placeholder for browser Web Speech API (ADR-0005 §3 fallback).
 *
 * Recognition runs entirely in the browser; the server only returns a sentinel
 * endpoint so `/api/multimodal/stt/start` stays uniform across providers.
 */
export class WebSpeechSTTProvider implements STTProvider {
  public readonly name = 'webspeech' as const

  public startSession(request: STTStartRequest): Promise<STTStartResult> {
    const language = request.language ?? 'zh-CN'
    return Promise.resolve({
      provider: 'webspeech',
      endpoint: 'webspeech://local',
      note:
        `Use the browser Web Speech API (lang=${language}).`
        + ' Backend is a no-op; transcript never leaves the client until /ask.'
    })
  }

  public finalizeTranscript(
    input: STTTranscriptInput
  ): Promise<STTTranscriptResult> {
    // Web Speech is client-side; accept passthrough for API symmetry / tests.
    const text = input.text.trim()
    return Promise.resolve({
      text,
      provider: 'webspeech'
    })
  }
}
