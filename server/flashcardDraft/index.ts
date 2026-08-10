/**
 * T22 媒体/转写 → 闪卡草稿模块的公共出口。
 *
 * 分层（与 T15 materialImport 完全同构，便于交叉阅读）：
 *   FlashcardDraftService      编排：生成 → 教师校对闸门 → 入库（唯一写出口）
 *   FlashcardDraftGenerator    生成器：LLM（唯一允许调用 LLM 的文件）/ 模板降级
 *   FlashcardDraftStore        自有表（迁移 0018，无 score/evidence 列）
 *   WebVttParser               WebVTT 字幕 → 纯文本（纯函数）
 *   tryHandleFlashcardDraftRoute HTTP 面（教师私有，未确认草稿 assessment-ref → 422）
 *
 * 整个模块的 import 图里没有任何一条边指向 server/mastery、server/review、
 * server/runner、server/tutoring —— 「闪卡草稿不写分」是结构性成立的。
 */
export { FlashcardDraftService } from './FlashcardDraftService'
export type {
  ConfirmFlashcardInput,
  ConfirmFlashcardResult,
  CreateAudioJobInput,
  CreateFlashcardJobInput,
  FlashcardDraftServiceOptions,
  FlashcardPatchInput
} from './FlashcardDraftService'
export {
  FlashcardAudioDisabledError,
  FlashcardDraftGateError,
  FlashcardDraftInputError,
  FlashcardDraftNotFoundError,
  FlashcardDraftOwnershipError,
  FlashcardEgressGateError,
  FlashcardStudentSpeechError
} from './FlashcardDraftService'
export {
  createFlashcardDraftGenerator,
  OpenAICompatibleFlashcardDraftGenerator,
  pickTermCandidates,
  TemplateFlashcardDraftGenerator,
  TEMPLATE_FLASHCARD_COUNT,
  TEMPLATE_FLASHCARD_MODEL
} from './FlashcardDraftGenerator'
export type {
  FlashcardDraftGenerator,
  GenerateFlashcardsInput,
  GeneratedFlashcard
} from './FlashcardDraftGenerator'
export { FlashcardDraftStore } from './FlashcardDraftStore'
export type { FlashcardDraftStoreOptions } from './FlashcardDraftStore'
export { isWebVtt, parseWebVtt, WebVttInputError } from './WebVttParser'
export type { ParseWebVttResult } from './WebVttParser'
export { tryHandleFlashcardDraftRoute } from './flashcardRoutes'
export type { FlashcardDraftRouteContext } from './flashcardRoutes'
