import mammoth from 'mammoth'

/**
 * MVP-0 electronic Word parser (T04 / TR1).
 * Uses mammoth to extract the text layer — pure Node, no GPU, no egress.
 * OMML formula conversion is best-effort (plain text); image formulas stay for
 * the OCR branch and teacher LaTeX edit.
 */

export interface DocxParseResult {
  text: string
  method: 'docx'
  /** True when extracted text is empty / whitespace only. */
  empty: boolean
}

export class DocxParser {
  public async parse(buffer: Buffer): Promise<DocxParseResult> {
    const result = await mammoth.extractRawText({ buffer })
    const text = normalizeExtractedText(result.value)
    return {
      text,
      method: 'docx',
      empty: text.trim().length === 0
    }
  }
}

export function normalizeExtractedText(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
