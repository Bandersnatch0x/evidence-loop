/**
 * weeklyReport — 学情周报契约（T19）。
 *
 * 这是一份**独立的**契约文件（不动 shared/contracts.ts），描述「一周学情
 * 周报」的输入（硬事实快照）与输出（WeeklyReport）。
 *
 * 铁律（ADR-0001 / ADR-0006 / PRD T19）：
 *
 *   1. 报告里的**每一个数字**都必须挂非空 `evidenceRefs` —— 顺着它能回到
 *      具体的 Attempt / MasterySnapshot / MistakeEntry / ReviewCard。
 *      没有硬输入就不产出该数字，而不是编一个。
 *   2. 无数据的章节 `status = 'insufficient_evidence'` + 明确的空态文案，
 *      章节骨架仍然完整（诚实地空着），绝不 500、也绝不用 LLM 兜底填数。
 *   3. LLM **只能**写 `section.narrative`（叙述性包装文案），provenance 必须
 *      是 `llm_inference`，且不得改变任何 metric / item / status。
 *      无 LLM 时报告完整、narrative 缺省。
 *   4. 报告生成是只读投影：绝不反向写入 score / evidence / MasteryProfile。
 *   5. 隐私：`displayName` 默认学名号/化名；手机、邮箱、真实姓名不进报告。
 *
 * 该不变量由 tests/weeklyReport.test.ts 契约测试守护。
 */
import type { Provenance, SessionMode } from './contracts'
import type { StudyPlanEvidenceRef, StudyPlanTaskReason } from './studyPlan'

/** 报告算法版本号 —— 可重放（同一硬事实快照必得同一报告）。 */
export const WEEKLY_REPORT_ALGORITHM = 'report.weekly.v1'

/** 默认时间窗长度（自然日）。 */
export const WEEKLY_REPORT_WINDOW_DAYS = 7

/** 错题章节最多展示条数（PRD：Top3–5）。 */
export const WEEKLY_REPORT_MISTAKE_TOP_N = 5

/** 薄弱知识点章节最多展示条数。 */
export const WEEKLY_REPORT_WEAK_TOP_N = 5

/** 教师提示摘录最多展示条数。 */
export const WEEKLY_REPORT_TIP_TOP_N = 5

// ---------------------------------------------------------------------------
// 章节
// ---------------------------------------------------------------------------

/** 固定章节标识（PRD 表格顺序，不可重排）。 */
export type WeeklyReportSectionId =
  | 'completion'
  | 'assessment_trend'
  | 'weak_kps'
  | 'mistake_top'
  | 'practice_activity'
  | 'next_week'
  | 'teacher_tips'

/** 章节固定顺序 —— 渲染层按此数组输出，不按对象 key 顺序。 */
export const WEEKLY_REPORT_SECTION_ORDER: readonly WeeklyReportSectionId[] = [
  'completion',
  'assessment_trend',
  'weak_kps',
  'mistake_top',
  'practice_activity',
  'next_week',
  'teacher_tips'
]

/** 章节中文标题（打印页与前端共用同一份，避免两处文案漂移）。 */
export const WEEKLY_REPORT_SECTION_TITLES: Record<
  WeeklyReportSectionId,
  string
> = {
  completion: '完成与时长',
  assessment_trend: '测评得分趋势',
  weak_kps: '薄弱知识点',
  mistake_top: '错题 Top5',
  practice_activity: '练习活动量',
  next_week: '下周建议',
  teacher_tips: '教师提示摘录'
}

/**
 * 内容分层 —— 决定 UI 是否打灰标。
 * - `evidence`           确定性 Runner 证据聚合，可追溯，可作数
 * - `advisory`           LLM 叙述性包装文案，灰标，永不作数
 * - `teacher_annotation` 教师手写内容（T14 提示），非评分，非 AI
 */
export type WeeklyReportLayer = 'evidence' | 'advisory' | 'teacher_annotation'

/** 章节状态。空章节是合法的诚实态，不是错误。 */
export type WeeklyReportSectionStatus = 'ok' | 'insufficient_evidence'

/** 报告整体状态。全章节皆空 ⇒ 整体证据不足。 */
export type WeeklyReportStatus = 'ok' | 'insufficient_evidence'

// ---------------------------------------------------------------------------
// 证据锚点
// ---------------------------------------------------------------------------

/**
 * 一次提交的锚点。`evaluationId` 直指 EvaluationResult ——
 * 顺着它能取到确定性 Runner 产出的 EvidenceItem 原子。
 */
export interface WeeklyReportAttemptRef {
  kind: 'attempt'
  attemptId: string
  evaluationId: string
  questionId: string
  mode: SessionMode
  createdAt: string
  score: number
}

/** 错题本条目的锚点（指回造成错题的那次 Attempt）。 */
export interface WeeklyReportMistakeRef {
  kind: 'mistake_entry'
  questionId: string
  attemptId: string
  lastScore: number
  lastActiveAt: string
}

/**
 * 教师提示锚点。**注意**：这不是评分证据，而是 teacher_annotation 的溯源
 * 载体 —— 用来回答「这句话是谁在什么时候写的」，不参与任何数字计算。
 */
export interface WeeklyReportTipRef {
  kind: 'teacher_tip'
  tipId: string
  teacherId: string
  createdAt: string
}

/**
 * 报告锚点全集。
 *
 * 刻意直接复用 T18 的 `StudyPlanEvidenceRef`（review_card / mastery_snapshot）
 * ——「下周建议」章节的任务锚点原样透传，不做二次包装，审计时两个模块讲
 * 同一种话。
 */
export type WeeklyReportEvidenceRef =
  | StudyPlanEvidenceRef
  | WeeklyReportAttemptRef
  | WeeklyReportMistakeRef
  | WeeklyReportTipRef

// ---------------------------------------------------------------------------
// 章节内容
// ---------------------------------------------------------------------------

/**
 * 一个可展示的**数字**。非空 `evidenceRefs` 是硬不变量 ——
 * 算不出锚点的数字不允许出现在报告里。
 */
export interface WeeklyReportMetric {
  /** 稳定 key，如 `completion.attempts`，测试与前端按它取值。 */
  id: string
  label: string
  value: number
  /** 单位（'次' / '分钟' / '分' / '个'），纯展示。 */
  unit?: string
  /** 非空不变量。 */
  evidenceRefs: WeeklyReportEvidenceRef[]
}

/** 一条可展示的列表项（薄弱 KP / 错题 / 下周任务 / 教师提示）。 */
export interface WeeklyReportItem {
  /** 章节内唯一。 */
  id: string
  label: string
  detail?: string
  /** 可选数值（掌握度分数、建议题量等）。 */
  value?: number
  layer: WeeklyReportLayer
  /** evidence 层条目必须非空；teacher_annotation / advisory 层可为空。 */
  evidenceRefs: WeeklyReportEvidenceRef[]
  /** teacher_annotation / advisory 层必须自证来源（ADR-0006）。 */
  provenance?: Provenance
  /** 下周建议任务的硬理由（T18 reason 原样透传）。 */
  reason?: StudyPlanTaskReason
}

/** 得分趋势上的一个点。每个点都锚定一次真实 assessment 提交。 */
export interface WeeklyReportTrendPoint {
  /** YYYY-MM-DD（UTC 自然日）。 */
  date: string
  score: number
  attemptId: string
  evaluationId: string
  questionId: string
}

/**
 * 叙述性包装文案（建议层）。**外挂**在章节旁边，不参与任何数字计算。
 * provenance.kind 必须是 'llm_inference'。
 */
export interface WeeklyReportNarrative {
  text: string
  provenance: Provenance
}

/** 报告的一个章节。 */
export interface WeeklyReportSection {
  id: WeeklyReportSectionId
  title: string
  layer: WeeklyReportLayer
  status: WeeklyReportSectionStatus
  /** status = insufficient_evidence 时的明确空态文案（永不为空字符串）。 */
  emptyStateText?: string
  metrics: WeeklyReportMetric[]
  items: WeeklyReportItem[]
  /** 趋势序列，仅 assessment_trend 章节有。 */
  series?: WeeklyReportTrendPoint[]
  /** 口径说明（如 D1「练习不入正式掌握」），属事实注解，非 AI 文案。 */
  notes?: string[]
  /** 建议层文案，可缺省。缺省时章节数字完全不受影响。 */
  narrative?: WeeklyReportNarrative
}

// ---------------------------------------------------------------------------
// 报告
// ---------------------------------------------------------------------------

/** 报告时间窗（左闭右开：[from, to)）。 */
export interface WeeklyReportWindow {
  /** ISO-8601。 */
  from: string
  /** ISO-8601。 */
  to: string
}

/** 一份学情周报。 */
export interface WeeklyReport {
  /** 确定性 id：report_<studentId>_<unitId>_<fromDate>_<toDate>，便于幂等重算。 */
  id: string
  studentId: string
  /**
   * 隐私安全的展示名：学名号或化名。**绝不**是真实姓名/手机/邮箱。
   * 上游拿不到安全别名时退化为 studentId。
   */
  displayName: string
  teachingUnitId: string
  termId: string
  window: WeeklyReportWindow
  algorithm: string
  generatedAt: string
  status: WeeklyReportStatus
  /** 固定顺序，长度恒等于 WEEKLY_REPORT_SECTION_ORDER。 */
  sections: WeeklyReportSection[]
  /** 全报告锚点并集 —— 审计入口。 */
  evidenceRefs: WeeklyReportEvidenceRef[]
}

// ---------------------------------------------------------------------------
// 硬事实输入
// ---------------------------------------------------------------------------

/**
 * 一次提交的**扁平投影**。刻意不传整个 Attempt/EvaluationResult：
 *   - 纯函数只需要这几个硬字段；
 *   - 报告里因此物理上不可能出现 summary / evidence.actual 等自由文本
 *     （PII 面收敛到零）。
 */
export interface WeeklyReportAttemptFact {
  attemptId: string
  evaluationId: string
  questionId: string
  mode: SessionMode
  /** ISO-8601。 */
  createdAt: string
  score: number
  /** EvaluationStatus 原值（'completed' | 'rejected' | 'failed'）。 */
  status: string
  /** Σ trace[].durationMs —— 来自确定性 Runner 的执行耗时，非估算。 */
  durationMs: number
}

/** 错题本条目的扁平投影。 */
export interface WeeklyReportMistakeFact {
  questionId: string
  teachingUnitId: string
  attemptId: string
  kpIds: string[]
  lastScore: number
  lastActiveAt: string
  mastered: boolean
}

/** 教师提示的扁平投影（T14）。 */
export interface WeeklyReportTipFact {
  tipId: string
  teachingUnitId: string
  teacherId: string
  body: string
  createdAt: string
  kpIds: string[]
}

/** 掌握度快照的扁平投影（只取硬字段，避免耦合 MasteryProfileMap 演进）。 */
export interface WeeklyReportMasteryFact {
  kpId: string
  score: number
  evidenceIds: string[]
  computedAt: string
  algorithmVersion: string
}

/** 下周计划的扁平投影（T18 StudyPlan 摘要）。 */
export interface WeeklyReportPlanFact {
  planId: string
  algorithm: string
  status: string
  tasks: Array<{
    kpId: string
    targetCount: number
    mode: SessionMode
    reason: StudyPlanTaskReason
    /** T18 锚点原样透传。 */
    evidenceRefs: StudyPlanEvidenceRef[]
  }>
}

/**
 * 纯函数 `buildWeeklyReport` 的**唯一**输入。
 *
 * 与 T18 `StudyPlanHardFacts` 同款设计：扁平数据快照，不传 Service 句柄，
 * 于是 builder 保持纯函数、可做快照测试，且物理上够不到任何写路径。
 */
export interface WeeklyReportHardFacts {
  studentId: string
  displayName: string
  teachingUnitId: string
  termId: string
  window: WeeklyReportWindow
  /** 已按 studentId + teachingUnitId + 时间窗过滤。 */
  attempts: WeeklyReportAttemptFact[]
  /** 只包含**真实存在**的 assessment 掌握度快照。缺失 ≠ 0 分。 */
  mastery: WeeklyReportMasteryFact[]
  /** D4 已教进度。 */
  taughtKpIds: string[]
  /** 错题本条目（未过滤 mastered，由 builder 决定口径）。 */
  mistakes: WeeklyReportMistakeFact[]
  /** 教师提示（未过滤时间窗，由 builder 决定口径）。 */
  tips: WeeklyReportTipFact[]
  /** T18 下周计划摘要，可缺省（T18 未接线时报告照常生成）。 */
  plan?: WeeklyReportPlanFact
  /** 掌握度阈值（由 server/config/mastery 注入，契约层不 import server）。 */
  masteryThreshold: number
  /** 生成时刻（ISO-8601）。 */
  now: string
}

// ---------------------------------------------------------------------------
// 不变量断言辅助（测试与运行期共用）
// ---------------------------------------------------------------------------

/** 报告内全部数字的扁平视图。 */
export function listWeeklyReportMetrics(
  report: WeeklyReport
): WeeklyReportMetric[] {
  return report.sections.flatMap((section) => section.metrics)
}

/** 报告内全部列表项的扁平视图。 */
export function listWeeklyReportItems(
  report: WeeklyReport
): WeeklyReportItem[] {
  return report.sections.flatMap((section) => section.items)
}

/**
 * 硬事实不变量：每个数字都必须挂至少一条锚点。
 * 返回违规 metric 的 id 列表（空数组 = 合规）。
 */
export function findUnbackedMetrics(report: WeeklyReport): string[] {
  return listWeeklyReportMetrics(report)
    .filter((metric) => metric.evidenceRefs.length === 0)
    .map((metric) => metric.id)
}

/**
 * 硬事实不变量：evidence 层的列表项必须挂锚点；
 * advisory / teacher_annotation 层必须自证 provenance。
 * 返回违规 item 的 id 列表（空数组 = 合规）。
 */
export function findUnbackedItems(report: WeeklyReport): string[] {
  return listWeeklyReportItems(report)
    .filter((item) =>
      item.layer === 'evidence'
        ? item.evidenceRefs.length === 0
        : item.provenance === undefined
    )
    .map((item) => item.id)
}

/** 建议层校验：narrative 必须是 llm_inference，否则不是合法的调味层。 */
export function isAdvisoryNarrative(
  narrative: WeeklyReportNarrative | undefined
): boolean {
  return narrative?.provenance.kind === 'llm_inference'
}

/** 按 id 取章节（顺序无关，避免调用方写魔法下标）。 */
export function findWeeklyReportSection(
  report: WeeklyReport,
  id: WeeklyReportSectionId
): WeeklyReportSection | undefined {
  return report.sections.find((section) => section.id === id)
}

/** 按 id 取数字（找不到返回 undefined，不返回 0 —— 缺失 ≠ 零）。 */
export function findWeeklyReportMetric(
  report: WeeklyReport,
  metricId: string
): WeeklyReportMetric | undefined {
  return listWeeklyReportMetrics(report).find(
    (metric) => metric.id === metricId
  )
}

/** 章节是否处于诚实空态。 */
export function isSectionEmpty(section: WeeklyReportSection): boolean {
  return section.status === 'insufficient_evidence'
}
