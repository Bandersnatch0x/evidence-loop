/**
 * buildPortfolio — T23 作品集导出的纯函数内核（硬事实快照 → PortfolioPackage）。
 *
 * 三条硬规则（与 T18/T19/T20 内核同款风格）：
 *   1. **无证据不进包**：evidence 为空数组的 Attempt 直接过滤，不产出条目；
 *   2. **确定性**：同一硬事实快照任何时候重算，输出逐字节相同（排序稳定、
 *      submissionHash 由证据内容确定）；
 *   3. **只读投影**：本函数不持有任何 db / store 句柄，物理上够不到写路径。
 *
 * 输入刻意做成扁平快照（PortfolioHardFacts），服务层已做过：
 *   - 默认选题过滤（assessment + code/essay）；
 *   - PII 净化（题干 / 批注 / evidence.actual / expected 命中即隐去）；
 *   - 题目元数据挂接。
 * 因此这里只做「投影 + 排序 + 哈希」，不再触碰任何自由文本。
 */
import { createHash } from 'node:crypto'
import type {
  QuestionType,
  SessionMode,
  SubjectLanguage,
  TeacherAnnotation
} from '../../shared/contracts'
import {
  PORTFOLIO_ALGORITHM,
  PORTFOLIO_RUBRIC_VERSION,
  type PortfolioAttempt,
  type PortfolioEvidence,
  type PortfolioPackage
} from '../../shared/portfolio'

/** 一次提交的扁平投影（服务层收集，含 PII 净化后的证据）。 */
export interface PortfolioAttemptFact {
  attemptId: string
  questionId: string
  mode: SessionMode
  createdAt: string
  /** 'completed' | 'rejected' | 'failed' 原值，服务层已按默认口径过滤。 */
  status: string
  score: number
  maxScore: number
  /** 服务层已映射为导出形状并净化；空数组 = 无证据，不进包。 */
  evidence: PortfolioEvidence[]
  teacherAnnotation?: TeacherAnnotation
  question?: {
    title: string
    subject?: SubjectLanguage
    questionType?: QuestionType
    kpIds: string[]
  }
}

/** 纯函数 `buildPortfolio` 的**唯一**输入。 */
export interface PortfolioHardFacts {
  studentId: string
  /** 隐私安全别名（学名号/化名）。 */
  studentAlias: string
  teachingUnitId: string
  attempts: PortfolioAttemptFact[]
  /** 导出时刻（ISO-8601），决定 meta.exportedAt。 */
  now: string
}

/** 硬事实快照 → 作品集包。 */
export function buildPortfolio(facts: PortfolioHardFacts): PortfolioPackage {
  const attempts = facts.attempts
    .filter((fact) => fact.evidence.length > 0)
    .sort(compareAttempts)
    .map(toPortfolioAttempt)

  return {
    meta: {
      studentAlias: facts.studentAlias,
      teachingUnitId: facts.teachingUnitId,
      exportedAt: facts.now,
      algorithmVersion: PORTFOLIO_ALGORITHM,
      rubricVersion: PORTFOLIO_RUBRIC_VERSION
    },
    attempts
  }
}

/** 排序稳定且可复现：先按时间，再按 attemptId 决胜负。 */
function compareAttempts(
  left: PortfolioAttemptFact,
  right: PortfolioAttemptFact
): number {
  const byTime = left.createdAt.localeCompare(right.createdAt)
  return byTime !== 0 ? byTime : left.attemptId.localeCompare(right.attemptId)
}

function toPortfolioAttempt(fact: PortfolioAttemptFact): PortfolioAttempt {
  const questionType = fact.question?.questionType
  return {
    attemptId: fact.attemptId,
    questionMeta: {
      questionId: fact.questionId,
      title: fact.question?.title ?? '（题目元数据缺失）',
      // 题目缺失时诚实缺省 —— 不编造 subject / questionType。
      ...(fact.question?.subject ? { subject: fact.question.subject } : {}),
      ...(questionType ? { questionType } : {}),
      kpIds: fact.question?.kpIds ?? []
    },
    score: fact.score,
    maxScore: fact.maxScore,
    evidence: fact.evidence.map(toEvidence),
    submissionHash: hashSubmission(fact.evidence),
    ...(fact.teacherAnnotation
      ? { teacherAnnotation: toAnnotation(fact.teacherAnnotation) }
      : {}),
    timestamp: fact.createdAt
  }
}

function toEvidence(item: PortfolioEvidence): PortfolioEvidence {
  return {
    id: item.id,
    type: item.type,
    passed: item.passed,
    weight: item.weight,
    ...(item.actual !== undefined ? { actual: item.actual } : {}),
    ...(item.expected !== undefined ? { expected: item.expected } : {})
  }
}

function toAnnotation(
  annotation: TeacherAnnotation
): PortfolioAttempt['teacherAnnotation'] {
  return {
    score: annotation.subjectiveScore,
    comment: annotation.note,
    teacherId: annotation.teacherId,
    at: annotation.adjudicatedAt
  }
}

/**
 * 提交指纹。与 T08 `SubjectiveGradingService.toQueueItem` 的提交文本口径一致
 * （evidence actual 非空值拼接），再做 sha256 —— 两份包可交叉验证同一提交。
 */
export function submissionText(evidence: readonly PortfolioEvidence[]): string {
  return evidence
    .map((item) => item.actual ?? '')
    .filter((text) => text !== '')
    .join('\n\n')
}

/** 确定性哈希：同一证据集必得同一指纹。 */
export function hashSubmission(
  evidence: readonly PortfolioEvidence[]
): string {
  return createHash('sha256').update(submissionText(evidence), 'utf8').digest('hex')
}
