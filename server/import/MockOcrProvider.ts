import type { OcrProvider, OcrRequest, OcrResult } from './OcrProvider'

/**
 * Deterministic local OCR stub for tests + offline demos.
 * Never leaves the process; returns a fixed multi-question fixture unless the
 * caller embeds a UTF-8 text payload after a magic header.
 */
export class MockOcrProvider implements OcrProvider {
  public readonly name = 'mock' as const

  public recognize(request: OcrRequest): Promise<OcrResult> {
    if (request.egressClass !== 'L1') {
      return Promise.reject(
        new Error('MockOcrProvider only accepts L1 question content')
      )
    }

    // Allow tests to pass plain text as the "image" bytes.
    const asText = request.bytes.toString('utf8')
    if (asText.startsWith('MOCK_OCR_TEXT:')) {
      return Promise.resolve({
        provider: 'mock',
        text: asText.slice('MOCK_OCR_TEXT:'.length),
        confidence: 0.95,
        egressUsed: false
      })
    }

    return Promise.resolve({
      provider: 'mock',
      text: [
        '1. 化简 2(x+1) 等于？',
        'A. 2x+1',
        'B. 2x+2',
        'C. x+2',
        'D. 2x',
        '答案：B',
        '',
        '2. 计算 3+5 的结果。',
        '答案：8'
      ].join('\n'),
      confidence: 0.9,
      egressUsed: false
    })
  }
}
