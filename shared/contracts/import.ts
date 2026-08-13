/** Scan-import draft contracts (T04). */

import type { QuestionType, SubjectLanguage, Provenance } from './evaluation'

// ---------------------------------------------------------------------------
// T04 — scan import / OCR draft + human review gate (D2)
// ---------------------------------------------------------------------------

/**
 * How the raw text was extracted. MVP-0 covers electronic docs; OCR is the
 * scan/photo path (default mock / local, never auto-published).
 */
export type ImportParseMethod = 'docx' | 'pdf_text' | 'ocr' | 'raw_text'

/** Draft lifecycle. Only `confirmed` / `partially_confirmed` produce Questions. */
export type ImportDraftStatus =
  | 'pending_review'
  | 'confirmed'
  | 'partially_confirmed'

/** Per-item review state inside an ImportDraft. */
export type ImportItemStatus =
  | 'pending'
  | 'confirmed'
  | 'skipped'
  | 'low_confidence'

/**
 * One candidate question extracted from OCR/parse + LLM split.
 * Always `llm_inference`-provenanced and blocked from the scoring loop until
 * a teacher confirms it into a real Question (D2 human gate).
 */
export interface ImportDraftItem {
  index: number
  stem: string
  questionType: QuestionType
  /** Choice options when the splitter inferred a multiple-choice item. */
  options?: Array<{ id: string; text: string }>
  /** Free-text answer candidate (fill/numeric/expression) before payload build. */
  answerCandidate?: string
  /** Best-effort RunnerSpec-shaped payload; may be incomplete until confirm. */
  payloadCandidate?: unknown
  suggestedKpIds: string[]
  suggestedDifficulty?: number
  /** 0..1 model/heuristic confidence; low values surface as low_confidence. */
  confidence: number
  status: ImportItemStatus
  /**
   * Always llm_inference — OCR/LLM split is draft generation only.
   * Never enters score or mastery without the teacher confirm step.
   */
  provenance: Extract<Provenance, { kind: 'llm_inference' }>
}

/**
 * Import draft aggregate (T04). OCR/parse produces this "省打字" draft; the
 * teacher review gate is the only path into QuestionBank. Unconfirmed drafts
 * are never Questions and cannot be used for 测评态.
 */
export interface ImportDraft {
  id: string
  authorId: string
  questionBankId: string
  subject: SubjectLanguage
  status: ImportDraftStatus
  sourceFilename: string
  parseMethod: ImportParseMethod
  /** Full extracted text kept for audit / re-split. */
  rawText: string
  items: ImportDraftItem[]
  /**
   * Import-time privacy banner (T10): do not upload handwritten signatures,
   * student numbers, or other L3 PII with the paper.
   */
  privacyNotice: string
  createdAt: string
  confirmedAt?: string
  /** Question ids created after the human gate (empty until confirm). */
  confirmedQuestionIds: string[]
  /** Active OCR provider name when parseMethod is ocr. */
  ocrProvider?: string
  /**
   * T10 data classification for this payload. Import is L1 (question content);
   * L2/L3 student data must never ride this path.
   */
  egressClass: 'L1'
  /** Whether any outbound OCR/LLM call was allowed for this draft. */
  allowsEgress: boolean
}
