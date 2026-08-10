/**
 * studyPlan — 硬事实学习计划契约（T18）。
 *
 * 这是一份**独立的**契约文件（不动 shared/contracts.ts），描述滚动 7 日
 * 学习计划的输入（硬事实快照）与输出（StudyPlan）。
 *
 * 铁律（ADR-0001 / ADR-0006 / CONTEXT「candidateTasks 硬输入」）：
 *
 *   1. `days[].tasks[]` **只**由硬输入确定性生成：
 *      FSRS due 卡片 ∩ 依赖链薄弱 ∩ assessment MasteryProfile 低于阈值
 *      ∩ TeachingUnit.taughtKpIds（D4）。
 *   2. 每一个 task 必须携带**非空** `evidenceRefs` —— 可追溯到具体的
 *      ReviewCard 或 MasteryProfile 条目。没有硬输入支撑就**不产出该 task**，
 *      而不是编内容。全盘无硬输入时 `status = 'insufficient_evidence'`，
 *      days 仍为 7 天但 tasks 全空。
 *   3. LLM **只能**写 `presentationHint`（调味文案），provenance 必须是
 *      `llm_inference`。它不影响、也不得改变 `days`/`tasks` 的任何内容；
 *      无 LLM 时 tasks 完整、hint 缺省。
 *   4. 计划生成是只读投影：绝不反向写入 score / evidence / MasteryProfile。
 *
 * 该不变量由 tests/studyPlan.test.ts 契约测试守护。
 */
import type {
  MasteryProfileMap,
  Provenance,
  ReviewCard,
  SessionMode
} from './contracts'

/** 计划算法版本号 —— 可重放（同一硬输入必得同一计划）。 */
export const STUDY_PLAN_ALGORITHM = 'plan.hard.v1'

/** 滚动窗口长度（自然日）。 */
export const STUDY_PLAN_HORIZON_DAYS = 7

/**
 * 一个 task 进入计划的硬理由。
 * - `fsrs`    —— FSRS 到期卡片（ReviewCard）
 * - `weak`    —— 依赖链薄弱（前置 KP 未过阈值）
 * - `mastery` —— assessment MasteryProfile 低于阈值
 *
 * 刻意不含 `narrative` / `emotion` / `chat` —— 软输入永不进 candidateTasks。
 */
export type StudyPlanTaskReason = 'fsrs' | 'weak' | 'mastery'

/** 计划整体状态。空计划是合法的冷启动态，不是错误。 */
export type StudyPlanStatus = 'ok' | 'insufficient_evidence'

/**
 * 硬事实锚点 —— 每个 task 至少挂一条。这是「可追溯」的物理载体：
 * 审计时顺着它能回到确定性 Runner 产出的 Evidence 或其聚合快照。
 */
export type StudyPlanEvidenceRef =
  | {
      kind: 'review_card'
      /** ReviewCard.id（FSRS 调度事实，由 Attempt 证据驱动）。 */
      cardId: string
      kpId: string
      /** ISO-8601 到期时间。 */
      dueAt: string
    }
  | {
      kind: 'mastery_snapshot'
      kpId: string
      score: number
      /** MasterySnapshot.evidenceIds —— 直指底层 Evidence 原子。 */
      evidenceIds: string[]
      computedAt: string
      algorithmVersion: string
    }

/** 计划中的一条任务（KP 槽位）。 */
export interface StudyPlanTask {
  kpId: string
  /** 建议题量。 */
  targetCount: number
  /** 建议模式 —— 默认 practice（先练后测，只喂 FSRS 不动正式成绩）。 */
  mode: SessionMode
  reason: StudyPlanTaskReason
  /** 从教师私有题库选出的题（可为空：题库暂无该 KP 的题）。 */
  questionIds: string[]
  /** 非空不变量 —— 无硬事实锚点的 task 不允许存在。 */
  evidenceRefs: StudyPlanEvidenceRef[]
}

/** 计划中的一天。 */
export interface StudyPlanDay {
  /** YYYY-MM-DD（UTC 自然日）。 */
  date: string
  /** 0 = 今天，6 = 第七天。 */
  dayIndex: number
  tasks: StudyPlanTask[]
}

/**
 * 建议层文案（T05 / ADR-0006）。**外挂**在计划旁边，不参与 tasks 计算。
 * provenance.kind 必须是 'llm_inference'。
 */
export interface StudyPlanPresentationHint {
  text: string
  provenance: Provenance
}

/** 滚动 7 日硬事实学习计划。 */
export interface StudyPlan {
  /** 确定性 id：plan_<studentId>_<unitId>_<YYYY-MM-DD>，便于幂等重算。 */
  id: string
  studentId: string
  teachingUnitId: string
  termId: string
  horizonDays: number
  days: StudyPlanDay[]
  /** 算法版本，可重放。 */
  algorithm: string
  generatedAt: string
  status: StudyPlanStatus
  /** D4 已教进度过滤集（审计用）。 */
  taughtKpIds: string[]
  /** 全计划锚点并集 —— 审计入口。 */
  evidenceRefs: StudyPlanEvidenceRef[]
  /** 建议层，可缺省。无 LLM 时不影响 days。 */
  presentationHint?: StudyPlanPresentationHint
}

/** 依赖链诊断结果（InterventionService 投影，只取硬字段）。 */
export interface StudyPlanDependencyGap {
  /** 触发诊断的薄弱 KP（必须在 MasteryProfile 里有快照）。 */
  weakKp: string
  /** 诊断指向的最早未掌握前置 KP。 */
  targetKp: string
  chain: string[]
}

/**
 * 纯函数 `buildStudyPlan` 的**唯一**输入。
 *
 * 刻意做成一个扁平的数据快照（而不是传 Service 句柄），这样：
 *   - builder 保持纯函数，可用固定夹具做快照测试；
 *   - builder 物理上够不到任何写路径（没有 db、没有 store）。
 */
export interface StudyPlanHardFacts {
  studentId: string
  teachingUnitId: string
  termId: string
  /** D4 已教进度。空集 ⇒ 必然空计划。 */
  taughtKpIds: string[]
  /** FSRS 到期卡片（已按学生过滤）。 */
  dueCards: ReviewCard[]
  /**
   * assessment MasteryProfile。**只包含真实存在的快照** ——
   * 缺失的 KP 表示「没有证据」，绝不当成 score 0 的薄弱点处理。
   */
  masteryProfile: MasteryProfileMap
  /** 依赖链诊断（可为空数组）。 */
  dependencyGaps: StudyPlanDependencyGap[]
  /** kpId → 题库候选题 id（有序）。 */
  questionsByKp: Record<string, string[]>
  /** 生成时刻（ISO-8601）。决定 7 天窗口的起点与计划 id。 */
  now: string
}

/** 计划里所有 task 的扁平视图（T19/T20 复用）。 */
export function listStudyPlanTasks(plan: StudyPlan): StudyPlanTask[] {
  return plan.days.flatMap((day) => day.tasks)
}

/** 今日（dayIndex === 0）任务，学生首页入口使用。 */
export function listTodayTasks(plan: StudyPlan): StudyPlanTask[] {
  return plan.days.find((day) => day.dayIndex === 0)?.tasks ?? []
}

/**
 * 硬事实不变量断言：每个 task 都必须挂着至少一条 evidenceRef。
 * 返回违规 task 的 kpId 列表（空数组 = 合规）。
 */
export function findUnbackedTasks(plan: StudyPlan): string[] {
  return listStudyPlanTasks(plan)
    .filter((task) => task.evidenceRefs.length === 0)
    .map((task) => task.kpId)
}

/** 建议层校验：hint 必须是 llm_inference，否则不是合法的调味层。 */
export function isAdvisoryHint(
  hint: StudyPlanPresentationHint | undefined
): boolean {
  return hint?.provenance.kind === 'llm_inference'
}
