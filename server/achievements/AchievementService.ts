/**
 * AchievementService — T20 证据驱动轻激励的编排层。
 *
 * 职责严格限定为三步：
 *   1. 通过**只读端口**收集硬事实快照（AchievementHardFacts）；
 *   2. 交给纯函数 `evaluateAchievements` 判定；
 *   3.（可选）把新获得的徽章写进**自有表** student_achievements。
 *
 * 本类不做任何条件判定 —— 那些全在纯函数里，才能被边界测试锁死。
 * 本类也不持有任何计分写句柄，所以「授予徽章」这条路径在物理上不可能写
 * score / evidence / MasteryProfile（ADR-0001）。成就对掌握度算法零影响。
 *
 * 建议层（祝贺文案）是**事后外挂**：`attachCongratulation` 只往徽章对象上
 * 贴一个字段，evidenceRefs / earnedAt 逐字节不变；provenance 不是
 * `llm_inference` 的一律拒绝。无 LLM 时整条链路照常工作。
 */
import type { Attempt } from '../../shared/contracts'
import {
  ACHIEVEMENT_ALGORITHM,
  type AchievementAttemptFact,
  type AchievementClassSummary,
  type AchievementEvaluation,
  type AchievementHardFacts,
  type AchievementMistakeFact,
  type AchievementPlanFact,
  type AchievementPresentationHint,
  type StudentAchievement
} from '../../shared/achievements'
import { evaluateAchievements } from './evaluateAchievements'
import {
  AchievementUnitMissingError,
  type AchievementAttemptReader,
  type AchievementAwardWriter,
  type AchievementMistakeReader,
  type AchievementOrgReader,
  type AchievementQuestionReader,
  type AchievementStudyPlanReader
} from './ports'

export interface AchievementServiceOptions {
  attempts: AchievementAttemptReader
  questions: AchievementQuestionReader
  mistakes: AchievementMistakeReader
  /** 可选：缺省时 plan_day_done 报 unavailable，其余 4 种不受影响。 */
  studyPlan?: AchievementStudyPlanReader
  /** 可选：缺省时 evaluate 仍可用，只是不持久化（纯投影模式）。 */
  awards?: AchievementAwardWriter
  /** 可选：教师班级聚合视图需要。 */
  org?: AchievementOrgReader
  now?: () => Date
}

export interface EvaluateAchievementsOptions {
  /** 提供后才会拉取 T18 当日计划，判定 plan_day_done。 */
  teachingUnitId?: string
  now?: Date
}

export interface AchievementSyncResult {
  evaluation: AchievementEvaluation
  /** 本次判定新点亮的徽章（前端 toast 用；已存在的不重复提示）。 */
  newlyEarned: StudentAchievement[]
}

/**
 * T07 未提交占位的 rejectionReason。与 server/student/MistakeBookService 的
 * 同名常量保持一致 —— 刻意在此重新声明而不是 import，以保持 achievements
 * 模块的 import 图干净（端口是 duck-typed 的，不绑定具体实现）。
 */
const PLACEHOLDER_REJECTION_REASONS = new Set([
  'assigned_not_started',
  'practice_not_submitted'
])

export class AchievementService {
  private readonly attempts: AchievementAttemptReader
  private readonly questions: AchievementQuestionReader
  private readonly mistakes: AchievementMistakeReader
  private readonly studyPlan: AchievementStudyPlanReader | undefined
  private readonly awards: AchievementAwardWriter | undefined
  private readonly org: AchievementOrgReader | undefined
  private readonly now: () => Date

  public constructor(options: AchievementServiceOptions) {
    this.attempts = options.attempts
    this.questions = options.questions
    this.mistakes = options.mistakes
    this.studyPlan = options.studyPlan
    this.awards = options.awards
    this.org = options.org
    this.now = options.now ?? (() => new Date())
  }

  /**
   * 判定成就。**纯只读** —— 不写任何表（包括自有表）。
   * 同一份 Attempt 历史任何时候重算，结果逐字节相同。
   */
  public async evaluate(
    studentId: string,
    options: EvaluateAchievementsOptions = {}
  ): Promise<AchievementEvaluation> {
    const facts = await this.collectHardFacts(studentId, options)
    return evaluateAchievements(facts)
  }

  /**
   * 收集硬事实快照。**唯一**的数据入口 —— 想审计「这枚徽章凭什么给我」，
   * 读这个方法的返回值即可完整重放。
   */
  public async collectHardFacts(
    studentId: string,
    options: EvaluateAchievementsOptions = {}
  ): Promise<AchievementHardFacts> {
    const now = options.now ?? this.now()
    // When a teaching unit is in scope (class summary / unit-scoped wall), only
    // count attempts from that unit so badges cannot leak across classes.
    const rawAttempts = await this.attempts.listAttempts({
      studentId,
      ...(options.teachingUnitId
        ? { teachingUnitId: options.teachingUnitId }
        : {})
    })
    const attempts = rawAttempts.map((attempt) => this.toAttemptFact(attempt))
    const mistakes = await this.collectMistakeFacts(studentId)
    const planToday = await this.collectPlanFact(
      studentId,
      options.teachingUnitId
    )

    return {
      studentId,
      attempts,
      mistakes,
      ...(planToday ? { planToday } : {}),
      now: now.toISOString()
    }
  }

  /**
   * 判定 + 把新徽章写进自有表。这是「评估成功路径写 Attempt 后」的钩子入口
   * （同步、简单、幂等）。
   *
   * 幂等性由两层保证：判定本身确定性 + `save` 首次授予即定格（已存在不覆盖）。
   * 因此重复调用不会刷出重复 toast，也不会改写 earnedAt。
   */
  public async sync(
    studentId: string,
    options: EvaluateAchievementsOptions = {}
  ): Promise<AchievementSyncResult> {
    const evaluation = await this.evaluate(studentId, options)
    if (!this.awards) return { evaluation, newlyEarned: [] }

    const known = new Set(
      this.awards.list(studentId).map((item) => item.achievementId)
    )
    const newlyEarned: StudentAchievement[] = []
    for (const achievement of evaluation.earned) {
      if (known.has(achievement.achievementId)) continue
      this.awards.save(achievement)
      newlyEarned.push(achievement)
    }
    return { evaluation, newlyEarned }
  }

  /**
   * 班级聚合计数。**只有分子分母，没有逐学生明细，也没有排名** ——
   * 返回类型 `AchievementClassSummary` 里根本没有存放学生 id 的地方
   * （PRD 反社交 PK 边界在类型层面就成立）。
   */
  public async classSummary(
    teachingUnitId: string
  ): Promise<AchievementClassSummary> {
    if (!this.org) {
      throw new AchievementUnitMissingError(teachingUnitId)
    }
    const unit = this.org.getTeachingUnit(teachingUnitId)
    if (!unit) throw new AchievementUnitMissingError(teachingUnitId)

    const studentIds = this.org.listEnrolledStudentIds(unit.classId, unit.termId)
    const tally = new Map<string, number>()
    for (const studentId of studentIds) {
      const evaluation = await this.evaluate(studentId, { teachingUnitId })
      for (const achievement of evaluation.earned) {
        tally.set(
          achievement.achievementId,
          (tally.get(achievement.achievementId) ?? 0) + 1
        )
      }
    }

    return {
      teachingUnitId,
      algorithm: ACHIEVEMENT_ALGORITHM,
      studentCount: studentIds.length,
      counts: [...tally.entries()]
        .map(([achievementId, earnedCount]) => ({
          achievementId: achievementId as AchievementClassSummary['counts'][number]['achievementId'],
          earnedCount
        }))
        .sort((a, b) => a.achievementId.localeCompare(b.achievementId))
    }
  }

  // -------------------------------------------------------------------------
  // 私有：硬事实投影
  // -------------------------------------------------------------------------

  /**
   * Attempt → 扁平只读投影。这里是整个模块唯一接触 EvaluationResult 的地方，
   * 且只**读**其中的 score / evidence 用作锚点，从不回写。
   */
  private toAttemptFact(attempt: Attempt): AchievementAttemptFact {
    const result = attempt.result
    const maxScore = result.dimensions.reduce(
      (sum, dimension) => sum + dimension.maxScore,
      0
    )
    return {
      attemptId: attempt.id,
      questionId: attempt.questionId,
      kpIds: this.questions.get(attempt.questionId)?.kpIds ?? [],
      mode: attempt.mode,
      createdAt: attempt.createdAt,
      status: result.status,
      score: result.score,
      maxScore,
      evidenceIds: result.evidence.map((item) => item.id),
      hasFailedEvidence: result.evidence.some((item) => item.state === 'failed'),
      placeholder:
        result.status === 'rejected' &&
        result.rejectionReason !== undefined &&
        PLACEHOLDER_REJECTION_REASONS.has(result.rejectionReason)
    }
  }

  private async collectMistakeFacts(
    studentId: string
  ): Promise<AchievementMistakeFact[]> {
    const view = await this.mistakes.view(studentId)
    return view.entries.map((entry) => ({
      questionId: entry.questionId,
      kpIds: [...entry.kpIds],
      consecutiveAssessmentPasses: entry.consecutiveAssessmentPasses,
      mastered: entry.mastered,
      lastActiveAt: entry.lastActiveAt
    }))
  }

  /**
   * T18 当日计划投影。
   *
   * 计划不可用（端口缺省 / 未提供 unitId / 生成抛错，例如教学单元不存在）时
   * 返回 undefined —— `plan_day_done` 随之报 `unavailable`。这是 ISSUE-T20
   * 明确的降级路径：T18 未上线不得拖垮另外 4 种成就。
   */
  private async collectPlanFact(
    studentId: string,
    teachingUnitId: string | undefined
  ): Promise<AchievementPlanFact | undefined> {
    if (!this.studyPlan || teachingUnitId === undefined) return undefined
    let plan
    try {
      plan = await this.studyPlan.generate(studentId, teachingUnitId)
    } catch {
      return undefined
    }
    const today = plan.days.find((day) => day.dayIndex === 0)
    if (!today) return undefined
    return {
      planId: plan.id,
      algorithm: plan.algorithm,
      date: today.date,
      tasks: today.tasks.map((task) => ({
        kpId: task.kpId,
        questionIds: [...task.questionIds],
        evidenceRefs: [...task.evidenceRefs]
      }))
    }
  }
}

/**
 * 把祝贺文案贴到徽章上。**纯函数**：返回新对象，`evidenceRefs` 引用原样
 * 透传，所以「凭什么授予」不可能被文案改写。provenance 非 llm_inference
 * 一律拒绝（ADR-0006：LLM 产物必须自证来源）。
 *
 * 注意这个函数**只在展示阶段调用** —— 它拿到的徽章已经被授予了。文案不能
 * 让一枚未获得的徽章变成已获得，因为它根本不产出 StudentAchievement。
 */
export function attachCongratulation(
  achievement: StudentAchievement,
  hint: AchievementPresentationHint | undefined
): StudentAchievement {
  if (!hint || hint.provenance.kind !== 'llm_inference') return achievement
  if (hint.text.trim() === '') return achievement
  return { ...achievement, presentationHint: hint }
}
