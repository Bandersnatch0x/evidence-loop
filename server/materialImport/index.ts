/**
 * T15 公开面 —— 材料 → 草稿题 → 教师校对闸门 → 入库。
 * 主控在装配时把 `tryHandleMaterialImportRoute` 接入 HTTP 分发链。
 */

export {
  createDraftQuestionGenerator,
  TemplateDraftQuestionGenerator,
  OpenAICompatibleDraftQuestionGenerator,
  TEMPLATE_GENERATOR_MODEL,
  TEMPLATE_DRAFT_COUNT,
  MATERIAL_IMPORT_PREFERRED_TYPES,
  type DraftQuestionGenerator,
  type GenerateDraftsInput,
  type GeneratedDraft,
  type OpenAICompatibleDraftGeneratorOptions
} from './DraftQuestionGenerator'
export {
  MaterialImportStore,
  newMaterialJobId,
  newDraftQuestionId,
  type MaterialImportStoreOptions
} from './MaterialImportStore'
export {
  MaterialImportService,
  MaterialImportGateError,
  MaterialImportInputError,
  MaterialImportNotFoundError,
  MaterialImportOwnershipError,
  CONFIRMED_ANSWER_AUTHORITY,
  type BatchConfirmResult,
  type ConfirmDraftInput,
  type ConfirmDraftResult,
  type CreateMaterialJobInput,
  type DraftPatchInput,
  type MaterialImportServiceOptions
} from './MaterialImportService'
export {
  tryHandleMaterialImportRoute,
  type MaterialImportRouteContext
} from './materialImportRoutes'
