import type {
  STTProvider,
  STTStartRequest,
  STTStartResult,
  STTTranscriptInput,
  STTTranscriptResult
} from './STTProvider'

/**
 * Deterministic STT provider for unit tests.
 * Optional `transcript` override makes finalize return a canned string.
 */
export interface MockSTTProviderOptions {
  transcript?: string
  endpoint?: string
  failStart?: boolean
  failFinalize?: boolean
}

export class MockSTTProvider implements STTProvider {
  public readonly name = 'mock' as const
  private readonly options: MockSTTProviderOptions

  public constructor(options: MockSTTProviderOptions = {}) {
    this.options = options
  }

  public startSession(request: STTStartRequest): Promise<STTStartResult> {
    if (this.options.failStart === true) {
      return Promise.reject(new Error('Mock STT start failed'))
    }
    const sessionNote =
      request.sessionId !== undefined
        ? `Mock STT provider (session=${request.sessionId})`
        : 'Mock STT provider'
    return Promise.resolve({
      provider: 'mock',
      endpoint: this.options.endpoint ?? 'mock://stt',
      sessionToken: 'mock-token',
      note: sessionNote
    })
  }

  public finalizeTranscript(
    input: STTTranscriptInput
  ): Promise<STTTranscriptResult> {
    if (this.options.failFinalize === true) {
      return Promise.reject(new Error('Mock STT finalize failed'))
    }
    const text = (this.options.transcript ?? input.text).trim()
    if (text.length === 0) {
      return Promise.reject(new Error('Mock STT transcript is empty'))
    }
    return Promise.resolve({
      text,
      provider: 'mock'
    })
  }
}
