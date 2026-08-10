/**
 * portfolio — 能力证据包 / 作品集导出契约（T23）。
 *
 * 这是一份**独立的**契约文件（不动 shared/contracts.ts），描述证据包导出的
 * 输入（硬事实快照）与输出（PortfolioPackage）。
 *
 * 铁律（ADR-0001 / ADR-0006 / PRD T23）：
 *
 *   1. 作品集里的**每一条** Attempt 都必须挂**非空** evidence —— 顺着它能
 *      回到确定性 Runner 产出的 Evidence 原子（或它的聚合快照）。没有证据
 *      支撑的内容不允许进包：`buildPortfolio` 在构建时过滤，出站再跑一次
 *      `findUnbackedPortfolioAttempts` 可执行断言（非空即拒绝渲染）。
 *   2. 导出是**只读投影**：绝不反向写入 score / evidence / MasteryProfile。
 *      模块的 import 图里没有任何一条边指向评分模块，这条边界是结构性的。
 *   3. 隐私（ADR-0003）：包内只出现 `studentAlias`（学名号/化名）；真实
 *      姓名 / 手机 / 邮箱由服务层在入站前净化（自由文本字段命中 PII 即整段
 *      隐去），包本身不含 summary / rejectionReason / evidence.message 等
 *      自由文本字段，PII 面收敛到零。
 *   4. LLM 辅导对话**默认不打入包**：契约里根本没有辅导对话字段（opt-in
 *      默认关，且当前契约无开关 = 永远不打）。
 *
 * 克制边界（PRD Out of Scope，写进类型而不是写进注释）：
 * `PortfolioPackage` 里**没有**公共作品墙、点赞、一键同步、证书模板字段。
 */
import type {
  EvidenceKind,
  QuestionType,
  SubjectLanguage
} from './contracts'

/** 打包算法版本号 —— 可重放（同一硬事实必得同一包）。 */
export const PORTFOLIO_ALGORITHM = 'portfolio.hard.v1'

/** 量规版本号（封面可追溯用）。与 server/config 的量规口径一致。 */
export const PORTFOLIO_RUBRIC_VERSION = 'rubric.v1'

/**
 * 默认选题题型。ISSUE 写的是「assessment + code/project 题型」；当前
 * QuestionType 尚无 project，essay 覆盖项目式主观题（T08 教师批注挂在这类
 * 提交上）。未来新增 project 题型时在此数组追加即可，路由读这份常量。
 */
export const PORTFOLIO_DEFAULT_QUESTION_TYPES: readonly QuestionType[] = [
  'code',
  'essay'
]

/** 一条导出给第三方的证据原子（PRD 数据草案：id/type/passed/weight/actual?/expected?）。 */
export interface PortfolioEvidence {
  id: string
  /** EvidenceKind 原值（test / static / answer_match …）。 */
  type: EvidenceKind
  /** state === 'passed' 的布尔投影。 */
  passed: boolean
  weight: number
  /** Runner 观察到的实际值（学生提交/程序输出）；命中 PII 已被服务层隐去。 */
  actual?: string
  /** 期望值；命中 PII 已被服务层隐去。 */
  expected?: string
}

/** 题目元数据（PRD：title/subject/questionType/kpIds；补 questionId 便于溯源）。 */
export interface PortfolioQuestionMeta {
  questionId: string
  /** 题干。命中 PII 已被服务层隐去。 */
  title: string
  /** 题目缺失（已被删除）时缺省 —— 诚实缺省，不编造。 */
  subject?: SubjectLanguage
  questionType?: QuestionType
  kpIds: string[]
}

/** 教师批注（T08 teacherAnnotation 的导出投影，provenance=teacher_annotation）。 */
export interface PortfolioTeacherAnnotation {
  score: number
  comment: string
  teacherId: string
  at: string
}

/** 作品集里的一条 Attempt 条目。 */
export interface PortfolioAttempt {
  attemptId: string
  questionMeta: PortfolioQuestionMeta
  /** Runner 判定分（只读引用）。 */
  score: number
  /** 量规满分（Σ dimensions[].maxScore）。 */
  maxScore: number
  /** 非空不变量 —— 无证据原子不允许出现在包里。 */
  evidence: PortfolioEvidence[]
  /**
   * 提交指纹 = sha256(证据 actual 归一化拼接)。刻意不存原文：
   * T01/CodeRunner 只持久化证据的 actual，不存裸提交，因此哈希是对
   * 「Runner 观察到的提交痕迹」的确定性指纹，可与包内 evidence 交叉验证。
   */
  submissionHash: string
  /** 教师最终裁定（若有），独立于自动分，绝不对自动分做任何改写。 */
  teacherAnnotation?: PortfolioTeacherAnnotation
  /** Attempt.createdAt（ISO-8601）。 */
  timestamp: string
}

/** 一份能力证据包。 */
export interface PortfolioPackage {
  meta: {
    /** 隐私安全别名（学名号/化名），**绝不**是真实姓名/手机/邮箱。 */
    studentAlias: string
    teachingUnitId: string
    /** 导出时刻（ISO-8601）。 */
    exportedAt: string
    algorithmVersion: string
    rubricVersion: string
  }
  attempts: PortfolioAttempt[]
}

// ---------------------------------------------------------------------------
// 不变量断言辅助（测试与运行期共用）
// ---------------------------------------------------------------------------

/**
 * 硬事实不变量断言：包里每一条 Attempt 都必须挂至少一条证据原子。
 * 返回违规 attemptId 列表（空数组 = 合规）。
 *
 * 任何「把包交付给用户」的入口都应先跑一次，非空即拒绝交付 ——
 * 「没有证据就不进作品集」在这里响亮地失败，而不是静默放行。
 */
export function findUnbackedPortfolioAttempts(
  pkg: PortfolioPackage
): string[] {
  return pkg.attempts
    .filter((attempt) => attempt.evidence.length === 0)
    .map((attempt) => attempt.attemptId)
}

/** 包内全部证据原子（审计/测试的扁平视图）。 */
export function listPortfolioEvidence(
  pkg: PortfolioPackage
): PortfolioEvidence[] {
  return pkg.attempts.flatMap((attempt) => attempt.evidence)
}

/** 覆盖层是否齐备（学生化名 / 单元 / 导出时间 / 算法与量规版本）。 */
export function hasCompletePortfolioCover(pkg: PortfolioPackage): boolean {
  const meta = pkg.meta
  return (
    meta.studentAlias.trim() !== '' &&
    meta.teachingUnitId.trim() !== '' &&
    meta.exportedAt !== '' &&
    meta.algorithmVersion !== '' &&
    meta.rubricVersion !== ''
  )
}
