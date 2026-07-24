import type {
  ImportDraft,
  ImportDraftItem,
  ImportParseMethod,
  Question,
  SubjectLanguage
} from '../../shared/contracts'
import type { QuestionBankService } from '../questionbank/QuestionBankService'
import type { QuestionDraft } from '../questionbank/questionValidation'
import { QuestionValidationError } from '../questionbank/questionValidation'
import { DocxParser } from './DocxParser'
import {
  newImportDraftId,
  type ImportDraftStore
} from './ImportDraftStore'
import type { OcrProvider } from './OcrProvider'
import { isOcrEgressAllowed } from './OcrProvider'
import { PdfTextParser } from './PdfTextParser'
import type { QuestionSplitter } from './QuestionSplitter'

/**
 * T04 import service: parse/OCR → ImportDraft → teacher confirm → Question.
 *
 * Hard D2 gate: drafts with status pending_review are NOT questions and must
 * never be handed to the evaluation / mastery path. Only `confirm()` creates
 * authored_key Questions via QuestionBankService.
 */

export const IMPORT_PRIVACY_NOTICE =
  '导入前提示（T10）：请勿上传含手写签名、学号、姓名等学生个人信息的试卷。' +
  '本路径仅处理 L1 题目内容；默认本地/mock 解析，出境 OCR 需显式开启。'

export class ImportOwnershipError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'ImportOwnershipError'
  }
}

export class ImportNotFoundError extends Error {
  public constructor(id: string) {
    super(`Import draft not found: ${id}`)
    this.name = 'ImportNotFoundError'
  }
}

export class ImportGateError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'ImportGateError'
  }
}

export class ImportParseError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'ImportParseError'
  }
}

export interface ParseDocumentInput {
  authorId: string
  questionBankId: string
  subject: SubjectLanguage
  filename: string
  /** Raw file bytes (docx / pdf / image). */
  bytes?: Buffer
  /** Escape hatch for tests: skip file parse and use this text. */
  rawText?: string
  mimeType?: string
}

/** Teacher confirmation payload for one draft item. */
export interface ConfirmItemInput {
  index: number
  action: 'confirm' | 'skip'
  /** Required when action=confirm — teacher is the authority. */
  stem?: string
  questionType?: string
  payload?: unknown
  kpIds?: string[]
  difficulty?: number
  termId?: string
}

export interface ConfirmDraftInput {
  draftId: string
  authorId: string
  items: ConfirmItemInput[]
}

export interface ConfirmDraftResult {
  draft: ImportDraft
  questions: Question[]
}

export interface ImportServiceOptions {
  store: ImportDraftStore
  questionBank: QuestionBankService
  ocr: OcrProvider
  splitter: QuestionSplitter
  now?: () => Date
  environment?: NodeJS.ProcessEnv
  docxParser?: DocxParser
  pdfParser?: PdfTextParser
}

export class ImportService {
  private readonly store: ImportDraftStore
  private readonly questionBank: QuestionBankService
  private readonly ocr: OcrProvider
  private readonly splitter: QuestionSplitter
  private readonly now: () => Date
  private readonly environment: NodeJS.ProcessEnv
  private readonly docxParser: DocxParser
  private readonly pdfParser: PdfTextParser

  public constructor(options: ImportServiceOptions) {
    this.store = options.store
    this.questionBank = options.questionBank
    this.ocr = options.ocr
    this.splitter = options.splitter
    this.now = options.now ?? (() => new Date())
    this.environment = options.environment ?? process.env
    this.docxParser = options.docxParser ?? new DocxParser()
    this.pdfParser = options.pdfParser ?? new PdfTextParser()
  }

  /**
   * Parse an uploaded document into an ImportDraft (pending_review).
   * Never writes to the question bank.
   */
  public async parseDocument(input: ParseDocumentInput): Promise<ImportDraft> {
    if (!input.questionBankId.trim()) {
      throw new ImportParseError('questionBankId is required')
    }
    if (!input.authorId.trim()) {
      throw new ImportParseError('authorId is required')
    }

    const extracted = await this.extractText(input)
    const items = await this.splitter.split({
      rawText: extracted.text,
      subject: input.subject,
      sourceLabel: `import:${extracted.method}:${input.filename}`
    })

    const allowsEgress =
      extracted.egressUsed ||
      isOcrEgressAllowed(this.environment) ||
      this.environment.IMPORT_LLM_EGRESS === 'true' ||
      this.environment.LLM_ALLOW_EGRESS === 'true'

    const draft: ImportDraft = {
      id: newImportDraftId(),
      authorId: input.authorId,
      questionBankId: input.questionBankId,
      subject: input.subject,
      status: 'pending_review',
      sourceFilename: input.filename,
      parseMethod: extracted.method,
      rawText: extracted.text,
      items,
      privacyNotice: IMPORT_PRIVACY_NOTICE,
      createdAt: this.now().toISOString(),
      confirmedQuestionIds: [],
      egressClass: 'L1',
      allowsEgress
    }
    if (extracted.ocrProvider) draft.ocrProvider = extracted.ocrProvider

    this.store.save(draft)
    return draft
  }

  public getDraft(id: string, authorId: string): ImportDraft {
    const draft = this.store.get(id)
    if (!draft) throw new ImportNotFoundError(id)
    if (draft.authorId !== authorId) {
      throw new ImportOwnershipError('Import draft is teacher-private')
    }
    return draft
  }

  public listDrafts(authorId: string): ImportDraft[] {
    return this.store.listByAuthor(authorId)
  }

  /**
   * D2 human gate: teacher confirms/skips each item. Confirmed items become
   * Questions with source=authored_key. Unconfirmed drafts remain non-Questions.
   */
  public confirmDraft(input: ConfirmDraftInput): ConfirmDraftResult {
    const draft = this.getDraft(input.draftId, input.authorId)

    if (
      draft.status === 'confirmed' ||
      draft.status === 'partially_confirmed'
    ) {
      throw new ImportGateError(
        `Draft ${draft.id} already confirmed; create a new import to re-import`
      )
    }

    if (input.items.length === 0) {
      throw new ImportGateError('Confirm requires at least one item action')
    }

    const itemByIndex = new Map(draft.items.map((item) => [item.index, item]))
    const updatedItems: ImportDraftItem[] = draft.items.map((item) => ({
      ...item
    }))
    const questions: Question[] = []
    const confirmedIds: string[] = []

    for (const action of input.items) {
      const existing = itemByIndex.get(action.index)
      if (!existing) {
        throw new ImportGateError(`Unknown draft item index: ${action.index}`)
      }
      const slot = updatedItems.find((item) => item.index === action.index)
      if (!slot) {
        throw new ImportGateError(`Unknown draft item index: ${action.index}`)
      }

      if (action.action === 'skip') {
        slot.status = 'skipped'
        continue
      }

      // action === confirm — teacher fields are authoritative (D2).
      const stem = action.stem?.trim() || existing.stem
      const questionType = action.questionType ?? existing.questionType
      const payload =
        action.payload !== undefined
          ? action.payload
          : existing.payloadCandidate
      const kpIds =
        action.kpIds !== undefined ? action.kpIds : existing.suggestedKpIds
      const difficulty =
        action.difficulty ?? existing.suggestedDifficulty ?? 3

      if (!stem) {
        throw new ImportGateError(
          `Item ${action.index}: stem is required for confirm`
        )
      }
      if (payload === undefined || payload === null) {
        throw new ImportGateError(
          `Item ${action.index}: payload is required for confirm (teacher must supply answer key)`
        )
      }

      const questionDraft: QuestionDraft = {
        questionBankId: draft.questionBankId,
        authorId: draft.authorId,
        subject: draft.subject,
        questionType,
        stem,
        payload,
        kpIds,
        difficulty,
        source: 'authored_key',
        termId: action.termId
      }

      let created: Question
      try {
        created = this.questionBank.create(questionDraft)
      } catch (error) {
        if (error instanceof QuestionValidationError) {
          throw new ImportGateError(
            `Item ${action.index}: ${error.message}`
          )
        }
        throw error
      }

      slot.status = 'confirmed'
      slot.stem = stem
      slot.questionType = created.questionType
      slot.payloadCandidate = payload
      slot.suggestedKpIds = created.kpIds
      slot.suggestedDifficulty = created.difficulty
      questions.push(created)
      confirmedIds.push(created.id)
    }

    const confirmedCount = updatedItems.filter(
      (item) => item.status === 'confirmed'
    ).length
    const decidedCount = updatedItems.filter(
      (item) => item.status === 'confirmed' || item.status === 'skipped'
    ).length

    if (confirmedCount === 0) {
      throw new ImportGateError(
        'At least one item must be confirmed into the question bank'
      )
    }

    const status =
      decidedCount === updatedItems.length &&
      confirmedCount === updatedItems.length
        ? 'confirmed'
        : 'partially_confirmed'

    const next: ImportDraft = {
      ...draft,
      items: updatedItems,
      status,
      confirmedAt: this.now().toISOString(),
      confirmedQuestionIds: confirmedIds
    }
    this.store.save(next)
    return { draft: next, questions }
  }

  /**
   * Safety helper for callers: a draft is never usable for 测评 until
   * questions were created through confirm().
   */
  public isUsableForAssessment(draft: ImportDraft): boolean {
    return (
      (draft.status === 'confirmed' ||
        draft.status === 'partially_confirmed') &&
      draft.confirmedQuestionIds.length > 0
    )
  }

  private async extractText(input: ParseDocumentInput): Promise<{
    text: string
    method: ImportParseMethod
    egressUsed: boolean
    ocrProvider?: string
  }> {
    if (input.rawText !== undefined) {
      const text = input.rawText.trim()
      if (text.length === 0) {
        throw new ImportParseError('rawText is empty')
      }
      return { text, method: 'raw_text', egressUsed: false }
    }

    if (!input.bytes || input.bytes.length === 0) {
      throw new ImportParseError('bytes or rawText is required')
    }

    const lower = input.filename.toLowerCase()
    const mime = (input.mimeType ?? '').toLowerCase()

    if (lower.endsWith('.docx') || mime.includes('wordprocessingml')) {
      const result = await this.docxParser.parse(input.bytes)
      if (result.empty) {
        throw new ImportParseError('DOCX text layer is empty')
      }
      return { text: result.text, method: 'docx', egressUsed: false }
    }

    if (lower.endsWith('.pdf') || mime === 'application/pdf') {
      const result = await this.pdfParser.parse(input.bytes)
      if (!result.empty) {
        return { text: result.text, method: 'pdf_text', egressUsed: false }
      }
      // Empty text layer → OCR branch (scan PDF).
      const ocr = await this.ocr.recognize({
        bytes: input.bytes,
        filename: input.filename,
        mimeType: input.mimeType,
        egressClass: 'L1'
      })
      return {
        text: ocr.text,
        method: 'ocr',
        egressUsed: ocr.egressUsed,
        ocrProvider: ocr.provider
      }
    }

    // Images / unknown → OCR.
    if (
      lower.endsWith('.png') ||
      lower.endsWith('.jpg') ||
      lower.endsWith('.jpeg') ||
      lower.endsWith('.webp') ||
      mime.startsWith('image/')
    ) {
      const ocr = await this.ocr.recognize({
        bytes: input.bytes,
        filename: input.filename,
        mimeType: input.mimeType,
        egressClass: 'L1'
      })
      return {
        text: ocr.text,
        method: 'ocr',
        egressUsed: ocr.egressUsed,
        ocrProvider: ocr.provider
      }
    }

    // Last resort: treat bytes as UTF-8 text.
    const asText = input.bytes.toString('utf8').trim()
    if (asText.length > 0) {
      return { text: asText, method: 'raw_text', egressUsed: false }
    }

    throw new ImportParseError(
      `Unsupported import file type: ${input.filename}`
    )
  }
}
