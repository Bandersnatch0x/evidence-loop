/**
 * ports — T16 跨学科模拟考模块的**只读**依赖端口（+ 一个显式布置端口）。
 *
 * 与 T18 (server/studyPlan/ports.ts) 同一手法：这些接口是结构化（duck-typed）
 * 声明，刻意**不 import** server/mastery、server/review、server/runner、
 * server/teacher 中的任何实体。
 *
 *   - 现成实现（SqliteOrgReader / QuestionStore / MasteryService /
 *     AttemptStore / AssignmentService）在结构上天然满足它们，主控接线时
 *     直接传进来即可，无需适配器；
 *   - 但 `server/mockExam/` 的 import 图里没有任何一条边指向评分闭环，
 *     「组卷路径不写分数」因此是**结构性**成立的，而不是靠人自觉。
 *
 * 唯一的写端口是 `MockExamAssignPort`（教师显式布置动作），它转交给 T08
 * 既有的 AssignmentService，产出的是 status=rejected / score=0 的占位
 * Attempt —— 本模块自己不构造 Attempt、不构造 Evidence、不写 score。
 */
import type {
  Attempt,
  CreateAssignmentResult,
  MasteryProfileMap,
  Question,
  SessionMode,
  SubjectLanguage,
  TeachingUnit
} from '../../shared/contracts'
import type { MockExamPlan } from '../../shared/mockExam'

/** 教学单元 / D4 已教进度读取（OrgReader 的只读子集）。 */
export interface MockExamOrgReader {
  getTeachingUnit(id: string): TeachingUnit | undefined
  listEnrolledStudentIds(classId: string, termId: string): string[]
  listTeachingUnitsByTeacher?(teacherId: string): TeachingUnit[]
}

/** 题库候选题读取（QuestionStore.list / get 的只读子集）。 */
export interface MockExamQuestionReader {
  list(query: {
    authorId?: string
    subject?: SubjectLanguage
    kpIds?: string[]
    limit?: number
  }): Question[]
  get(id: string): Question | undefined
}

/** cohort 薄弱 KP 聚合的输入（MasteryService.getProfile 的只读子集）。 */
export interface MockExamMasteryReader {
  getProfile(studentId: string): MasteryProfileMap
}

/** 交卷报告的数据源（AttemptStore.listAttempts 的只读子集）。 */
export interface MockExamAttemptReader {
  listAttempts(filters?: {
    studentId?: string
    questionId?: string
    termId?: string
    teachingUnitId?: string
    mode?: SessionMode
  }): Promise<Attempt[]>
}

/**
 * 布置端口 —— 结构上兼容 T08 `AssignmentService.create`。
 * 声明成端口而不是直接 import，保持 server/mockExam 的 import 图干净。
 */
export interface MockExamAssignPort {
  create(
    input: {
      teachingUnitId: string
      mode: SessionMode
      kind: 'handpick'
      questionIds?: string[]
      studentIds?: string[]
      title?: string
      dueAt?: string
      paperId?: string
      questionTeachingUnitIds?: Record<string, string>
    },
    teacherId: string
  ): Promise<CreateAssignmentResult>
}

/** 卷面持久化端口（只读写 mock_exam_plans 自有表，迁移 0014）。 */
export interface MockExamPlanWriter {
  save(plan: MockExamPlan): void
  get(id: string): MockExamPlan | undefined
  findByPaperId(paperId: string): MockExamPlan | undefined
  listAssigned(): MockExamPlan[]
}

export class MockExamUnitNotFoundError extends Error {
  public constructor(id: string) {
    super(`Teaching unit not found: ${id}`)
    this.name = 'MockExamUnitNotFoundError'
  }
}

export class MockExamForbiddenError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'MockExamForbiddenError'
  }
}

export class MockExamPlanNotFoundError extends Error {
  public constructor(id: string) {
    super(`Mock exam plan not found: ${id}`)
    this.name = 'MockExamPlanNotFoundError'
  }
}

export class MockExamInputError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'MockExamInputError'
  }
}
