/**
 * ports — T19 学情周报模块的**只读**依赖端口（+ 两个自有写端口）。
 *
 * 与 T18 `server/studyPlan/ports.ts` 同款设计：结构化（duck-typed）声明，
 * 刻意**不 import** server/mastery、server/review、server/runner、
 * server/tutoring、server/studyPlan 中的任何实现：
 *
 *   - 现成实现（JsonAttemptStore / MasteryService / MistakeBookService /
 *     TeacherTipService / SqliteOrgReader / StudyPlanService / AuditStore）
 *     在结构上天然满足它们，主控接线时直接传进来即可，无需适配器；
 *   - 但 `server/reports/` 的 import 图里没有任何一条边指向评分/辅导模块，
 *     「周报不写分」因此是**结构性**成立的，而不是靠人自觉。
 *
 * 唯二的写端口是 `WeeklyReportExportRecorder`（只写自有 weekly_report_exports
 * 表）与 `WeeklyReportAuditSink`（只 append 审计链）。二者都与
 * mastery_scores / review_cards / evaluations 无任何关系。
 */
import type {
  Attempt,
  MasteryProfileMap,
  MistakeBookView,
  SessionMode,
  TeacherTip,
  TeachingUnit
} from '../../shared/contracts'
import type { StudyPlan } from '../../shared/studyPlan'

/** Attempt 读取（AttemptStore.listAttempts 的只读子集）。 */
export interface WeeklyReportAttemptReader {
  listAttempts(filters?: {
    studentId?: string
    questionId?: string
    termId?: string
    teachingUnitId?: string
    mode?: SessionMode
  }): Promise<Attempt[]>
}

/** assessment MasteryProfile 读取（MasteryService.getProfile 的只读子集）。 */
export interface WeeklyReportMasteryReader {
  getProfile(studentId: string): MasteryProfileMap
}

/** 错题本读取（MistakeBookService.view 的只读子集）。 */
export interface WeeklyReportMistakeReader {
  view(studentId: string): Promise<MistakeBookView>
}

/** 教师提示读取（TeacherTipService.listForStudent 的只读子集）。 */
export interface WeeklyReportTipReader {
  listForStudent(studentId: string): TeacherTip[]
}

/** 教学单元 / D4 已教进度读取（OrgReader 的只读子集）。 */
export interface WeeklyReportOrgReader {
  getTeachingUnit(id: string): TeachingUnit | undefined
  listEnrolledStudentIds(classId: string, termId: string): string[]
}

/**
 * 下周计划读取 —— 结构上兼容 T18 `StudyPlanService.generate`。
 *
 * 声明成端口而不是 `import { StudyPlanService }`：
 *   1. T18 的 ApiContext 接线尚未完成，端口让本模块先跑起来；
 *   2. 计划缺席（端口未注入 / 抛错）时报告降级为「下周建议证据不足」，
 *      而不是整份报告 500。
 */
export interface WeeklyReportPlanReader {
  generate(studentId: string, teachingUnitId: string): Promise<StudyPlan>
}

/**
 * 隐私别名读取。返回学名号/化名；返回 undefined 时报告退化为 studentId。
 * 无论上游给什么，Service 都会再过一遍 PIIDetector（不信任上游）。
 */
export interface WeeklyReportAliasReader {
  getDisplayName(studentId: string): string | undefined
}

/** 一次导出的落库记录（自有表 weekly_report_exports，迁移 0015）。 */
export interface WeeklyReportExportEntry {
  id: string
  reportId: string
  studentId: string
  teachingUnitId: string
  actorId: string
  actorRole: string
  format: 'json' | 'html'
  windowFrom: string
  windowTo: string
  algorithm: string
  status: string
  exportedAt: string
}

/** 导出记录写入端口（只 touch 自有表）。 */
export interface WeeklyReportExportRecorder {
  record(entry: WeeklyReportExportEntry): void
  list(query: {
    studentId?: string
    teachingUnitId?: string
    limit?: number
  }): WeeklyReportExportEntry[]
}

/**
 * 审计 sink —— 结构上兼容 `AuditStore.enqueue`。
 * 只 append 审计链，metadata 一律为标量（绝不塞报告正文，防 PII 二次落库）。
 */
export interface WeeklyReportAuditSink {
  enqueue(event: {
    actorRole: string
    actorId?: string
    action: 'export' | 'view' | 'report'
    resourceType: 'evaluation' | 'cohort' | 'system'
    resourceId?: string
    studentId?: string
    result?: string
    metadata?: Record<string, string | number | boolean | null>
  }): void
}

export class WeeklyReportUnitMissingError extends Error {
  public constructor(id: string) {
    super(`Teaching unit not found: ${id}`)
    this.name = 'WeeklyReportUnitMissingError'
  }
}

export class WeeklyReportWindowError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'WeeklyReportWindowError'
  }
}
