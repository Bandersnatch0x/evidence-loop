/**
 * ports — T20 成就模块的**只读**依赖端口（T18 ports.ts 的同款做法）。
 *
 * 这些接口是结构化（duck-typed）声明，刻意**不 import** server/mastery、
 * server/review、server/runner、server/tutoring 中的任何实体：
 *
 *   - 现成实现（JsonAttemptStore / QuestionStore / MistakeBookService /
 *     StudyPlanService / SqliteOrgReader）在结构上天然满足它们，主控接线时
 *     直接传进来即可，无需适配器；
 *   - 但 `server/achievements/` 的 import 图里没有任何一条边指向评分模块，
 *     「成就不写 score」因此是**结构性**成立的，而不是靠人自觉。
 *
 * 除 `AchievementAwardWriter`（只写自有表 student_achievements）之外，
 * 每个端口都只暴露读方法。授予路径上不存在任何计分写句柄。
 */
import type { Attempt, Question, TeachingUnit } from '../../shared/contracts'
import type { StudyPlan } from '../../shared/studyPlan'
import type {
  AchievementId,
  StudentAchievement
} from '../../shared/achievements'

/** Attempt 历史读取（AttemptStore.listAttempts 的只读子集）。 */
export interface AchievementAttemptReader {
  listAttempts(filters?: {
    studentId?: string
    questionId?: string
    termId?: string
    teachingUnitId?: string
  }): Promise<Attempt[]>
}

/** 题目 KP 读取（QuestionStore.get 的只读子集）。 */
export interface AchievementQuestionReader {
  get(id: string): Question | undefined
}

/**
 * 错题本读取（MistakeBookService.view 的只读子集）。
 * T20 直接消费 T07 判定好的 `mastered`，不重新实现移出规则。
 */
export interface AchievementMistakeReader {
  view(studentId: string): Promise<{
    entries: Array<{
      questionId: string
      kpIds: string[]
      consecutiveAssessmentPasses: number
      mastered: boolean
      lastActiveAt: string
    }>
  }>
}

/**
 * T18 学习计划读取（StudyPlanService.generate 的只读子集）。
 *
 * **可选**端口：缺省或抛错时 `plan_day_done` 报 `unavailable`，其余 4 种
 * 成就完全不受影响（ISSUE-T20 "Blocked by T18" 的降级约定）。
 */
export interface AchievementStudyPlanReader {
  generate(studentId: string, teachingUnitId: string): Promise<StudyPlan>
}

/** 教学单元 / 在读名单读取（OrgReader 的只读子集），教师聚合视图用。 */
export interface AchievementOrgReader {
  getTeachingUnit(id: string): TeachingUnit | undefined
  listEnrolledStudentIds(classId: string, termId: string): string[]
}

/**
 * 徽章持久化端口。**只**读写 student_achievements 自有表，
 * 与 mastery_scores / review_cards / evaluations 无关。
 *
 * `save` 语义是「首次授予即定格」：已存在的行不覆盖，所以 earnedAt 不会
 * 被后续重算改写（幂等）。
 */
export interface AchievementAwardWriter {
  save(achievement: StudentAchievement): void
  list(studentId: string): StudentAchievement[]
  countByStudents(
    studentIds: readonly string[]
  ): Array<{ achievementId: AchievementId; earnedCount: number }>
}

/** 教师聚合视图请求了不存在的教学单元。 */
export class AchievementUnitMissingError extends Error {
  public constructor(id: string) {
    super(`Teaching unit not found: ${id}`)
    this.name = 'AchievementUnitMissingError'
  }
}

/**
 * 试图持久化一枚没有硬证据的徽章 —— 这是铁律违规，必须响亮地失败，
 * 而不是静默写库。正常路径上 `evaluateAchievements` 永不产出这种徽章。
 */
export class UnbackedAchievementError extends Error {
  public constructor(achievementId: string) {
    super(
      `Refusing to persist achievement without evidence: ${achievementId}（没有证据就没有徽章）`
    )
    this.name = 'UnbackedAchievementError'
  }
}
