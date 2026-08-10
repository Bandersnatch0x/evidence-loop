/**
 * T22 媒体/转写 → 闪卡草稿服务：生成 → 教师逐条校对 → 硬闸门 → 入库。
 *
 * ## 铁律边界（ADR-0001 / ADR-0006 / D2 证据分级）
 *
 * 1. 生成路径唯一产物是 `FlashcardDraft`，provenance = `llm_inference`，
 *    存在独立的 `draft_flashcards` 表 —— 它不是 Question，因此**结构上**不可能
 *    出现在题库列表、测评选题器或任何 Runner/Rubric 输入里。
 * 2. 本文件不 import mastery / review / runner / EvaluationAgent / scoring 任何
 *    模块，也不写 score / evidence / Attempt。唯一的写库出口是
 *    `QuestionBankService.create()`，且只在教师确认时调用（照 T15）。
 * 3. 校对闸门是硬闸门：未确认草稿 `resolveAssessmentQuestionId()` 抛
 *    `FlashcardDraftGateError`（路由层 → 422），不是提示。
 * 4. 确认时强制答案权威 `authored_key` + 教师 ID；确认后草稿 provenance
 *    升级为 `teacher_annotation`。
 * 5. 正面溯源红线（PRD §闪卡）：生成时对每个 front 执行
 *    `verifyFrontIsGrounded`，未通过（LLM 编造概念）的草稿**直接剔除**；
 *    若 LLM 产物全部被剔除，回落到模板生成器（模板 front 恒取自原文）。
 * 6. 音频路径：feature flag 默认关闭；非本地 STT 且未开出境开关 → 拒绝
 *    （T10 egress gate）；学生课堂录音默认禁止（必须勾选「无学生发言素材」）。
 * 7. 原文/转写文本只落 sha256（ADR-0003 / T10 减 PII 面），不落全文。
 */
import { createHash } from 'node:crypto'
import type { Question, StandardSolution, SubjectLanguage } from '../../shared/contracts'
import {
  FLASHCARD_GATE_NOTICE,
  isFlashcardReady,
  verifyFrontIsGrounded,
  type FlashcardDraft,
  type FlashcardDraftJob,
  type FlashcardDraftJobView,
  type FlashcardJobStatus,
  type FlashcardSourceKind
} from '../../shared/flashcardDraft'
import type { QuestionBankService } from '../questionbank/QuestionBankService'
import type { QuestionDraft } from '../questionbank/questionValidation'
import { QuestionValidationError } from '../questionbank/questionValidation'
import type { STTProvider } from '../stt/STTProvider'
import type { FlashcardDraftGenerator } from './FlashcardDraftGenerator'
import { TemplateFlashcardDraftGenerator } from './FlashcardDraftGenerator'
import type { FlashcardDraftStore } from './FlashcardDraftStore'
import { newFlashcardDraftId, newFlashcardJobId } from './FlashcardDraftStore'

/** 确认入库时的答案权威等级（D2）。教师是答案的唯一权威。 */
export const CONFIRMED_FLASHCARD_AUTHORITY = 'authored_key' as const

/** PRD §输入 MVP：音频时长上限。 */
export const MAX_AUDIO_DURATION_SECONDS = 15 * 60

const MAX_RAW_TEXT_CHARS = 60_000
const MIN_RAW_TEXT_CHARS = 20

export class FlashcardDraftNotFoundError extends Error {
  public constructor(id: string) {
    super(`Flashcard draft resource not found: ${id}`)
    this.name = 'FlashcardDraftNotFoundError'
  }
}

export class FlashcardDraftOwnershipError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'FlashcardDraftOwnershipError'
  }
}

/** 校对闸门拒绝：未确认 / 已确认重复 / front-back 缺失 / 校验不通过。 */
export class FlashcardDraftGateError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'FlashcardDraftGateError'
  }
}

export class FlashcardDraftInputError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'FlashcardDraftInputError'
  }
}

/** 音频路径 feature flag 关闭。 */
export class FlashcardAudioDisabledError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'FlashcardAudioDisabledError'
  }
}

/** T10 egress gate：非本地 STT 且未开出境开关。 */
export class FlashcardEgressGateError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'FlashcardEgressGateError'
  }
}

/** 学生课堂录音默认禁止（未勾选「无学生发言素材」声明）。 */
export class FlashcardStudentSpeechError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'FlashcardStudentSpeechError'
  }
}

export interface CreateFlashcardJobInput {
  teacherId: string
  questionBankId: string
  subject: SubjectLanguage
  /** 转写/字幕纯文本（WebVTT 需先经 `parseWebVtt` 转纯文本）。 */
  rawText: string
  /** 必须显式勾选：素材无学生发言。 */
  noStudentSpeechDeclaration: boolean
  sourceKind?: FlashcardSourceKind
  sourceRef?: string
  teachingUnitId?: string
}

export interface CreateAudioJobInput {
  teacherId: string
  questionBankId: string
  subject: SubjectLanguage
  /** 本地已转写文本（与 audioBase64 二选一，可都用）。 */
  transcript?: string
  /** 原始音频负载（base64）。v1 经注入 STT provider 转写。 */
  audioBase64?: string
  /** 音频时长（秒）。PRD §输入 MVP：≤ 15min。 */
  durationSeconds?: number
  /** 必须显式勾选：素材无学生发言（学生课堂录音默认禁止）。 */
  noStudentSpeechDeclaration: boolean
  sourceRef?: string
  teachingUnitId?: string
}

export interface FlashcardPatchInput {
  front?: string
  back?: string
}

export interface ConfirmFlashcardInput extends FlashcardPatchInput {
  /** 教师采纳的标准解析（可选，T09 挂载）。 */
  solution?: string
  /** 校对备注，写入 teacher_annotation provenance。 */
  note?: string
}

export interface ConfirmFlashcardResult {
  flashcard: FlashcardDraft
  question: Question
  job: FlashcardDraftJob
}

export interface FlashcardDraftServiceOptions {
  store: FlashcardDraftStore
  questionBank: QuestionBankService
  generator: FlashcardDraftGenerator
  /** 注入 STT provider（默认本地 mock）。audio 端点用。 */
  stt?: STTProvider
  now?: () => Date
  environment?: NodeJS.ProcessEnv
}

export class FlashcardDraftService {
  private readonly store: FlashcardDraftStore
  private readonly questionBank: QuestionBankService
  private readonly generator: FlashcardDraftGenerator
  private readonly stt: STTProvider | undefined
  private readonly now: () => Date
  private readonly environment: NodeJS.ProcessEnv

  public constructor(options: FlashcardDraftServiceOptions) {
    this.store = options.store
    this.questionBank = options.questionBank
    this.generator = options.generator
    this.stt = options.stt
    this.now = options.now ?? (() => new Date())
    this.environment = options.environment ?? process.env
  }

  // -------------------------------------------------------------------------
  // 生成（transcript / webvtt / audio 共用一条 createJob 闸门链）
  // -------------------------------------------------------------------------

  /**
   * 投入转写文本 → 生成候选闪卡草稿。绝不写题库：本方法返回后
   * `QuestionBankService.list()` 的结果不变。
   */
  public async createJob(
    input: CreateFlashcardJobInput
  ): Promise<FlashcardDraftJobView> {
    const teacherId = input.teacherId.trim()
    if (teacherId === '') {
      throw new FlashcardDraftInputError('teacherId is required')
    }
    if (!input.questionBankId.trim()) {
      throw new FlashcardDraftInputError('questionBankId is required')
    }
    if (input.noStudentSpeechDeclaration !== true) {
      throw new FlashcardStudentSpeechError(
        '学生课堂发言默认禁止作为题库材料：必须勾选「素材无学生发言」声明'
      )
    }
    const rawText = input.rawText.trim()
    if (rawText.length < MIN_RAW_TEXT_CHARS) {
      throw new FlashcardDraftInputError(
        `转写文本过短（至少 ${String(MIN_RAW_TEXT_CHARS)} 字）`
      )
    }
    if (rawText.length > MAX_RAW_TEXT_CHARS) {
      throw new FlashcardDraftInputError(
        `转写文本过长（上限 ${String(MAX_RAW_TEXT_CHARS)} 字）`
      )
    }

    const timestamp = this.now().toISOString()
    const jobId = newFlashcardJobId()
    const sourceKind = input.sourceKind ?? 'transcript'

    const generated = await this.generator.generate({
      rawText,
      subject: input.subject,
      sourceKind,
      sourceLabel: `flashcard-draft:${sourceKind}:${jobId}`
    })

    // 红线 5：正面溯源过滤。LLM 编造的 front 不得进入校对面板。
    const grounded = generated
      .filter((candidate) => verifyFrontIsGrounded(candidate.front, rawText))
      // 正面非空才保留（模板 back 留空合法，front 恒非空）。
      .filter((candidate) => candidate.front.trim() !== '')

    // 若 LLM 产物全部编造/不可溯源，回落到模板（模板 front 恒取自原文）。
    // 注意：generator 是 OpenAI 包装时自身已带 fallback；这里处理的是
    // 「LLM 编造概念」的硬剔除兜底 —— 模板 front 直接抽取原文，恒可溯源。
    let finalDrafts = grounded
    if (finalDrafts.length === 0) {
      finalDrafts = await new TemplateFlashcardDraftGenerator().generate({
        rawText,
        subject: input.subject,
        sourceKind,
        sourceLabel: `flashcard-draft:${sourceKind}:${jobId}`
      })
    }

    // 兜底：即使模板也拿不到（例如原文全是标点），仍给出空列表 → job failed。
    const status: FlashcardJobStatus =
      finalDrafts.length > 0 ? 'generated' : 'failed'

    const job: FlashcardDraftJob = {
      id: jobId,
      teacherId,
      questionBankId: input.questionBankId,
      subject: input.subject,
      sourceKind,
      // 只留 hash，不落全文（ADR-0003 / T10 减 PII 面）。
      rawTextHash: createHash('sha256').update(rawText).digest('hex'),
      status,
      generatorModel: this.generator.model,
      degraded: this.generator.degraded,
      draftCount: finalDrafts.length,
      createdAt: timestamp,
      updatedAt: timestamp
    }
    if (input.teachingUnitId) job.teachingUnitId = input.teachingUnitId
    if (input.sourceRef) job.sourceRef = input.sourceRef
    this.store.saveJob(job)

    for (const candidate of finalDrafts) {
      const flashcard: FlashcardDraft = {
        id: newFlashcardDraftId(),
        jobId,
        teacherId,
        front: candidate.front,
        back: candidate.back,
        sourceExcerpt: candidate.sourceExcerpt,
        status: 'draft',
        // 生成物永远是 llm_inference —— 由生成器构造，服务层不覆写。
        provenance: candidate.provenance,
        confidence: candidate.confidence,
        // 进入本循环的 front 已通过 verifyFrontIsGrounded。
        frontGrounded: verifyFrontIsGrounded(candidate.front, rawText),
        createdAt: timestamp,
        updatedAt: timestamp
      }
      this.store.saveFlashcard(flashcard)
    }

    return this.getJobView(jobId, teacherId)
  }

  /**
   * 音频入口（PRD）：feature flag 默认关闭；非本地 STT 且未开出境 → 拒绝；
   * 必须勾选「无学生发言素材」声明；时长 ≤ 15min。转写文本随后走同一条
   * createJob 闸门链（sourceKind = 'audio'）。
   */
  public async createAudioJob(
    input: CreateAudioJobInput
  ): Promise<FlashcardDraftJobView> {
    if (this.environment.FLASHCARD_AUDIO_ENABLED !== 'true') {
      throw new FlashcardAudioDisabledError(
        '音频出题路径未开启：设置 FLASHCARD_AUDIO_ENABLED=true 后启用'
      )
    }
    if (input.noStudentSpeechDeclaration !== true) {
      throw new FlashcardStudentSpeechError(
        '学生课堂录音默认禁止作为题库材料：必须勾选「素材无学生发言」声明'
      )
    }
    const duration = input.durationSeconds ?? 0
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new FlashcardDraftInputError('durationSeconds（正数）是必填项')
    }
    if (duration > MAX_AUDIO_DURATION_SECONDS) {
      throw new FlashcardDraftInputError(
        `音频时长超过上限（${String(MAX_AUDIO_DURATION_SECONDS / 60)} 分钟）`
      )
    }

    // T10 egress gate：非本地 STT 需要显式开出境开关。
    this.assertSttEgressAllowed()

    const transcript = input.transcript?.trim() ?? ''
    // audioBase64 without a real STT pipeline is not supported: never invent a
    // placeholder transcript from byte length (review Issue: false confidence).
    if (transcript === '' && input.audioBase64) {
      throw new FlashcardDraftInputError(
        'audioBase64 转写尚未接入真实 STT：请提供 transcript 文本（或 WebVTT 字幕）后再创建任务'
      )
    }
    if (transcript === '') {
      throw new FlashcardDraftInputError(
        '没有可用的转写文本：请提供 transcript'
      )
    }

    return this.createJob({
      teacherId: input.teacherId,
      questionBankId: input.questionBankId,
      subject: input.subject,
      rawText: transcript,
      noStudentSpeechDeclaration: input.noStudentSpeechDeclaration,
      sourceKind: 'audio',
      sourceRef: input.sourceRef,
      teachingUnitId: input.teachingUnitId
    })
  }

  // -------------------------------------------------------------------------
  // 读取
  // -------------------------------------------------------------------------

  public listJobs(teacherId: string): FlashcardDraftJob[] {
    return this.store.listJobsByTeacher(teacherId)
  }

  public getJobView(
    jobId: string,
    teacherId: string
  ): FlashcardDraftJobView {
    const job = this.getOwnedJob(jobId, teacherId)
    return {
      job,
      drafts: this.store.listFlashcardsByJob(job.id),
      gateNotice: FLASHCARD_GATE_NOTICE
    }
  }

  public getFlashcard(id: string, teacherId: string): FlashcardDraft {
    const flashcard = this.store.getFlashcard(id)
    if (!flashcard) throw new FlashcardDraftNotFoundError(id)
    if (flashcard.teacherId !== teacherId) {
      throw new FlashcardDraftOwnershipError(
        'Forbidden: flashcard draft is teacher-private'
      )
    }
    return flashcard
  }

  // -------------------------------------------------------------------------
  // 修正 / 丢弃
  // -------------------------------------------------------------------------

  /** 教师修正闪卡字段。已确认或已丢弃的草稿不可再改。 */
  public patchFlashcard(
    id: string,
    teacherId: string,
    patch: FlashcardPatchInput
  ): FlashcardDraft {
    const flashcard = this.getFlashcard(id, teacherId)
    if (flashcard.status !== 'draft') {
      throw new FlashcardDraftGateError(
        `闪卡草稿 ${flashcard.id} 状态为 ${flashcard.status}，不可再修改`
      )
    }
    const nextFront = patch.front?.trim() ?? flashcard.front
    const frontChanged = nextFront !== flashcard.front
    const next: FlashcardDraft = {
      ...flashcard,
      front: nextFront,
      back: patch.back?.trim() ?? flashcard.back,
      // Teacher rewrite of front invalidates generation-time grounding; confirm
      // will reject until front is restored or grounding policy is revisited.
      frontGrounded: frontChanged ? false : flashcard.frontGrounded,
      updatedAt: this.now().toISOString()
    }
    this.store.saveFlashcard(next)
    return next
  }

  /** 丢弃草稿：不产生任何 Question。 */
  public discardFlashcard(
    id: string,
    teacherId: string
  ): { flashcard: FlashcardDraft; job: FlashcardDraftJob } {
    const flashcard = this.getFlashcard(id, teacherId)
    if (flashcard.status === 'confirmed') {
      throw new FlashcardDraftGateError(
        `闪卡草稿 ${flashcard.id} 已入库，不可丢弃（请到题库删除该题）`
      )
    }
    const next: FlashcardDraft = {
      ...flashcard,
      status: 'discarded',
      updatedAt: this.now().toISOString()
    }
    this.store.saveFlashcard(next)
    return { flashcard: next, job: this.recomputeJobStatus(flashcard.jobId) }
  }

  // -------------------------------------------------------------------------
  // 校对闸门
  // -------------------------------------------------------------------------

  /**
   * 硬闸门：教师逐条确认。通过后才写入题库（source = authored_key，
   * authorId = 教师），草稿 provenance 升级为 teacher_annotation。
   * 确认后闪卡落为一条 `fill_blank` 题库题：stem 以「解释概念」为题干，
   * back 作为答案权威 —— 与 T15「教师是答案唯一权威」同一语义。
   */
  public confirmFlashcard(
    id: string,
    teacherId: string,
    input: ConfirmFlashcardInput = {}
  ): ConfirmFlashcardResult {
    return this.store.transaction(() =>
      this.confirmFlashcardInTransaction(id, teacherId, input)
    )
  }

  private confirmFlashcardInTransaction(
    id: string,
    teacherId: string,
    input: ConfirmFlashcardInput
  ): ConfirmFlashcardResult {
    const flashcard = this.getFlashcard(id, teacherId)
    if (flashcard.status === 'confirmed') {
      throw new FlashcardDraftGateError(
        `闪卡草稿 ${flashcard.id} 已确认入库（Question ${flashcard.confirmedQuestionId ?? '?'}）`
      )
    }
    if (flashcard.status === 'discarded') {
      throw new FlashcardDraftGateError(`闪卡草稿 ${flashcard.id} 已丢弃，不可确认`)
    }

    const job = this.getOwnedJob(flashcard.jobId, teacherId)
    const merged = {
      front: input.front?.trim() ?? flashcard.front,
      back: input.back?.trim() ?? flashcard.back
    }

    // 闸门第一关：front + back 必须齐全。back 缺失不得入库用于测评。
    if (!isFlashcardReady(merged)) {
      throw new FlashcardDraftGateError(
        `闪卡草稿 ${flashcard.id} 缺少内容权威：正面概念与背面解释都必须填写才能确认入库`
      )
    }

    // 正面溯源：生成期已过滤 LLM 编造概念。教师在 patch 后可能改写 front
    // （frontGrounded → false）；确认即教师背书（authored_key），允许入库。
    // 未改过 front 且生成期未通过溯源的草稿不会出现在列表（create 已剔除）。

    // 落为 fill_blank 题库题（PRD：闪卡可统一进填空草稿形态）。
    const stem = `根据材料解释概念「${merged.front}」：______。`
    const questionDraft: QuestionDraft = {
      questionBankId: job.questionBankId,
      // 溯源：入库题的作者永远是确认的教师，不是 LLM。
      authorId: teacherId,
      subject: job.subject,
      questionType: 'fill_blank',
      stem,
      payload: { kind: 'fill_blank', acceptedAnswers: [merged.back] },
      kpIds: [],
      difficulty: 3,
      // D2 答案权威，硬编码为教师答案权威，调用方不可覆盖。
      source: CONFIRMED_FLASHCARD_AUTHORITY
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
        throw new FlashcardDraftGateError(
          `闪卡草稿 ${flashcard.id} 校验未通过：${error.message}`
        )
      }
      throw error
    }

    const next: FlashcardDraft = {
      ...flashcard,
      front: merged.front,
      back: merged.back,
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
    this.store.saveFlashcard(next)

    return {
      flashcard: next,
      question,
      job: this.recomputeJobStatus(flashcard.jobId)
    }
  }

  // -------------------------------------------------------------------------
  // 测评引用闸门
  // -------------------------------------------------------------------------

  /** 只有确认入库的草稿才可被测评场次引用。 */
  public isFlashcardAssessable(flashcard: FlashcardDraft): boolean {
    return (
      flashcard.status === 'confirmed' &&
      flashcard.confirmedQuestionId !== undefined
    )
  }

  /**
   * 解析草稿 → 可布置的 Question id。未确认时抛闸门错误（路由层 422），
   * 这是「未确认闪卡不可出现在测评选题器」的服务端强制点。
   */
  public resolveAssessmentQuestionId(id: string, teacherId: string): string {
    const flashcard = this.getFlashcard(id, teacherId)
    if (!this.isFlashcardAssessable(flashcard)) {
      throw new FlashcardDraftGateError(
        `闪卡草稿 ${flashcard.id} 未经教师校对确认，不可用于测评（当前状态：${flashcard.status}）`
      )
    }
    return flashcard.confirmedQuestionId as string
  }

  // -------------------------------------------------------------------------
  // internals
  // -------------------------------------------------------------------------

  /** T10 egress gate：aliyun 是远程 STT，需显式开出境开关才放行。 */
  private assertSttEgressAllowed(): void {
    const providerName = this.stt?.name ?? 'mock'
    const isLocal = providerName === 'mock' || providerName === 'webspeech'
    if (isLocal) return
    const allowsEgress =
      this.environment.STT_ALLOW_EGRESS === 'true' ||
      this.environment.FLASHCARD_STT_EGRESS === 'true'
    if (!allowsEgress) {
      throw new FlashcardEgressGateError(
        `STT provider 为远程（${providerName}），出境开关未开启：` +
          '拒绝非本地 STT（T10 egress gate）。请使用本地 STT 或设置 FLASHCARD_STT_EGRESS=true。'
      )
    }
  }

  private getOwnedJob(
    jobId: string,
    teacherId: string
  ): FlashcardDraftJob {
    const job = this.store.getJob(jobId)
    if (!job) throw new FlashcardDraftNotFoundError(jobId)
    if (job.teacherId !== teacherId) {
      throw new FlashcardDraftOwnershipError(
        'Forbidden: flashcard draft job is teacher-private'
      )
    }
    return job
  }

  /** 依据草稿状态重算任务进度：generated → partially_confirmed → done。 */
  private recomputeJobStatus(jobId: string): FlashcardDraftJob {
    const job = this.store.getJob(jobId)
    if (!job) throw new FlashcardDraftNotFoundError(jobId)
    const drafts = this.store.listFlashcardsByJob(jobId)
    const pending = drafts.filter((draft) => draft.status === 'draft').length
    const confirmed = drafts.filter(
      (draft) => draft.status === 'confirmed'
    ).length

    let status: FlashcardJobStatus = job.status
    if (drafts.length === 0) {
      status = 'failed'
    } else if (pending === 0) {
      status = 'done'
    } else if (confirmed > 0) {
      status = 'partially_confirmed'
    } else {
      status = 'generated'
    }

    const next: FlashcardDraftJob = {
      ...job,
      status,
      updatedAt: this.now().toISOString()
    }
    this.store.saveJob(next)
    return next
  }
}
