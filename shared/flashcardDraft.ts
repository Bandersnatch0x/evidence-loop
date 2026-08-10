/**
 * T22 媒体/转写 → 闪卡草稿共享契约。
 *
 * 独立文件而非扩写 shared/materialImport.ts / shared/contracts.ts：
 * T22 是 T15 之上的平行纵向切片，保持既有共享契约的改动面为「只新增文件」，
 * 便于并行工单合并（T21 / T23）。
 *
 * 铁律（ADR-0001 / ADR-0006）：本文件里的任何类型都不含 score / evidence /
 * attempt / MasteryProfile 字段。闪卡草稿是**建议层**，provenance 恒为
 * `llm_inference`；它不是题库题，不可作答、不可计分、不出现在测评选题器。
 * 只有教师逐条校对并确认后，服务端才写入题库并把 provenance 升级为
 * `teacher_annotation`。
 *
 * 正面溯源红线（PRD §闪卡结构）：`front` 必须是可核查的硬内容（概念/术语），
 * 必须能在转写原文中找到（见 `verifyFrontIsGrounded`）。LLM 不得编造材料里
 * 不存在的概念。
 */
import type { Provenance, SubjectLanguage } from './contracts'

/** 材料来源形态（MVP：粘贴字幕 / WebVTT / 音频转写）。 */
export type FlashcardSourceKind = 'transcript' | 'webvtt' | 'audio'

/** 生成任务的校对进度。 */
export type FlashcardJobStatus =
  | 'pending'
  | 'generated'
  | 'partially_confirmed'
  | 'done'
  | 'failed'

/** 闪卡草稿状态。只有 confirmed 才对应一条题库 Question。 */
export type FlashcardDraftStatus = 'draft' | 'confirmed' | 'discarded'

export type LlmInferenceProvenance = Extract<
  Provenance,
  { kind: 'llm_inference' }
>
export type TeacherAnnotationProvenance = Extract<
  Provenance,
  { kind: 'teacher_annotation' }
>

/**
 * 闪卡草稿的 provenance 只有两态：生成时 llm_inference，教师确认后升级为
 * teacher_annotation。永远不会是 evidence —— 草稿不是证据（ADR-0001）。
 */
export type FlashcardDraftProvenance =
  | LlmInferenceProvenance
  | TeacherAnnotationProvenance

/**
 * 闪卡结构（PRD §闪卡）：
 *   front —— 正面：概念/术语，**硬内容**，必须可在转写原文中溯源；
 *   back  —— 背面：解释，可核查；确认入库时作为 fill_blank 的答案权威。
 * 两者都由 LLM 预填、教师校对；`isFlashcardReady` 是前后端共用的闸门口径。
 */
export interface FlashcardDraft {
  id: string
  jobId: string
  teacherId: string
  /** 正面：概念/术语（硬内容，须原文可溯源）。 */
  front: string
  /** 背面：解释。 */
  back: string
  /** 并排校对用的原文片段（截断，不落全文）。 */
  sourceExcerpt: string
  status: FlashcardDraftStatus
  provenance: FlashcardDraftProvenance
  /** 生成置信度 0..1；低于阈值前端标红。 */
  confidence: number
  /** 正面是否通过原文溯源校验（LLM 未编造概念）。 */
  frontGrounded: boolean
  /** 确认入库后指向 Question.id。 */
  confirmedQuestionId?: string
  createdAt: string
  updatedAt: string
}

export interface FlashcardDraftJob {
  id: string
  teacherId: string
  teachingUnitId?: string
  questionBankId: string
  subject: SubjectLanguage
  sourceKind: FlashcardSourceKind
  sourceRef?: string
  /** 原文/转写文本 sha256，不落全文（PII 收敛，ADR-0003 / T10）。 */
  rawTextHash: string
  status: FlashcardJobStatus
  generatorModel: string
  /** true = 无 LLM key，走模板假草稿降级路径。 */
  degraded: boolean
  draftCount: number
  createdAt: string
  updatedAt: string
}

/** GET 任务 + 草稿列表的响应体。 */
export interface FlashcardDraftJobView {
  job: FlashcardDraftJob
  drafts: FlashcardDraft[]
  /** 硬闸门声明，随每次读取回传，前端不得自行放行。 */
  gateNotice: string
}

export const FLASHCARD_GATE_NOTICE =
  '闪卡草稿由 LLM 生成（provenance: llm_inference），不是题库题：不可作答、不可计分、' +
  '不出现在测评选题器。正面必须为材料中真实出现的概念（不得编造），' +
  '必须逐条校对并确认答案权威（authored_key + 教师 ID）后才入库。'

export const FLASHCARD_LOW_CONFIDENCE_NOTICE =
  '该闪卡置信度偏低，请重点校对正面概念与背面解释，或直接手工录入。'

/** 低于该置信度的草稿前端标红并提示手工录入降级。 */
export const FLASHCARD_LOW_CONFIDENCE_THRESHOLD = 0.55

/**
 * 「已可确认」判定 —— 前后端共用同一份规则，避免口径漂移。
 * 正面必须是非空概念，背面必须提供非空解释（即确认时的答案权威）。
 * 只看结构上是否存在内容，不判断内容对错（对错由教师负责）。
 */
export function isFlashcardReady(flashcard: {
  front: string
  back: string
}): boolean {
  return flashcard.front.trim() !== '' && flashcard.back.trim() !== ''
}

/** 原文溯源校验阈值：front 与原文片段的最小字符重叠比例。 */
export const FRONT_GROUNDING_MIN_RATIO = 0.5

/**
 * 正面溯源校验（PRD 红线）：front 必须是材料中真实出现的概念/术语。
 * 归一化（去空白、去标点、统一小写）后，把 front 切成字符片段，
 * 检查是否**整体**作为连续子串出现在原文中；若整体找不到，退而求其次
 * 检查与原文某片段的重叠字符比例是否达到阈值。
 *
 * 这是「不允许 LLM 编造不存在的概念」的可测试硬规则 —— 服务端在生成后
 * 强制调用，未通过的草稿以低置信标记并交由教师核对（结构性可追溯）。
 */
export function verifyFrontIsGrounded(
  front: string,
  rawText: string
): boolean {
  const frontText = normalizeForGrounding(front)
  if (frontText.length === 0) return false
  const sourceText = normalizeForGrounding(rawText)
  if (sourceText.length === 0) return false
  if (sourceText.includes(frontText)) return true

  // 整体找不到时退而求其次：front 与原文最长公共子串的相对占比。
  const overlap = longestOverlapLength(frontText, sourceText)
  return overlap / frontText.length >= FRONT_GROUNDING_MIN_RATIO
}

/** 归一化：去除标点/空白并小写，用于概念溯源匹配。 */
export function normalizeForGrounding(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '')
}

/** 计算 a 与 b 的最长公共连续子串长度（动态规划，用于小文本）。 */
function longestOverlapLength(a: string, b: string): number {
  const shorter = a.length <= b.length ? a : b
  const longer = a.length <= b.length ? b : a
  for (let length = shorter.length; length > 0; length -= 1) {
    for (let start = 0; start + length <= shorter.length; start += 1) {
      if (longer.includes(shorter.slice(start, start + length))) return length
    }
  }
  return 0
}
