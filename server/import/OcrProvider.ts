/**
 * OCR provider abstraction (T04 / TR1).
 *
 * Runtime switch via `OCR_PROVIDER=mock|local|paddle|mathpix` (default: mock).
 * MVP-0 electronic-document path never needs OCR; this interface covers the
 * scan/photo branch. Real Paddle/Mathpix implementations are skeletons only —
 * default stays local/mock so L1 question content does not leave the box
 * unless explicitly opted in (T10).
 */

export type OcrProviderName = 'mock' | 'local' | 'paddle' | 'mathpix'

export interface OcrRequest {
  /** Image or scan bytes (png/jpg/pdf-as-image). */
  bytes: Buffer
  /** Original filename for diagnostics. */
  filename?: string
  /** MIME type hint. */
  mimeType?: string
  /**
   * T10 egress class. Import is always L1 (question content). Providers that
   * send data off-box must refuse non-L1 payloads.
   */
  egressClass: 'L1'
}

export interface OcrResult {
  provider: OcrProviderName
  text: string
  /** Optional per-block confidence 0..1. */
  confidence?: number
  /** True when the provider performed an outbound network call. */
  egressUsed: boolean
}

export interface OcrProvider {
  readonly name: OcrProviderName
  recognize(request: OcrRequest): Promise<OcrResult>
}

export function resolveOcrProviderName(
  environment: NodeJS.ProcessEnv = process.env
): OcrProviderName {
  const raw = (environment.OCR_PROVIDER ?? 'mock').trim().toLowerCase()
  if (
    raw === 'mock' ||
    raw === 'local' ||
    raw === 'paddle' ||
    raw === 'mathpix'
  ) {
    return raw
  }
  return 'mock'
}

/** Whether outbound OCR (Mathpix) is permitted by env (T10 switch). */
export function isOcrEgressAllowed(
  environment: NodeJS.ProcessEnv = process.env
): boolean {
  return (
    environment.OCR_ALLOW_EGRESS === 'true' ||
    environment.ALLOW_OCR_EGRESS === 'true'
  )
}
