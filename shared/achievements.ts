/**
 * achievements — 证据驱动的轻激励契约（T20）。
 *
 * 这是一份**独立的**契约文件（不动 shared/contracts.ts），描述固定目录的
 * 5 种成就徽章：它们各自的硬条件、自证来源，以及展示层文案的挂载点。
 *
 * 铁律（ADR-0001 / ADR-0006 / T18 硬事实追溯机制）：
 *
 *   1. 徽章授予是**确定性规则判定**，输入是可重放的硬事实快照
 *      （AchievementHardFacts），不是 LLM 判断、不是「学习态度」评价。
 *   2. 每一枚徽章必须携带**非空** `evidenceRefs` —— 能顺着它回到具体的
 *      Attempt / Evidence 原子 / ReviewCard / MasterySnapshot。没有证据
 *      支撑的徽章在数据通路上构造不出来（`findUnbackedAchievements` 是这
 *      条不变量的可执行断言）。
 *   3. LLM **只能**写 `presentationHint`（祝贺文案），provenance 必须是
 *      `llm_inference`。它不影响、也不得改变「是否授予」；无 LLM 时徽章
 *      照常授予、文案缺省。
 *   4. 授予徽章是**只读投影 + 自有表写入**：绝不反向写入 score / evidence /
 *      MasteryProfile，对掌握度算法零影响。
 *
 * 克制边界（PRD Out of Scope，写进类型而不是写进注释）：
 * `StudentAchievement` 里**没有** points / rank / level / streakPressure /
 * currency 字段，`AchievementClassSummary` 里**没有**逐学生明细 —— 积分
 * 排行榜、连胜压力、虚拟货币在类型层面就构造不出来。
 *
 * 该不变量由 tests/achievements.test.ts 契约测试守护。
 */
import type {
  EvaluationStatus,
  Provenance,
  SessionMode
} from './contracts'
import type { StudyPlanEvidenceRef } from './studyPlan'

/** 判定算法版本号 —— 可重放（同一硬事实必得同一批徽章）。 */
export const ACHIEVEMENT_ALGORITHM = 'achievement.hard.v1'

/** `repair_plus_20` 的分差阈值（含）。19 不授，20 授。 */
export const REPAIR_SCORE_DELTA = 20

/** `streak_study_3` 需要的连续自然日数。 */
export const STREAK_STUDY_DAYS = 3

/** 固定目录 —— MVP 不做徽章编辑器，5 种写死。 */
export type AchievementId =
  | 'first_evidence_pass'
  | 'repair_plus_20'
  | 'weak_kp_cleared'
  | 'streak_study_3'
  | 'plan_day_done'

/**
 * 徽章的自证来源。**复用 T18 的 `StudyPlanEvidenceRef`**（review_card /
 * mastery_snapshot），并补上 T20 自己需要的三种 Attempt 级锚点。
 *
 * 每一种都直指硬事实：attemptId / evidenceIds 能回到确定性 Runner 产出的
 * Evidence 原子；`plan_task_done` 额外带回 T18 计划任务自己的锚点。
 */
export type AchievementEvidenceRef =
  /** T18 原样复用：FSRS 卡片 / 掌握度快照。 */
  | StudyPlanEvidenceRef
  | {
      kind: 'attempt'
      attemptId: string
      questionId: string
      mode: SessionMode
      /** Runner 判定分（只读引用，绝不回写）。 */
      score: number
      maxScore: number
      /** 直指底层 Evidence 原子 —— 审计终点。 */
      evidenceIds: string[]
      createdAt: string
    }
  | {
      kind: 'mistake_cleared'
      questionId: string
      kpIds: string[]
      /** 触发 T07 移出规则的那几次连续 assessment 通过。 */
      attemptIds: string[]
      consecutiveAssessmentPasses: number
      clearedAt: string
    }
  | {
      kind: 'study_day'
      /** YYYY-MM-DD（UTC 自然日）。 */
      date: string
      /** 当日产生 Evidence 的 Attempt —— 「这天确实学了」的物理凭据。 */
      attemptIds: string[]
    }
  | {
      kind: 'plan_task_done'
      /** T18 计划 id（可按 algorithm + 硬事实完整重放）。 */
      planId: string
      algorithm: string
      kpId: string
      /** 完成该任务的 Attempt。 */
      attemptIds: string[]
    }

/**
 * 祝贺文案（建议层，T05 / ADR-0006）。**外挂**在徽章旁边，不参与授予判定。
 * provenance.kind 必须是 'llm_inference'。
 */
export interface AchievementPresentationHint {
  text: string
  provenance: Provenance
}

/**
 * 已获得的徽章。
 *
 * `earnedAt` 取自**触发它的硬事实时间**（Attempt.createdAt），而不是判定
 * 时刻 —— 于是重算幂等：任何时候从同一份 Attempt 历史重算，结果逐字节相同。
 */
export interface StudentAchievement {
  studentId: string
  achievementId: AchievementId
  earnedAt: string
  /** 非空不变量 —— 无硬证据的徽章不允许存在。 */
  evidenceRefs: AchievementEvidenceRef[]
  /** 判定算法版本，可重放。 */
  algorithm: string
  /** 建议层，可缺省。无 LLM 时不影响是否授予。 */
  presentationHint?: AchievementPresentationHint
}

/** 目录条目：克制图标 + 一句话条件（实验报告式精确，不做低幼文案）。 */
export interface AchievementCatalogEntry {
  id: AchievementId
  name: string
  /** 一句话硬条件。学生看到的就是判定逻辑本身，没有隐藏规则。 */
  condition: string
  /** lucide 图标名。克制：线性单色，无奖杯/皇冠/金币。 */
  icon: string
  /** 依赖 T18 当日计划。计划不可用时该成就报 `unavailable` 而非 `locked`。 */
  requiresStudyPlan: boolean
}

/**
 * 固定目录。顺序即展示顺序（稳定，不按「稀有度」排序 —— 没有稀有度）。
 */
export const ACHIEVEMENT_CATALOG: readonly AchievementCatalogEntry[] = [
  {
    id: 'first_evidence_pass',
    name: '首枚证据通过',
    condition: '一次测评（assessment）的全部证据原子均判定为通过。',
    icon: 'ShieldCheck',
    requiresStudyPlan: false
  },
  {
    id: 'repair_plus_20',
    name: '修复闭环',
    condition: `同一道题连续两次测评，后一次比前一次高 ${String(REPAIR_SCORE_DELTA)} 分及以上。`,
    icon: 'Wrench',
    requiresStudyPlan: false
  },
  {
    id: 'weak_kp_cleared',
    name: '薄弱点清除',
    condition: '一道错题按错题本规则（连续测评通过）移出活跃列表。',
    icon: 'CircleCheck',
    requiresStudyPlan: false
  },
  {
    id: 'streak_study_3',
    name: '三日研习',
    condition: `连续 ${String(STREAK_STUDY_DAYS)} 个自然日各有至少一次产生证据的练习或测评。`,
    icon: 'CalendarCheck',
    requiresStudyPlan: false
  },
  {
    id: 'plan_day_done',
    name: '今日计划完成',
    condition: '当日学习计划中的每一项都有当日的作答记录。',
    icon: 'ListChecks',
    requiresStudyPlan: true
  }
] as const

/**
 * 目录进度。
 * - `earned`      已获得
 * - `locked`      条件未达成（`detail` 陈述**硬事实差距**，不做激励话术）
 * - `unavailable` 判定所需的硬输入不可用（如 T18 计划未接线）
 */
export type AchievementProgressStatus = 'earned' | 'locked' | 'unavailable'

export interface AchievementProgress {
  id: AchievementId
  status: AchievementProgressStatus
  /** 只陈述可核对的事实，例如「当前连续研习 2 天（需 3 天）」。 */
  detail: string
}

/** 一次判定的完整结果。`earned` + `progress` 覆盖整个固定目录。 */
export interface AchievementEvaluation {
  studentId: string
  algorithm: string
  /** 判定时刻（= 硬事实快照的 now），审计用。 */
  evaluatedAt: string
  earned: StudentAchievement[]
  progress: AchievementProgress[]
}

// ---------------------------------------------------------------------------
// 硬事实快照 —— 纯函数 `evaluateAchievements` 的唯一输入
// ---------------------------------------------------------------------------

/**
 * Attempt 的**只读投影**。刻意做成扁平快照（而不是传 AttemptStore 句柄），
 * 这样判定内核保持纯函数，且物理上够不到任何写路径。
 */
export interface AchievementAttemptFact {
  attemptId: string
  questionId: string
  /** 题目所属 KP（来自题库，可能为空）。 */
  kpIds: string[]
  mode: SessionMode
  createdAt: string
  status: EvaluationStatus
  /** Runner 判定分（只读）。 */
  score: number
  /** 量规满分（各维度 maxScore 之和）。 */
  maxScore: number
  /** Runner 产出的 Evidence 原子 id。空 = 没有证据 ⇒ 不参与任何授予。 */
  evidenceIds: string[]
  hasFailedEvidence: boolean
  /**
   * 未提交占位（T07 规则：assigned_not_started / practice_not_submitted）。
   * 永不参与任何判定 —— 否则教师布置作业就会凭空点亮学生徽章。
   */
  placeholder: boolean
}

/** 错题本条目的只读投影（T07 移出规则的判定结果，本模块不重新实现规则）。 */
export interface AchievementMistakeFact {
  questionId: string
  kpIds: string[]
  consecutiveAssessmentPasses: number
  /** T07 判定的「已移出活跃」。 */
  mastered: boolean
  lastActiveAt: string
}

/** T18 当日计划的只读投影。缺省 ⇒ `plan_day_done` 报 `unavailable`。 */
export interface AchievementPlanFact {
  planId: string
  algorithm: string
  /** YYYY-MM-DD（UTC 自然日），= 计划 dayIndex 0 的日期。 */
  date: string
  tasks: Array<{
    kpId: string
    questionIds: string[]
    /** T18 的任务锚点，原样带回徽章的自证链。 */
    evidenceRefs: StudyPlanEvidenceRef[]
  }>
}

/**
 * 纯函数 `evaluateAchievements` 的**唯一**输入。
 *
 * 想审计「这枚徽章凭什么给我」，读这个快照即可完整重放。
 */
export interface AchievementHardFacts {
  studentId: string
  /** 全部 Attempt 投影（顺序无关，内核自己做确定性排序）。 */
  attempts: AchievementAttemptFact[]
  mistakes: AchievementMistakeFact[]
  /** T18 未接线时缺省，其余 4 种成就不受影响。 */
  planToday?: AchievementPlanFact
  /** 判定时刻（ISO-8601）。只用于 `evaluatedAt`，不参与授予条件。 */
  now: string
}

// ---------------------------------------------------------------------------
// 投影与不变量断言（服务端 / 前端共用）
// ---------------------------------------------------------------------------

/** 目录查表。未知 id 返回 undefined。 */
export function findAchievementEntry(
  id: AchievementId
): AchievementCatalogEntry | undefined {
  return ACHIEVEMENT_CATALOG.find((entry) => entry.id === id)
}

/**
 * 硬事实不变量断言：每一枚徽章都必须挂着至少一条 evidenceRef。
 * 返回违规徽章的 id 列表（空数组 = 合规）。
 *
 * 任何「把徽章展示给用户」的入口都应先跑一次，非空即拒绝渲染 ——
 * 这是最便宜的「没有证据就没有徽章」闸门。
 */
export function findUnbackedAchievements(
  achievements: readonly StudentAchievement[]
): AchievementId[] {
  return achievements
    .filter((item) => item.evidenceRefs.length === 0)
    .map((item) => item.achievementId)
}

/** 建议层校验：祝贺文案必须是 llm_inference，否则不是合法的调味层。 */
export function isCongratulationHint(
  hint: AchievementPresentationHint | undefined
): boolean {
  return hint?.provenance.kind === 'llm_inference'
}

/** 徽章的证据条数（前端角标用）。 */
export function countAchievementEvidence(
  achievement: StudentAchievement
): number {
  return achievement.evidenceRefs.length
}

/** 把一条锚点渲染成一句可核对的中文说明（前端「凭什么」抽屉用）。 */
export function describeEvidenceRef(ref: AchievementEvidenceRef): string {
  switch (ref.kind) {
    case 'attempt':
      return `作答 ${ref.attemptId}（${ref.mode === 'assessment' ? '测评' : '练习'}，${String(ref.score)}/${String(ref.maxScore)} 分，证据 ${String(ref.evidenceIds.length)} 条）`
    case 'mistake_cleared':
      return `错题 ${ref.questionId} 连续 ${String(ref.consecutiveAssessmentPasses)} 次测评通过后移出活跃`
    case 'study_day':
      return `${ref.date} 有 ${String(ref.attemptIds.length)} 次产生证据的作答`
    case 'plan_task_done':
      return `计划任务 ${ref.kpId} 由 ${String(ref.attemptIds.length)} 次作答完成（${ref.planId}）`
    case 'review_card':
      return `FSRS 复习卡 ${ref.cardId}（${ref.kpId}，到期 ${ref.dueAt}）`
    case 'mastery_snapshot':
      return `掌握度快照 ${ref.kpId} = ${ref.score.toFixed(2)}（证据 ${String(ref.evidenceIds.length)} 条，${ref.algorithmVersion}）`
  }
}

/** 班级聚合视图 —— **只有计数**，没有逐学生明细，也没有排名。 */
export interface AchievementClassSummary {
  teachingUnitId: string
  algorithm: string
  /** 参与统计的在读学生数（分母）。 */
  studentCount: number
  /** 与固定目录等长、同序。 */
  counts: Array<{ achievementId: AchievementId; earnedCount: number }>
}
