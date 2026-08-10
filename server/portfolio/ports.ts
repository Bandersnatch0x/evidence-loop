/**
 * ports — T23 作品集导出模块的**只读**依赖端口（+ 一个自有写端口）。
 *
 * 与 T18/T19/T20 同款设计：结构化（duck-typed）声明，刻意**不 import**
 * server/mastery、server/review、server/runner、server/tutoring 中的任何
 * 实体：
 *
 *   - 现成实现（JsonAttemptStore / QuestionStore / SqliteOrgReader /
 *     AuthService 的别名查询）在结构上天然满足它们，主控接线时直接传进来，
 *     无需适配器；
 *   - 但 `server/portfolio/` 的 import 图里没有任何一条边指向评分/辅导模块，
 *     「导出不写分」因此是**结构性**成立的，而不是靠人自觉。
 *
 * 唯二的写端口是 `PortfolioExportRecorder`（只写自有 portfolio_exports 表，
 * 迁移 0019）与 `PortfolioAuditSink`（只 append 审计链）。二者都与
 * mastery_scores / review_cards / evaluations 无任何关系。
 */
import type {
  Attempt,
  Question,
  SessionMode,
  TeachingUnit
} from '../../shared/contracts'

/** Attempt 历史读取（AttemptStore.listAttempts 的只读子集）。 */
export interface PortfolioAttemptReader {
  listAttempts(filters?: {
    studentId?: string
    questionId?: string
    termId?: string
    teachingUnitId?: string
    mode?: SessionMode
  }): Promise<Attempt[]>
}

/** 题目元数据读取（QuestionStore.get 的只读子集）。 */
export interface PortfolioQuestionReader {
  get(id: string): Question | undefined
}

/** 教学单元 / 在读名单读取（OrgReader 的只读子集）。 */
export interface PortfolioOrgReader {
  getTeachingUnit(id: string): TeachingUnit | undefined
  listEnrolledStudentIds(classId: string, termId: string): string[]
}

/** 隐私别名读取。返回学名号/化名；返回 undefined 时退化为 studentId。 */
export interface PortfolioAliasReader {
  getDisplayName(studentId: string): string | undefined
}

/** 一次导出的落库记录（自有表 portfolio_exports，迁移 0019）。 */
export interface PortfolioExportEntry {
  id: string
  /** 确定性包 id：portfolio_<studentId>_<unitId>_<ISO 时间戳>。 */
  packageId: string
  studentId: string
  teachingUnitId: string
  actorId: string
  actorRole: string
  attemptCount: number
  algorithm: string
  rubricVersion: string
  exportedAt: string
}

/** 导出记录写入端口（只 touch 自有表）。 */
export interface PortfolioExportRecorder {
  record(entry: PortfolioExportEntry): void
  list(query: {
    studentId?: string
    teachingUnitId?: string
    limit?: number
  }): PortfolioExportEntry[]
}

/**
 * 审计 sink —— 结构上兼容 `AuditStore.enqueue`。
 * 只 append 审计链，metadata 一律为标量（绝不塞包正文，防 PII 二次落库）。
 */
export interface PortfolioAuditSink {
  enqueue(event: {
    actorRole: string
    actorId?: string
    action: 'export' | 'view'
    resourceType: 'portfolio' | 'evaluation' | 'system'
    resourceId?: string
    studentId?: string
    result?: string
    metadata?: Record<string, string | number | boolean | null>
  }): void
}

/** 教学单元不存在（服务层用它向路由抛 404）。 */
export class PortfolioUnitMissingError extends Error {
  public constructor(id: string) {
    super(`Teaching unit not found: ${id}`)
    this.name = 'PortfolioUnitMissingError'
  }
}

/**
 * 包里出现没有证据支撑的 Attempt —— 铁律违规，必须响亮地失败。
 * 正常路径上 `buildPortfolio` 已过滤，所以这一行是「不变量被破坏时立刻
 * 亮红灯」的保险丝。
 */
export class UnbackedPortfolioAttemptError extends Error {
  public constructor(attemptId: string) {
    super(
      `Refusing to deliver portfolio attempt without evidence: ${attemptId}（没有证据就不进作品集）`
    )
    this.name = 'UnbackedPortfolioAttemptError'
  }
}
