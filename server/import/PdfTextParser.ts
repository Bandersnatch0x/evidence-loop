import { createRequire } from 'node:module'
import { normalizeExtractedText } from './DocxParser'

/**
 * MVP-0 text-layer PDF parser (T04 / TR1).
 * Uses pdf-parse for the embedded text layer — pure Node, no GPU, no egress.
 * Scan-only PDFs (empty text layer) return empty=true so the caller can route
 * to the OCR branch.
 */

export interface PdfTextParseResult {
  text: string
  method: 'pdf_text'
  pageCount: number
  /** True when text layer is empty/near-empty → likely a scanned PDF. */
  empty: boolean
}

interface PdfParseResult {
  text: string
  numpages: number
}

type PdfParseFn = (dataBuffer: Buffer) => Promise<PdfParseResult>

const require = createRequire(import.meta.url)
// pdf-parse is CJS; createRequire keeps ESM server modules happy.
const pdfParse = require('pdf-parse') as PdfParseFn

/** Minimum chars of non-whitespace before we treat a PDF as text-layer. */
const MIN_TEXT_LAYER_CHARS = 20

export class PdfTextParser {
  public async parse(buffer: Buffer): Promise<PdfTextParseResult> {
    const data = await pdfParse(buffer)
    const text = normalizeExtractedText(data.text ?? '')
    const nonWs = text.replace(/\s+/g, '')
    return {
      text,
      method: 'pdf_text',
      pageCount: data.numpages,
      empty: nonWs.length < MIN_TEXT_LAYER_CHARS
    }
  }
}
