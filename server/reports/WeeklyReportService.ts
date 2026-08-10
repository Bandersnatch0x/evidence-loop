/**
 * WeeklyReportService — T19 学情周报的编排层。
 *
 * 职责严格限定为三步（与 T18 `StudyPlanService` 同款分层）：
 *   1. 通过**只读端口**收集一周硬事实快照（WeeklyReportHardFacts）；
 *   2. 交给纯函数 `buildWeeklyReport` 生成报告；
 *   3. 出口处做隐私净化（displayName / 教师提示正文过 PIIDetector）。
 *
 * 本类不做任何统计口径决策 —— 那些全在纯函数里，才能被快照测试锁死。
 * 本类持有的唯一写句柄是 `exports`（自有 weekly_report_exports 表）与
 * `audit`（append-only 审计链），所以「生成周报」这条路径在物理上不可能写
 * score / evidence / MasteryProfile（ADR-0001）。
 *
 * 叙述性文案（narrative）是**事后外挂**：`attachReportNarrative` 只往章节上
 * 贴一个字段，metrics/items/status 逐字节不变；provenance 不是
 * `llm_inference`、正文为空、或正文命中 PII 的，一律拒绝。无 LLM 时整条链路
 * 照常工作。
 */
import { MASTERY_THRESHOLD } from '../config/mastery'
import { findPIIInText } from '../pii/PIIDetector'
import type { Attempt } from '../../shared/contracts'
import { listStudyPlanTasks, type StudyPlan } from '../../shared/studyPlan'
import {
  WEEKLY_REPORT_WINDOW_DAYS,
  type WeeklyReport,
  type WeeklyReportAttemptFact,
  type WeeklyReportHardFacts,
  type WeeklyReportMasteryFact,
  type WeeklyReportMistakeFact,
  type WeeklyReportNarrative,
  type WeeklyReportPlanFact,
  type WeeklyReportSectionId,
  type WeeklyReportTipFact,
  type WeeklyReportWindow
} from '../../shared/weeklyReport'
import {
  buildWeeklyReport,
  type BuildWeeklyReportOptions
} from './buildWeeklyReport'
import {
  WeeklyReportUnitMissingError,
  WeeklyReportWindowError,
  type WeeklyReportAliasReader,
  type WeeklyReportAttemptReader,
  type WeeklyReportMasteryReader,
  type WeeklyReportMistakeReader,
  type WeeklyReportOrgReader,
  type WeeklyReportPlanReader,
  type WeeklyReportTipReader
} from './ports'

/** 命中 PII 的教师提示正文的替代文案（不丢条目，只隐去正文）。 */
export const REDACTED_TIP_TEXT = '（该条教师提示包含隐私字段，已在报告中隐去）'

/** 时间窗上限：防止一次拉全学期数据（周报就是周报）。 */
const MAX_WINDOW_DAYS = 31

export interface WeeklyReportServiceOptions {
  attempts: WeeklyReportAttemptReader
  mastery: WeeklyReportMasteryReader
  mistakes: WeeklyReportMistakeReader
  tips: WeeklyReportTipReader
  org: WeeklyReportOrgReader
  /**
   * 可选：T18 学习计划。缺席（未接线 / 抛错）时「下周建议」章节降级为
   * 证据不足，整份报告照常生成。
   */
  plan?: WeeklyReportPlanReader
  /** 可选：学名号 / 化名。缺席时 displayName 退化为 studentId。 */
  aliases?: WeeklyReportAliasReader
  now?: () => Date
  windowDays?: number
}

export interface GenerateWeeklyReportOptions extends BuildWeeklyReportOptions {
  /** ISO-8601 窗口起点（含）。缺省 = to − windowDays。 */
  from?: string
  /** ISO-8601 窗口终点（不含）。缺省 = now。 */
  to?: string
}

export class WeeklyReportService {
  private readonly attempts: WeeklyReportAttemptReader
  private readonly mastery: WeeklyReportMasteryReader
  private readonly mistakes: WeeklyReportMistakeReader
  private readonly tips: WeeklyReportTipReader
  private readonly org: WeeklyReportOrgReader
  private readonly plan: WeeklyReportPlanReader | undefined
  private readonly aliases: WeeklyReportAliasReader | undefined
  private readonly now: () => Date
  private readonly windowDays: number

  public constructor(options: WeeklyReportServiceOptions) {
    this.attempts = options.attempts
    this.mastery = options.mastery
    this.mistakes = options.mistakes
    this.tips = options.tips
    this.org = options.org
    this.plan = options.plan
    this.aliases = options.aliases
    this.now = options.now ?? (() => new Date())
    this.windowDays = options.windowDays ?? WEEKLY_REPORT_WINDOW_DAYS
  }

  /**
   * 生成一份周报。每次调用都是全量重算 —— 同一硬事实必得同一报告
   * （algorithm 可重放），所以不需要缓存正确性兜底。
   */
  public async generate(
    studentId: string,
    teachingUnitId: string,
    options: GenerateWeeklyReportOptions = {}
  ): Promise<WeeklyReport> {
    const facts = await this.collectHardFacts(
      studentId,
      teachingUnitId,
      options
    )
    return buildWeeklyReport(facts, {
      ...(options.mistakeTopN !== undefined
        ? { mistakeTopN: options.mistakeTopN }
        : {}),
      ...(options.weakTopN !== undefined ? { weakTopN: options.weakTopN } : {}),
      ...(options.tipTopN !== undefined ? { tipTopN: options.tipTopN } : {})
    })
  }

  /**
   * 收集一周硬事实快照。**唯一**的数据入口 —— 想审计「报告里的数字凭什么
   * 是这个值」，读这个方法的返回值即可完整重放。
   */
  public async collectHardFacts(
    studentId: string,
    teachingUnitId: string,
    options: GenerateWeeklyReportOptions = {}
  ): Promise<WeeklyReportHardFacts> {
    const unit = this.org.getTeachingUnit(teachingUnitId)
    if (!unit) throw new WeeklyReportUnitMissingError(teachingUnitId)

    const now = this.now()
    const window = this.resolveWindow(options, now)

    const rawAttempts = await this.attempts.listAttempts({
      studentId,
      teachingUnitId: unit.id,
      termId: unit.termId
    })
    const attempts = rawAttempts
      .filter(
        (attempt) =>
          attempt.createdAt >= window.from && attempt.createdAt < window.to
      )
      .map(toAttemptFact)

    const masteryProfile = this.mastery.getProfile(studentId)
    const mastery: WeeklyReportMasteryFact[] = Object.entries(masteryProfile)
      .map(([kpId, snapshot]) => ({
        kpId,
        score: snapshot.score,
        evidenceIds: [...snapshot.evidenceIds],
        computedAt: snapshot.computedAt,
        algorithmVersion: snapshot.algorithmVersion
      }))
      .sort((a, b) => a.kpId.localeCompare(b.kpId))

    const mistakeBook = await this.mistakes.view(studentId)
    const mistakes: WeeklyReportMistakeFact[] = mistakeBook.entries.map(
      (entry) => ({
        questionId: entry.questionId,
        teachingUnitId: entry.teachingUnitId,
        attemptId: entry.attemptId,
        kpIds: [...entry.kpIds],
        lastScore: entry.lastScore,
        lastActiveAt: entry.lastActiveAt,
        mastered: entry.mastered
      })
    )

    const tips: WeeklyReportTipFact[] = this.tips
      .listForStudent(studentId)
      .map((tip) => ({
        tipId: tip.id,
        teachingUnitId: tip.teachingUnitId,
        teacherId: tip.teacherId,
        // 隐私闸门：教师手写正文可能夹带手机号/邮箱，命中即整段隐去。
        body: redactIfPII(`teacherTip[${tip.id}].body`, tip.body),
        createdAt: tip.createdAt,
        kpIds: tip.kpIds ? [...tip.kpIds] : []
      }))

    const plan = await this.collectPlanFact(studentId, unit.id)

    return {
      studentId,
      displayName: this.resolveDisplayName(studentId),
      teachingUnitId: unit.id,
      termId: unit.termId,
      window,
      attempts,
      mastery,
      taughtKpIds: [...unit.taughtKpIds],
      mistakes,
      tips,
      ...(plan ? { plan } : {}),
      masteryThreshold: MASTERY_THRESHOLD,
      now: now.toISOString()
    }
  }

  /**
   * 下周建议的数据源（T18）。计划端口未注入或抛错时返回 undefined ——
   * 报告降级为「下周建议证据不足」，绝不整份 500。
   */
  private async collectPlanFact(
    studentId: string,
    teachingUnitId: string
  ): Promise<WeeklyReportPlanFact | undefined> {
    if (!this.plan) return undefined
    let plan: StudyPlan
    try {
      plan = await this.plan.generate(studentId, teachingUnitId)
    } catch {
      return undefined
    }
    return {
      planId: plan.id,
      algorithm: plan.algorithm,
      status: plan.status,
      tasks: listStudyPlanTasks(plan).map((task) => ({
        kpId: task.kpId,
        targetCount: task.targetCount,
        mode: task.mode,
        reason: task.reason,
        evidenceRefs: [...task.evidenceRefs]
      }))
    }
  }

  /**
   * 隐私安全展示名。上游给的别名也要过一遍 PIIDetector —— 不信任上游，
   * 命中真实姓名/手机/邮箱则退回 studentId（学名号本身是安全标识）。
   */
  private resolveDisplayName(studentId: string): string {
    const alias = this.aliases?.getDisplayName(studentId)?.trim()
    if (alias === undefined || alias === '') return studentId
    if (findPIIInText('report.displayName', alias).length > 0) return studentId
    return alias
  }

  private resolveWindow(
    options: GenerateWeeklyReportOptions,
    now: Date
  ): WeeklyReportWindow {
    const to = options.to ? parseIso(options.to, 'to') : now
    const from = options.from
      ? parseIso(options.from, 'from')
      : new Date(to.getTime() - this.windowDays * 86_400_000)
    if (from.getTime() >= to.getTime()) {
      throw new WeeklyReportWindowError('from must be earlier than to')
    }
    const spanDays = (to.getTime() - from.getTime()) / 86_400_000
    if (spanDays > MAX_WINDOW_DAYS) {
      throw new WeeklyReportWindowError(
        `Report window must not exceed ${String(MAX_WINDOW_DAYS)} days`
      )
    }
    return { from: from.toISOString(), to: to.toISOString() }
  }
}

// ---------------------------------------------------------------------------
// 建议层安全闸门
// ---------------------------------------------------------------------------

/**
 * narrative 是否可接受。三道门缺一不可：
 *   1. provenance.kind === 'llm_inference'（ADR-0006：AI 产物必须自证来源）；
 *   2. 正文非空；
 *   3. 正文不含 PII（ADR-0003：AI 复述学生信息也算泄露）。
 */
export function isAcceptableNarrative(
  narrative: WeeklyReportNarrative | undefined
): boolean {
  if (!narrative) return false
  if (narrative.provenance.kind !== 'llm_inference') return false
  if (narrative.text.trim() === '') return false
  return findPIIInText('report.narrative', narrative.text).length === 0
}

/**
 * 把叙述性文案贴到某个章节上。**纯函数**：返回新对象，章节的
 * `metrics` / `items` / `series` / `status` 引用原样透传，所以 LLM 文案
 * 在物理上不可能改动任何一个数字。不合格的 narrative 一律原样返回。
 */
export function attachReportNarrative(
  report: WeeklyReport,
  sectionId: WeeklyReportSectionId,
  narrative: WeeklyReportNarrative | undefined
): WeeklyReport {
  if (!isAcceptableNarrative(narrative) || narrative === undefined) {
    return report
  }
  if (!report.sections.some((section) => section.id === sectionId)) {
    return report
  }
  return {
    ...report,
    sections: report.sections.map((section) =>
      section.id === sectionId ? { ...section, narrative } : section
    )
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * Attempt → 扁平事实。刻意只取硬字段：
 * summary / evidence[].actual 等自由文本**不进**报告，PII 面收敛到零。
 */
function toAttemptFact(attempt: Attempt): WeeklyReportAttemptFact {
  const durationMs = attempt.result.trace.reduce(
    (sum, step) => sum + (Number.isFinite(step.durationMs) ? step.durationMs : 0),
    0
  )
  return {
    attemptId: attempt.id,
    evaluationId: attempt.result.id,
    questionId: attempt.questionId,
    mode: attempt.mode,
    createdAt: attempt.createdAt,
    score: attempt.result.score,
    status: attempt.result.status,
    durationMs
  }
}

function redactIfPII(field: string, value: string): string {
  return findPIIInText(field, value).length > 0 ? REDACTED_TIP_TEXT : value
}

function parseIso(value: string, label: string): Date {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new WeeklyReportWindowError(`Invalid ISO-8601 ${label}: ${value}`)
  }
  return parsed
}
