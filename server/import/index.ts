/**
 * T04 public surface — document import + OCR draft + human review gate.
 * Coordinator wires `tryHandleImportRoute` into the main HTTP assembly.
 */

export { DocxParser } from './DocxParser'
export { PdfTextParser } from './PdfTextParser'
export {
  createOcrProvider
} from './createOcrProvider'
export {
  resolveOcrProviderName,
  isOcrEgressAllowed,
  type OcrProvider,
  type OcrProviderName,
  type OcrRequest,
  type OcrResult
} from './OcrProvider'
export { MockOcrProvider } from './MockOcrProvider'
export { PaddleOcrProvider, LocalOcrProvider } from './PaddleOcrProvider'
export { MathpixProvider } from './MathpixProvider'
export {
  createQuestionSplitter,
  LocalHeuristicQuestionSplitter,
  OpenAICompatibleQuestionSplitter,
  type QuestionSplitter
} from './QuestionSplitter'
export {
  ImportDraftStore,
  newImportDraftId
} from './ImportDraftStore'
export {
  ImportService,
  ImportGateError,
  ImportNotFoundError,
  ImportOwnershipError,
  ImportParseError,
  IMPORT_PRIVACY_NOTICE,
  type ConfirmDraftInput,
  type ConfirmItemInput,
  type ParseDocumentInput,
  type ConfirmDraftResult
} from './ImportService'
export { tryHandleImportRoute, type ImportRouteContext } from './importRoutes'
