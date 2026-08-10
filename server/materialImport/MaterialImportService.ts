/**
 * T15 材料 → 草稿题服务：生成 → 教师逐题校对 → 硬闸门 → 入库。
 *
 * ## 铁律边界（ADR-0001 / D2 证据分级）
 *
 * 1. 生成路径唯一产物是 `DraftQuestion`，provenance = `llm_inference`，
 *    存在独立的 `draft_questions` 表 —— 它不是 Question，因此**结构上**不可能
 *    出现在题库列表、测评选题器或任何 Runner/Rubric 输入里。
 * 2. 本文件不 import mastery / review / runner / EvaluationAgent / scoring 任何
 *    模块，也不写 score / evidence / Attempt。唯一的写库出口是
 *    `QuestionBankService.create()`，且只在教师确认时调用。
 * 3. 校对闸门是硬闸门：未确认草稿 `resolveAssessmentQuestionId()` 抛
 *    `MaterialImportGateError`（路由层 → 422），不是提示。
 * 4. 确认时强制答案权威 `authored_key` + 教师 ID；确认后草稿 provenance
 *    升级为 `teacher_annotation`。
 */
import { createHash } from 'node:crypto'
import type {
  Question,
  StandardSolution,
  SubjectLanguage
} from '../../shared/contracts'
import {
  isAnswerReady,
  MATERIAL_IMPORT_GATE_NOTICE,
  type DraftQuestion,
  type DraftQuestionOption,
  type MaterialImportJob,
  type MaterialImportJobStatus,
  type MaterialImportJobView,
  type MaterialImportQuota,
  type MaterialSourceKind,
  type QuestionDraftShape
} from '../../shared/materialImport'
import type { QuestionBankService } from '../questionbank/QuestionBankService'
import type { QuestionDraft } from '../questionbank/questionValidation'
import { QuestionValidationError } from '../questionbank/questionValidation'
import type { DraftQuestionGenerator } from './DraftQuestionGenerator'
import type { MaterialImportStore } from './MaterialImportStore'
import { newDraftQuestionId, newMaterialJobId } from './MaterialImportStore'

/** 确认入库时的答案权威等级（D2）。教师是答案的唯一权威。 */
export const CONFIRMED_ANSWER_AUTHORITY = 'authored_key' as const

const DEFAULT_DAILY_QUOTA = 20
const MAX_RAW_TEXT_CHARS = 60_000
const MIN_RAW_TEXT_CHARS = 20

export class MaterialImportNotFoundError extends Error {
  public constructor(id: string) {
    super(`Material import resource not found: ${id}`)
    this.name = 'MaterialImportNotFoundError'
  }
}

export class MaterialImportOwnershipError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'MaterialImportOwnershipError'
  }
}

/** 校对闸门拒绝：未确认 / 已确认重复 / 答案为空 / 校验不通过。 */
export class MaterialImportGateError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'MaterialImportGateError'
  }
}

export class MaterialImportInputError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'MaterialImportInputError'
  }
}

export interface CreateMaterialJobInput {
  teacherId: string
  questionBankId: string
  subject: SubjectLanguage
  rawText: string
  sourceKind?: MaterialSourceKind
  sourceRef?: string
  teachingUnitId?: string
}

/** 教师修正草稿字段（全部可选，未给的字段保持原值）。 */
export interface DraftPatchInput {
  stem?: string
  questionType?: string
  options?: DraftQuestionOption[]
  payload?: unknown
  kpIds?: string[]
  difficulty?: number
  solutionDraft?: string
}

export interface ConfirmDraftInput extends DraftPatchInput {
  /** 教师采纳的标准解析（可选，T09 挂载）。 */
  solution?: string
  /** 校对备注，写入 teacher_annotation provenance。 */
  note?: string
}

export interface ConfirmDraftResult {
  draft: DraftQuestion
  question: Question
  job: MaterialImportJob
}

export interface BatchConfirmResult {
  job: MaterialImportJob
  confirmed: DraftQuestion[]
  questions: Question[]
  /** 未确认的草稿 id → 原因（未填答案 / 已处理）。 */
  skipped: Array<{ draftId: string; reason: string }>
}

export interface MaterialImportServiceOptions {
  store: MaterialImportStore
  questionBank: QuestionBankService
  generator: DraftQuestionGenerator
  now?: () => Date
  environment?: NodeJS.ProcessEnv
}

export class MaterialImportService {
  private readonly store: MaterialImportStore
  private readonly questionBank: QuestionBankService
  private readonly generator: DraftQuestionGenerator
  private readonly now: () => Date
  private readonly environment: NodeJS.ProcessEnv

  public constructor(options: MaterialImportServiceOptions) {
    this.store = options.store
    this.questionBank = options.questionBank
    this.generator = options.generator
    this.now = options.now ?? (() => new Date())
    this.environment = options.environment ?? process.env
  }

  // -------------------------------------------------------------------------
  // 生成
  // -------------------------------------------------------------------------

  /**
   * 投入材料 → 生成候选草稿题。绝不写题库：本方法返回后
   * `QuestionBankService.list()` 的结果不变。
   */
  public async createJob(
    input: CreateMaterialJobInput
  ): Promise<MaterialImportJobView> {
    const teacherId = input.teacherId.trim()
    if (teacherId === '') {
      throw new MaterialImportInputError('teacherId is required')
    }
    if (!input.questionBankId.trim()) {
      throw new MaterialImportInputError('questionBankId is required')
    }
    const rawText = input.rawText.trim()
    if (rawText.length < MIN_RAW_TEXT_CHARS) {
      throw new MaterialImportInputError(
        `材料文本过短（至少 ${String(MIN_RAW_TEXT_CHARS)} 字）`
      )
    }
    if (rawText.length > MAX_RAW_TEXT_CHARS) {
      throw new MaterialImportInputError(
        `材料文本过长（上限 ${String(MAX_RAW_TEXT_CHARS)} 字）`
      )
    }

    const timestamp = this.now().toISOString()
    const jobId = newMaterialJobId()
    const sourceKind = input.sourceKind ?? 'paste'

    const generated = await this.generator.generate({
      rawText,
      subject: input.subject,
      sourceLabel: `material-import:${sourceKind}:${jobId}`
    })

    const status: MaterialImportJobStatus =
      generated.length > 0 ? 'generated' : 'failed'

    const job: MaterialImportJob = {
      id: jobId,
      teacherId,
      questionBankId: input.questionBankId,
      subject: input.subject,
      sourceKind,
      // 只留 hash，不落全文（T10 减 PII 面）。
      rawTextHash: createHash('sha256').update(rawText).digest('hex'),
      status,
      generatorModel: this.generator.model,
      degraded: this.generator.degraded,
      draftCount: generated.length,
      createdAt: timestamp,
      updatedAt: timestamp
    }
    if (input.teachingUnitId) job.teachingUnitId = input.teachingUnitId
    if (input.sourceRef) job.sourceRef = input.sourceRef
    this.store.saveJob(job)

    for (const candidate of generated) {
      const draft: DraftQuestion = {
        id: newDraftQuestionId(),
        jobId,
        teacherId,
        payload: candidate.payload,
        sourceExcerpt: candidate.sourceExcerpt,
        status: 'draft',
        // 生成物永远是 llm_inference —— 由生成器构造，服务层不覆写。
        provenance: candidate.provenance,
        confidence: candidate.confidence,
        createdAt: timestamp,
        updatedAt: timestamp
      }
      this.store.saveDraft(draft)
    }

    return this.getJobView(jobId, teacherId)
  }

  // -------------------------------------------------------------------------
  // 读取
  // -------------------------------------------------------------------------

  public listJobs(teacherId: string): MaterialImportJob[] {
    return this.store.listJobsByTeacher(teacherId)
  }

  public getJobView(jobId: string, teacherId: string): MaterialImportJobView {
    const job = this.getOwnedJob(jobId, teacherId)
    return {
      job,
      drafts: this.store.listDraftsByJob(job.id),
      gateNotice: MATERIAL_IMPORT_GATE_NOTICE,
      quota: this.quotaFor(teacherId)
    }
  }

  public getDraft(draftId: string, teacherId: string): DraftQuestion {
    const draft = this.store.getDraft(draftId)
    if (!draft) throw new MaterialImportNotFoundError(draftId)
    if (draft.teacherId !== teacherId) {
      throw new MaterialImportOwnershipError(
        'Forbidden: draft question is teacher-private'
      )
    }
    return draft
  }

  // -------------------------------------------------------------------------
  // 修正 / 丢弃
  // -------------------------------------------------------------------------

  /** 教师修正草稿字段。已确认或已丢弃的草稿不可再改。 */
  public patchDraft(
    draftId: string,
    teacherId: string,
    patch: DraftPatchInput
  ): DraftQuestion {
    const draft = this.getDraft(draftId, teacherId)
    if (draft.status !== 'draft') {
      throw new MaterialImportGateError(
        `草稿 ${draft.id} 状态为 ${draft.status}，不可再修改`
      )
    }
    const next: DraftQuestion = {
      ...draft,
      payload: mergeDraftShape(draft.payload, patch),
      updatedAt: this.now().toISOString()
    }
    this.store.saveDraft(next)
    return next
  }

  /** 丢弃草稿：不产生任何 Question。 */
  public discardDraft(
    draftId: string,
    teacherId: string
  ): { draft: DraftQuestion; job: MaterialImportJob } {
    const draft = this.getDraft(draftId, teacherId)
    if (draft.status === 'confirmed') {
      throw new MaterialImportGateError(
        `草稿 ${draft.id} 已入库，不可丢弃（请到题库删除该题）`
      )
    }
    const next: DraftQuestion = {
      ...draft,
      status: 'discarded',
      updatedAt: this.now().toISOString()
    }
    this.store.saveDraft(next)
    return { draft: next, job: this.recomputeJobStatus(draft.jobId) }
  }

  // -------------------------------------------------------------------------
  // 校对闸门
  // -------------------------------------------------------------------------

  /**
   * 硬闸门：教师逐题确认。通过后才写入题库（source = authored_key，
   * authorId = 教师），草稿 provenance 升级为 teacher_annotation。
   */
  public confirmDraft(
    draftId: string,
    teacherId: string,
    input: ConfirmDraftInput = {}
  ): ConfirmDraftResult {
    return this.store.transaction(() =>
      this.confirmDraftInTransaction(draftId, teacherId, input)
    )
  }

  private confirmDraftInTransaction(
    draftId: string,
    teacherId: string,
    input: ConfirmDraftInput
  ): ConfirmDraftResult {
    const draft = this.getDraft(draftId, teacherId)
    if (draft.status === 'confirmed') {
      throw new MaterialImportGateError(
        `草稿 ${draft.id} 已确认入库（Question ${draft.confirmedQuestionId ?? '?'}）`
      )
    }
    if (draft.status === 'discarded') {
      throw new MaterialImportGateError(`草稿 ${draft.id} 已丢弃，不可确认`)
    }

    const job = this.getOwnedJob(draft.jobId, teacherId)
    const merged = mergeDraftShape(draft.payload, input)

    // 闸门第一关：必须有答案。无答案的题不得入库用于测评（PRD §闸门）。
    if (!isAnswerReady(merged)) {
      throw new MaterialImportGateError(
        `草稿 ${draft.id} 缺少答案权威：教师必须先填写答案才能确认入库`
      )
    }

    const questionDraft: QuestionDraft = {
      questionBankId: job.questionBankId,
      // 溯源：入库题的作者永远是确认的教师，不是 LLM。
      authorId: teacherId,
      subject: job.subject,
      questionType: merged.questionType,
      stem: merged.stem,
      payload: merged.payload,
      kpIds: merged.kpIds,
      difficulty: merged.difficulty,
      // D2 答案权威，硬编码为教师答案权威，调用方不可覆盖。
      source: CONFIRMED_ANSWER_AUTHORITY
    }
    const solutionText = input.solution?.trim()
    if (solutionText) {
      const solution: StandardSolution = {
        content: solutionText,
        authorId: teacherId,
        source: 'authored'
      }
      questionDraft.solution = solution
    }

    let question: Question
    try {
      question = this.questionBank.create(questionDraft)
    } catch (error) {
      if (error instanceof QuestionValidationError) {
        throw new MaterialImportGateError(
          `草稿 ${draft.id} 校验未通过：${error.message}`
        )
      }
      throw error
    }

    const next: DraftQuestion = {
      ...draft,
      payload: merged,
      status: 'confirmed',
      // provenance 升级：llm_inference → teacher_annotation（教师背书）。
      provenance: {
        kind: 'teacher_annotation',
        teacherId,
        note: input.note?.trim() || `教师校对确认入库 → Question ${question.id}`
      },
      confirmedQuestionId: question.id,
      updatedAt: this.now().toISOString()
    }
    this.store.saveDraft(next)

    return {
      draft: next,
      question,
      job: this.recomputeJobStatus(draft.jobId)
    }
  }

  /**
   * 批量确认：只确认「已填答案」的草稿，其余原样保留并回报跳过原因。
   * 逐题走同一条 confirmDraft 闸门 —— 批量只是循环，不是绕过。
   */
  public confirmBatch(jobId: string, teacherId: string): BatchConfirmResult {
    const job = this.getOwnedJob(jobId, teacherId)
    const confirmed: DraftQuestion[] = []
    const questions: Question[] = []
    const skipped: Array<{ draftId: string; reason: string }> = []

    for (const draft of this.store.listDraftsByJob(job.id)) {
      if (draft.status !== 'draft') {
        skipped.push({ draftId: draft.id, reason: `状态为 ${draft.status}` })
        continue
      }
      if (!isAnswerReady(draft.payload)) {
        skipped.push({ draftId: draft.id, reason: '未填答案' })
        continue
      }
      try {
        const result = this.confirmDraft(draft.id, teacherId)
        confirmed.push(result.draft)
        questions.push(result.question)
      } catch (error) {
        if (error instanceof MaterialImportGateError) {
          skipped.push({ draftId: draft.id, reason: error.message })
          continue
        }
        throw error
      }
    }

    return {
      job: this.recomputeJobStatus(job.id),
      confirmed,
      questions,
      skipped
    }
  }

  // -------------------------------------------------------------------------
  // 测评引用闸门
  // -------------------------------------------------------------------------

  /** 只有确认入库的草稿才可被测评场次引用。 */
  public isDraftAssessable(draft: DraftQuestion): boolean {
    return draft.status === 'confirmed' && draft.confirmedQuestionId !== undefined
  }

  /**
   * 解析草稿 → 可布置的 Question id。未确认时抛闸门错误（路由层 422），
   * 这是「未确认题不可出现在测评选题器」的服务端强制点。
   */
  public resolveAssessmentQuestionId(
    draftId: string,
    teacherId: string
  ): string {
    const draft = this.getDraft(draftId, teacherId)
    if (!this.isDraftAssessable(draft)) {
      throw new MaterialImportGateError(
        `草稿 ${draft.id} 未经教师校对确认，不可用于测评（当前状态：${draft.status}）`
      )
    }
    // isDraftAssessable 已保证存在。
    return draft.confirmedQuestionId as string
  }

  // -------------------------------------------------------------------------
  // internals
  // -------------------------------------------------------------------------

  private getOwnedJob(jobId: string, teacherId: string): MaterialImportJob {
    const job = this.store.getJob(jobId)
    if (!job) throw new MaterialImportNotFoundError(jobId)
    if (job.teacherId !== teacherId) {
      throw new MaterialImportOwnershipError(
        'Forbidden: material import job is teacher-private'
      )
    }
    return job
  }

  /** 依据草稿状态重算任务进度：generated → partially_confirmed → done。 */
  private recomputeJobStatus(jobId: string): MaterialImportJob {
    const job = this.store.getJob(jobId)
    if (!job) throw new MaterialImportNotFoundError(jobId)
    const drafts = this.store.listDraftsByJob(jobId)
    const pending = drafts.filter((draft) => draft.status === 'draft').length
    const confirmed = drafts.filter(
      (draft) => draft.status === 'confirmed'
    ).length

    let status: MaterialImportJobStatus = job.status
    if (drafts.length === 0) {
      status = 'failed'
    } else if (pending === 0) {
      status = 'done'
    } else if (confirmed > 0) {
      status = 'partially_confirmed'
    } else {
      status = 'generated'
    }

    const next: MaterialImportJob = {
      ...job,
      status,
      updatedAt: this.now().toISOString()
    }
    this.store.saveJob(next)
    return next
  }

  /** v1 只提示不收费：超额仍放行，前端展示黄条。 */
  private quotaFor(teacherId: string): MaterialImportQuota {
    const configured = Number(
      this.environment.MATERIAL_IMPORT_DAILY_QUOTA ?? DEFAULT_DAILY_QUOTA
    )
    const limit =
      Number.isFinite(configured) && configured > 0
        ? Math.trunc(configured)
        : DEFAULT_DAILY_QUOTA
    const dayStart = new Date(this.now())
    dayStart.setUTCHours(0, 0, 0, 0)
    const used = this.store.countJobsSince(teacherId, dayStart.toISOString())
    return { limit, used, exceeded: used > limit }
  }
}

/** 把教师修正合并进草稿字段；未提供的字段保持原值。 */
function mergeDraftShape(
  base: QuestionDraftShape,
  patch: DraftPatchInput
): QuestionDraftShape {
  const merged: QuestionDraftShape = {
    stem: patch.stem?.trim() ?? base.stem,
    questionType: (patch.questionType ??
      base.questionType) as QuestionDraftShape['questionType'],
    kpIds: patch.kpIds ?? base.kpIds,
    difficulty: patch.difficulty ?? base.difficulty
  }
  const options = patch.options ?? base.options
  if (options !== undefined) merged.options = options
  const payload = patch.payload !== undefined ? patch.payload : base.payload
  if (payload !== undefined) merged.payload = payload
  const solutionDraft = patch.solutionDraft ?? base.solutionDraft
  if (solutionDraft !== undefined) merged.solutionDraft = solutionDraft
  return merged
}
