import { LocalOcrProvider, PaddleOcrProvider } from './PaddleOcrProvider'
import { MathpixProvider } from './MathpixProvider'
import { MockOcrProvider } from './MockOcrProvider'
import {
  resolveOcrProviderName,
  type OcrProvider,
  type OcrProviderName
} from './OcrProvider'

/**
 * Factory for the active OCR provider. Prefer injecting MockOcrProvider in tests.
 * Default OCR_PROVIDER=mock keeps imports offline with zero egress (T10).
 */
export function createOcrProvider(
  environment: NodeJS.ProcessEnv = process.env,
  name?: OcrProviderName
): OcrProvider {
  const resolved = name ?? resolveOcrProviderName(environment)
  switch (resolved) {
    case 'mathpix':
      return new MathpixProvider(environment)
    case 'paddle':
      return new PaddleOcrProvider(environment)
    case 'local':
      return new LocalOcrProvider(environment)
    case 'mock':
    default:
      return new MockOcrProvider()
  }
}
