/**
 * buildPaperReport — 模拟考交卷报告的**只读投影**（T16）。
 *
 * 纯函数：输入是「这份 paper 上该学生的 Attempt 列表」+「题目的学科/KP 标签」，
 * 输出是分科得分 + KP 诊断 + 失败证据 TopN + 跨学科共性薄弱。
 *
 * 铁律边界（ADR-0001）：
 *   * 本函数**不判分**。所有分数原样来自 `attempt.result.score` —— 那是确定性
 *     Runner 早就写好的证据分；这里只做求和取平均；
 *   * 本函数**不写**任何东西，没有 store 句柄；
 *   * 失败证据的 label / message / expected / actual 全部原样透传 EvidenceItem，
 *     不做任何 LLM 改写；
 *   * essay 的 advisory 只统计条数（pendingTeacherReview），永不折进分数（T08）。
 *
 * D1：调用方只传 mode = 'assessment' 的 Attempt，练习态不进正式报告。
 */
import type { Attempt, SubjectLanguage } from '../../shared/contracts'
import type {
  MockExamFailedEvidence,
  MockExamKpDiagnosis,
  MockExamPaperReport,
  MockExamSubjectReport
} from '../../shared/mockExam'
import { FAILED_EVIDENCE_TOP_N, roundRatio } from '../../shared/mockExam'
import { MASTERY_THRESHOLD } from '../config/mastery'

/** 题目的学科 / 知识点标签快照（来自题库，不含答案）。 */
export interface ReportQuestionMeta {
  subject: SubjectLanguage
  kpIds: string[]
}

export interface BuildPaperReportInput {
  paperId: string
  studentId: string
  title: string
  planId?: string
  generatedAt: string
  algorithm: string
  /** 已按 paperId + studentId + mode='assessment' 过滤好的 Attempt。 */
  attempts: Attempt[]
  /** questionId → 学科/KP 标签。缺失的题按 'unknown' 处理并计入总数。 */
  questionMeta: Record<string, ReportQuestionMeta>
}

/** 占位 Attempt 的固定标记（T06/T08 布置时写入）。 */
const NOT_STARTED_REASON = 'assigned_not_started'

interface KpAccumulator {
  kpId: string
  subject: SubjectLanguage
  total: number
  passed: number
}

interface SubjectAccumulator {
  subject: SubjectLanguage
  questionCount: number
  answeredCount: number
  passedCount: number
  scoreSum: number
  kps: Map<string, KpAccumulator>
}

export function buildPaperReport(
  input: BuildPaperReportInput
): MockExamPaperReport {
  const subjects = new Map<SubjectLanguage, SubjectAccumulator>()
  const failed: MockExamFailedEvidence[] = []

  let answeredCount = 0
  let passedCount = 0
  let notStartedCount = 0
  let scoreSum = 0
  let pendingTeacherReview = 0

  // Attempt 顺序不可依赖（存储层按时间倒序），先做稳定排序。
  const ordered = [...input.attempts].sort(
    (left, right) =>
      left.questionId.localeCompare(right.questionId) ||
      left.id.localeCompare(right.id)
  )

  for (const attempt of ordered) {
    const meta = input.questionMeta[attempt.questionId]
    const subject: SubjectLanguage = meta?.subject ?? 'math'
    const kpIds = meta?.kpIds ?? []
    const bucket = ensureSubject(subjects, subject)
    bucket.questionCount += 1

    const result = attempt.result
    const notStarted = result.rejectionReason === NOT_STARTED_REASON
    if (notStarted) {
      notStartedCount += 1
      // 未作答的占位题不进分母，避免「没做」被算成「做错」。
      continue
    }

    const passed = result.status === 'completed'
    answeredCount += 1
    bucket.answeredCount += 1
    scoreSum += result.score
    bucket.scoreSum += result.score
    if (passed) {
      passedCount += 1
      bucket.passedCount += 1
    }

    for (const kpId of kpIds) {
      const kp = ensureKp(bucket, kpId, subject)
      kp.total += 1
      if (passed) kp.passed += 1
    }

    for (const evidence of result.evidence) {
      if (evidence.state === 'passed') continue
      failed.push({
        questionId: attempt.questionId,
        subject,
        evidenceId: evidence.id,
        label: evidence.label,
        message: evidence.message,
        ...(evidence.expected !== undefined
          ? { expected: evidence.expected }
          : {}),
        ...(evidence.actual !== undefined ? { actual: evidence.actual } : {})
      })
    }

    pendingTeacherReview += countPendingAdvisory(result.advisory)
  }

  const subjectReports = [...subjects.values()]
    .map(toSubjectReport)
    .sort((left, right) => left.subject.localeCompare(right.subject))

  return {
    paperId: input.paperId,
    studentId: input.studentId,
    ...(input.planId !== undefined ? { planId: input.planId } : {}),
    title: input.title,
    mode: 'assessment',
    generatedAt: input.generatedAt,
    algorithm: input.algorithm,
    questionCount: ordered.length,
    answeredCount,
    passedCount,
    averageScore: answeredCount === 0 ? 0 : roundRatio(scoreSum / answeredCount),
    subjects: subjectReports,
    commonWeakKps: pickCommonWeakKps(subjectReports),
    failedEvidence: failed.slice(0, FAILED_EVIDENCE_TOP_N),
    pendingTeacherReview,
    notStartedCount
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function ensureSubject(
  subjects: Map<SubjectLanguage, SubjectAccumulator>,
  subject: SubjectLanguage
): SubjectAccumulator {
  const existing = subjects.get(subject)
  if (existing) return existing
  const created: SubjectAccumulator = {
    subject,
    questionCount: 0,
    answeredCount: 0,
    passedCount: 0,
    scoreSum: 0,
    kps: new Map<string, KpAccumulator>()
  }
  subjects.set(subject, created)
  return created
}

function ensureKp(
  bucket: SubjectAccumulator,
  kpId: string,
  subject: SubjectLanguage
): KpAccumulator {
  const existing = bucket.kps.get(kpId)
  if (existing) return existing
  const created: KpAccumulator = { kpId, subject, total: 0, passed: 0 }
  bucket.kps.set(kpId, created)
  return created
}

function toSubjectReport(bucket: SubjectAccumulator): MockExamSubjectReport {
  const kpDiagnoses = [...bucket.kps.values()]
    .map(toKpDiagnosis)
    .sort(
      (left, right) =>
        left.accuracy - right.accuracy || left.kpId.localeCompare(right.kpId)
    )
  return {
    subject: bucket.subject,
    questionCount: bucket.questionCount,
    answeredCount: bucket.answeredCount,
    passedCount: bucket.passedCount,
    averageScore:
      bucket.answeredCount === 0
        ? 0
        : roundRatio(bucket.scoreSum / bucket.answeredCount),
    kpDiagnoses
  }
}

function toKpDiagnosis(kp: KpAccumulator): MockExamKpDiagnosis {
  return {
    kpId: kp.kpId,
    subject: kp.subject,
    total: kp.total,
    passed: kp.passed,
    accuracy: kp.total === 0 ? 0 : roundRatio(kp.passed / kp.total)
  }
}

/**
 * 跨学科共性薄弱：正确率低于掌握阈值的 KP，按正确率升序。与 T06 同一阈值口径，
 * 不新造判定标准。
 */
function pickCommonWeakKps(
  subjects: MockExamSubjectReport[]
): MockExamKpDiagnosis[] {
  return subjects
    .flatMap((section) => section.kpDiagnoses)
    .filter((kp) => kp.total > 0 && kp.accuracy < MASTERY_THRESHOLD)
    .sort(
      (left, right) =>
        left.accuracy - right.accuracy ||
        left.subject.localeCompare(right.subject) ||
        left.kpId.localeCompare(right.kpId)
    )
}

/**
 * 待教师终裁的主观建议条数。requiresTeacherConfirmation 在类型上是字面量 true，
 * 所以这里只是把「存在 advisory」如实计数 —— 它们不进分数。
 */
function countPendingAdvisory(
  advisory: Attempt['result']['advisory']
): number {
  if (!advisory) return 0
  return advisory.filter((item) => item.requiresTeacherConfirmation).length
}
