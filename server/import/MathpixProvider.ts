import {
  isOcrEgressAllowed,
  type OcrProvider,
  type OcrRequest,
  type OcrResult
} from './OcrProvider'

/**
 * Skeleton for Mathpix Convert API (MVP-1 egress path, TR1/T10).
 *
 * Not implemented — Mathpix is US egress. Only constructible when
 * OCR_ALLOW_EGRESS=true, and recognize() still throws until a real client
 * is added. Prefer OCR_PROVIDER=mock|local for Demo.
 */
export class MathpixProvider implements OcrProvider {
  public readonly name = 'mathpix' as const

  public constructor(environment: NodeJS.ProcessEnv = process.env) {
    if (!isOcrEgressAllowed(environment)) {
      throw new Error(
        'MathpixProvider requires OCR_ALLOW_EGRESS=true (T10 L1 opt-in). ' +
          'Default import path stays local/mock.'
      )
    }
  }

  public recognize(request: OcrRequest): Promise<OcrResult> {
    if (request.egressClass !== 'L1') {
      return Promise.reject(
        new Error('Mathpix may only process L1 question content (T10)')
      )
    }
    return Promise.reject(
      new Error(
        'MathpixProvider is a skeleton only. Wire the Convert API under ' +
          'OCR_ALLOW_EGRESS=true when ready; default remains mock/local.'
      )
    )
  }
}
