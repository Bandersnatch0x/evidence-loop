import type {
  OcrProvider,
  OcrProviderName,
  OcrRequest,
  OcrResult
} from './OcrProvider'

/**
 * Skeleton for local PaddleOCR microservice (MVP-1, TR1).
 *
 * Not implemented in this ticket — wiring would reuse the DockerPythonRunner
 * container-isolation paradigm (`--network=none`) so data never leaves the box.
 * Instantiating throws to make misconfiguration loud.
 */
export class PaddleOcrProvider implements OcrProvider {
  public readonly name: OcrProviderName = 'paddle'

  public constructor(environment: NodeJS.ProcessEnv = process.env) {
    // Env reserved for PADDLE_OCR_URL / binary path (MVP-1).
    void environment
  }

  public recognize(request: OcrRequest): Promise<OcrResult> {
    void request
    return Promise.reject(
      new Error(
        'PaddleOcrProvider is a skeleton only (MVP-1). ' +
          'Set OCR_PROVIDER=mock for tests, or implement the local microservice.'
      )
    )
  }
}

/**
 * Alias name used when OCR_PROVIDER=local (T10 default for on-prem).
 * Same skeleton as paddle until the microservice lands.
 */
export class LocalOcrProvider extends PaddleOcrProvider {
  public override readonly name: OcrProviderName = 'local'
}
