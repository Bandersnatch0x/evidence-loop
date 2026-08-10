/**
 * PortfolioExportService — T23 作品集导出的编排层。
 *
 * 职责严格限定为三步（与 T18/T19/T20 同款分层）：
 *   1. 通过**只读端口**收集硬事实快照（选题过滤 + 题目元数据挂接）；
 *   2. 入口处做 PII 净化（题干 / 批注 / evidence.actual / expected 命中即隐
 *      去，ADR-0003 不信任上游）；
 *   3. 交给纯函数 `buildPortfolio` 组装，出站再跑 `findUnbackedPortfolioAttempts`
 *      断言（保险丝）。
 *
 * 本类持有的唯一写句柄是 `exports`（自有 portfolio_exports 表）与 `audit`
 * （append-only 审计链）—— 但这两者都在路由层调用；Service 本身**不写任何
 * 表**，导出路径在物理上不可能写 score / evidence / MasteryProfile。
 */
import { findPIIInText } from '../pii/PIIDetector'
import type { Attempt, EvidenceItem } from '../../shared/contracts'
import {
  PORTFOLIO_DEFAULT_QUESTION_TYPES,
  findUnbackedPortfolioAttempts,
  type PortfolioEvidence,
  type PortfolioPackage
} from '../../shared/portfolio'
import { buildPortfolio, type PortfolioAttemptFact } from './buildPortfolio'
import {
  PortfolioUnitMissingError,
  UnbackedPortfolioAttemptError,
  type PortfolioAliasReader,
  type PortfolioAttemptReader,
  type PortfolioOrgReader,
  type PortfolioQuestionReader
} from './ports'

/** 命中 PII 的自由文本字段的替代文案（不丢条目，只隐去敏感正文）。 */
export const REDACTED_PORTFOLIO_TEXT = '（该字段包含隐私信息，已在导出中隐去）'

export interface PortfolioExportServiceOptions {
  attempts: PortfolioAttemptReader
  questions: PortfolioQuestionReader
  org: PortfolioOrgReader
  /** 可选：学名号 / 化名。缺席时 studentAlias 退化为 studentId。 */
  aliases?: PortfolioAliasReader
  now?: () => Date
}

export interface ExportPortfolioOptions {
  /** 显式 Attempt 白名单。提供后跳过默认选题过滤（仍受「无证据不进包」约束）。 */
  attemptIds?: readonly string[]
  /** 默认选题题型。缺省 = PORTFOLIO_DEFAULT_QUESTION_TYPES（assessment + code/essay）。 */
  questionTypes?: readonly string[]
}

/** 是否命中「默认选题口径」：assessment 模式 + 题型在默认集合内 + 已完成的提交。 */
function matchesDefaultFilter(
  attempt: Attempt,
  questionTypes: ReadonlySet<string>,
  questionType: string | undefined
): boolean {
  return (
    attempt.mode === 'assessment' &&
    questionType !== undefined &&
    questionTypes.has(questionType) &&
    attempt.result.status === 'completed'
  )
}

export class PortfolioExportService {
  private readonly attempts: PortfolioAttemptReader
  private readonly questions: PortfolioQuestionReader
  private readonly org: PortfolioOrgReader
  private readonly aliases: PortfolioAliasReader | undefined
  private readonly now: () => Date

  public constructor(options: PortfolioExportServiceOptions) {
    this.attempts = options.attempts
    this.questions = options.questions
    this.org = options.org
    this.aliases = options.aliases
    this.now = options.now ?? (() => new Date())
  }

  /**
   * 聚合一次作品集导出。**纯只读** —— 不写任何表。
   * 同一份 Attempt 历史任何时候重算，同一选题必得同一包（algorithm 可重放）。
   */
  public async exportPortfolio(
    studentId: string,
    teachingUnitId: string,
    options: ExportPortfolioOptions = {}
  ): Promise<PortfolioPackage> {
    const unit = this.org.getTeachingUnit(teachingUnitId)
    if (!unit) throw new PortfolioUnitMissingError(teachingUnitId)

    const rawAttempts = await this.attempts.listAttempts({
      studentId,
      teachingUnitId: unit.id,
      termId: unit.termId
    })

    const explicitIds = options.attemptIds
      ? new Set(options.attemptIds)
      : undefined
    const typeSet = new Set(
      options.questionTypes ??
        (PORTFOLIO_DEFAULT_QUESTION_TYPES as readonly string[])
    )

    const facts: PortfolioAttemptFact[] = rawAttempts.flatMap((attempt) => {
      const question = this.questions.get(attempt.questionId)
      const questionType = question?.questionType
      const selected = explicitIds
        ? explicitIds.has(attempt.id)
        : matchesDefaultFilter(attempt, typeSet, questionType)
      if (!selected) return []
      return [toAttemptFact(attempt, question)]
    })

    const pkg = buildPortfolio({
      studentId,
      studentAlias: this.resolveStudentAlias(studentId),
      teachingUnitId: unit.id,
      attempts: facts,
      now: this.now().toISOString()
    })

    // 保险丝：正常路径上 buildPortfolio 已过滤，这里只防御不变量被破坏。
    const unbacked = findUnbackedPortfolioAttempts(pkg)
    if (unbacked.length > 0) {
      throw new UnbackedPortfolioAttemptError(unbacked[0] ?? '')
    }
    return pkg
  }

  /**
   * 隐私安全别名。上游给的别名也要过一遍 PIIDetector —— 不信任上游，
   * 命中真实姓名/手机/邮箱则退回 studentId（学名号本身是安全标识）。
   */
  private resolveStudentAlias(studentId: string): string {
    const alias = this.aliases?.getDisplayName(studentId)?.trim()
    if (alias === undefined || alias === '') return studentId
    if (findPIIInText('portfolio.studentAlias', alias).length > 0) return studentId
    return alias
  }
}

/** Attempt → 扁平投影。自由文本字段在此净化，PII 面收敛到零。 */
function toAttemptFact(attempt: Attempt, question: ReturnType<PortfolioQuestionReader['get']>): PortfolioAttemptFact {
  const maxScore = attempt.result.dimensions.reduce(
    (sum, dimension) => sum + dimension.maxScore,
    0
  )
  return {
    attemptId: attempt.id,
    questionId: attempt.questionId,
    mode: attempt.mode,
    createdAt: attempt.createdAt,
    status: attempt.result.status,
    score: attempt.result.score,
    maxScore,
    evidence: attempt.result.evidence.map(toPortfolioEvidence),
    ...(attempt.result.teacherAnnotation
      ? {
          teacherAnnotation: {
            ...attempt.result.teacherAnnotation,
            // 批注是教师手写自由文本，可能夹带姓名/联系方式 —— 入站即净化。
            note: redactIfPII(
              'portfolio.teacherAnnotation.note',
              attempt.result.teacherAnnotation.note
            )
          }
        }
      : {}),
    ...(question
      ? {
          question: {
            title: redactIfPII('portfolio.stem', question.stem),
            ...(question.subject ? { subject: question.subject } : {}),
            ...(question.questionType ? { questionType: question.questionType } : {}),
            kpIds: [...question.kpIds]
          }
        }
      : {})
  }
}

function toPortfolioEvidence(item: EvidenceItem): PortfolioEvidence {
  return {
    id: item.id,
    type: item.kind,
    passed: item.state === 'passed',
    weight: item.weight,
    ...(item.actual !== undefined
      ? { actual: redactIfPII('portfolio.evidence.actual', item.actual) }
      : {}),
    ...(item.expected !== undefined
      ? { expected: redactIfPII('portfolio.evidence.expected', item.expected) }
      : {})
  }
}

/** 自由文本命中 PII 即整段隐去（ADR-0003：PII 不进导出物）。 */
function redactIfPII(field: string, value: string): string {
  return findPIIInText(field, value).length > 0 ? REDACTED_PORTFOLIO_TEXT : value
}
