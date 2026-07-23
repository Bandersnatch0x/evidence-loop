import type {
  STTProvider,
  STTStartRequest,
  STTStartResult,
  STTTranscriptInput,
  STTTranscriptResult
} from './STTProvider'

/**
 * Aliyun NLS real-time speech recognition provider (ADR-0005 §3 primary path).
 *
 * Credentials: ALIYUN_NLS_APP_KEY + ALIYUN_NLS_TOKEN (or ALIYUN_NLS_ACCESS_TOKEN).
 * This module returns the gateway WebSocket URL + token for the client (or a
 * thin proxy) to stream PCM/opus. Full duplex proxying is intentionally out of
 * scope for Phase 1 — we only hand out connection parameters.
 *
 * Gateway default: wss://nls-gateway.cn-shanghai.aliyuncs.com/ws/v1
 */

const DEFAULT_NLS_GATEWAY =
  'wss://nls-gateway.cn-shanghai.aliyuncs.com/ws/v1'

export interface AliyunSTTProviderOptions {
  appKey?: string
  token?: string
  gatewayUrl?: string
}

export class AliyunSTTProvider implements STTProvider {
  public readonly name = 'aliyun' as const
  private readonly appKey: string
  private readonly token: string
  private readonly gatewayUrl: string

  public constructor(
    options: AliyunSTTProviderOptions = {},
    environment: NodeJS.ProcessEnv = process.env
  ) {
    this.appKey =
      options.appKey?.trim()
      ?? environment.ALIYUN_NLS_APP_KEY?.trim()
      ?? ''
    this.token =
      options.token?.trim()
      ?? environment.ALIYUN_NLS_TOKEN?.trim()
      ?? environment.ALIYUN_NLS_ACCESS_TOKEN?.trim()
      ?? ''
    this.gatewayUrl =
      options.gatewayUrl?.trim()
      ?? environment.ALIYUN_NLS_GATEWAY?.trim()
      ?? DEFAULT_NLS_GATEWAY
  }

  public startSession(request: STTStartRequest): Promise<STTStartResult> {
    if (this.appKey === '' || this.token === '') {
      return Promise.reject(
        new Error(
          'Aliyun STT is not configured: set ALIYUN_NLS_APP_KEY and ALIYUN_NLS_TOKEN'
        )
      )
    }

    const language = request.language ?? 'zh-CN'
    const endpoint = `${this.gatewayUrl}?token=${encodeURIComponent(this.token)}`

    return Promise.resolve({
      provider: 'aliyun',
      endpoint,
      sessionToken: this.appKey,
      note:
        `Aliyun NLS session ready (lang=${language}).`
        + ' Stream audio over the WebSocket; do not persist raw audio (ADR-0005 §7).'
    })
  }

  public finalizeTranscript(
    input: STTTranscriptInput
  ): Promise<STTTranscriptResult> {
    const text = input.text.trim()
    if (text.length === 0) {
      return Promise.reject(new Error('Aliyun STT transcript is empty'))
    }
    return Promise.resolve({
      text,
      provider: 'aliyun'
    })
  }
}
