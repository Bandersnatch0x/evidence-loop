/**
 * T15 材料 → 草稿题（教师校对闸门）共享契约。
 *
 * 独立文件而非扩写 shared/contracts.ts：T15 是新增纵向切片，保持共享契约的
 * 改动面为「只新增文件」，便于并行工单合并。
 *
 * 铁律（ADR-0001）：本文件里的任何类型都不含 score / evidence / attempt 字段。
 * LLM 只产出 `DraftQuestion`（provenance = llm_inference），它不是 Question，
 * 不可作答、不可计分；只有教师逐题校对确认后，才由服务端写入题库并把
 * provenance 升级为 teacher_annotation。
 */
import type { Provenance, QuestionType, SubjectLanguage } from './contracts'

/** 材料来源形态（MVP：粘贴 / .txt / 已解析文档文本）。 */
export type MaterialSourceKind = 'paste' | 'text_file' | 'doc_parse'

/** 生成任务的校对进度。 */
export type MaterialImportJobStatus =
  | 'pending'
  | 'generated'
  | 'partially_confirmed'
  | 'done'
  | 'failed'

/** 草稿题状态。只有 confirmed 才对应一条题库 Question。 */
export type DraftQuestionStatus = 'draft' | 'confirmed' | 'discarded'

export type LlmInferenceProvenance = Extract<
  Provenance,
  { kind: 'llm_inference' }
>
export type TeacherAnnotationProvenance = Extract<
  Provenance,
  { kind: 'teacher_annotation' }
>

/**
 * 草稿题的 provenance 只有两态：生成时 llm_inference，教师确认后升级为
 * teacher_annotation。永远不会是 evidence —— 草稿不是证据。
 */
export type DraftQuestionProvenance =
  | LlmInferenceProvenance
  | TeacherAnnotationProvenance

export interface DraftQuestionOption {
  id: string
  text: string
}

/**
 * 草稿题字段，对齐 T03 录入表单。`payload` 是 RunnerSpec 形状的答案草稿；
 * 缺失或空答案的草稿不得确认入库（闸门在服务端强制）。
 */
export interface QuestionDraftShape {
  stem: string
  questionType: QuestionType
  options?: DraftQuestionOption[]
  payload?: unknown
  kpIds: string[]
  difficulty: number
  /** 可选解析草稿（T09 挂载点），同样需教师确认才落库。 */
  solutionDraft?: string
}

export interface DraftQuestion {
  id: string
  jobId: string
  teacherId: string
  payload: QuestionDraftShape
  /** 并排校对用的原文片段（截断，不落全文）。 */
  sourceExcerpt: string
  status: DraftQuestionStatus
  provenance: DraftQuestionProvenance
  /** 生成置信度 0..1；低于阈值前端标红。 */
  confidence: number
  /** 确认入库后指向 Question.id。 */
  confirmedQuestionId?: string
  createdAt: string
  updatedAt: string
}

export interface MaterialImportJob {
  id: string
  teacherId: string
  teachingUnitId?: string
  questionBankId: string
  subject: SubjectLanguage
  sourceKind: MaterialSourceKind
  sourceRef?: string
  /** 原文 sha256，不落全文（T10 减 PII 面）。 */
  rawTextHash: string
  status: MaterialImportJobStatus
  generatorModel: string
  /** true = 无 LLM key，走模板假草稿降级路径。 */
  degraded: boolean
  draftCount: number
  createdAt: string
  updatedAt: string
}

/** GET /api/teacher/material-import/:jobId 的响应体。 */
export interface MaterialImportJobView {
  job: MaterialImportJob
  drafts: DraftQuestion[]
  /** 硬闸门声明，随每次读取回传，前端不得自行放行。 */
  gateNotice: string
  /** v1 仅提示不收费的生成配额。 */
  quota?: MaterialImportQuota
}

export interface MaterialImportQuota {
  limit: number
  used: number
  exceeded: boolean
}

/** 低于该置信度的草稿前端标红并提示手工录入降级。 */
export const DRAFT_LOW_CONFIDENCE_THRESHOLD = 0.55

export const MATERIAL_IMPORT_GATE_NOTICE =
  '草稿题由 LLM 生成（provenance: llm_inference），不是题库题：不可作答、不可计分、' +
  '不出现在测评选题器。必须逐题校对并确认答案权威（authored_key + 教师 ID）后才入库。'

/** 低置信提示文案（生成失败/低置信 → 标红 + 手工录入降级）。 */
export const MATERIAL_IMPORT_LOW_CONFIDENCE_NOTICE =
  '该草稿置信度偏低，请重点校对题干与答案，或直接手工录入。'

/**
 * 「已填答案」判定 —— 批量确认与 UI 共用同一份规则，避免前后端口径漂移。
 * 只看结构上是否存在可判定的答案，不判断答案对错（对错由教师负责）。
 */
export function isAnswerReady(draft: QuestionDraftShape): boolean {
  const payload = draft.payload
  if (typeof payload !== 'object' || payload === null) return false
  const record = payload as Record<string, unknown>
  switch (draft.questionType) {
    case 'choice':
      return (
        Array.isArray(record.correctOptionIds) &&
        record.correctOptionIds.length > 0
      )
    case 'fill_blank':
      return (
        Array.isArray(record.acceptedAnswers) &&
        record.acceptedAnswers.some(
          (answer) => typeof answer === 'string' && answer.trim() !== ''
        )
      )
    case 'numeric':
      return typeof record.expected === 'number' && Number.isFinite(record.expected)
    case 'expression':
      return (
        typeof record.expectedLatex === 'string' &&
        record.expectedLatex.trim() !== ''
      )
    case 'chem_equation':
      return (
        typeof record.expectedEquation === 'string' &&
        record.expectedEquation.trim() !== ''
      )
    case 'essay':
      // 提纲题无客观答案权威 → 永不算「已填答案」，不进批量确认。
      return false
    case 'code':
    case 'geometry':
      // 出界：本路径不生成代码/几何题，留给 T03 手工录入。
      return false
    default: {
      const exhaustive: never = draft.questionType
      return Boolean(exhaustive)
    }
  }
}
