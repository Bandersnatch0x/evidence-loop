/**
 * ports — T18 学习计划模块的**只读**依赖端口。
 *
 * 这些接口是结构化（duck-typed）声明，刻意**不 import** server/mastery、
 * server/review、server/runner、server/tutoring 中的任何实体：
 *
 *   - 现成实现（MasteryService / ReviewScheduler / QuestionStore /
 *     InterventionService / SqliteOrgReader）在结构上天然满足它们，
 *     主控接线时直接传进来即可，无需适配器；
 *   - 但 `server/studyPlan/` 的 import 图里没有任何一条边指向评分/辅导模块，
 *     架构守护（plan builder 不 import tutoring generator 写路径）因此
 *     是**结构性**成立的，而不是靠人自觉。
 *
 * 每个端口都只暴露读方法。计划生成路径上不存在任何写句柄。
 */
import type {
  InterventionSuggestion,
  MasteryProfileMap,
  Question,
  ReviewCard,
  TeachingUnit
} from '../../shared/contracts'
import type { StudyPlan } from '../../shared/studyPlan'

/** FSRS 到期卡片读取（ReviewScheduler.listDue 的只读子集）。 */
export interface DueCardReader {
  listDue(studentId: string, now?: Date, limit?: number): ReviewCard[]
}

/** assessment MasteryProfile 读取（MasteryService.getProfile 的只读子集）。 */
export interface StudyPlanMasteryReader {
  getProfile(studentId: string): MasteryProfileMap
}

/** 依赖链诊断（InterventionService.suggestNextIntervention 的只读子集）。 */
export interface DependencyGapReader {
  suggestNextIntervention(
    studentId: string,
    weakKp: string
  ): Promise<InterventionSuggestion>
}

/** 题库候选题读取（QuestionStore.list 的只读子集）。 */
export interface StudyPlanQuestionReader {
  list(query: {
    authorId?: string
    kpIds?: string[]
    limit?: number
  }): Question[]
}

/** 教学单元 / D4 已教进度读取（OrgReader 的只读子集）。 */
export interface StudyPlanOrgReader {
  getTeachingUnit(id: string): TeachingUnit | undefined
  listEnrolledStudentIds(classId: string, termId: string): string[]
}

/**
 * 计划快照持久化端口。**只**读写 study_plan_snapshots 自有表，
 * 与 mastery_scores / review_cards / evaluations 无关。
 */
export interface StudyPlanSnapshotWriter {
  save(plan: StudyPlan): void
  load(studentId: string, teachingUnitId: string): StudyPlan | undefined
}

export class TeachingUnitMissingError extends Error {
  public constructor(id: string) {
    super(`Teaching unit not found: ${id}`)
    this.name = 'TeachingUnitMissingError'
  }
}
