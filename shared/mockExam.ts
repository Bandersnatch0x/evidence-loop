/**
 * T16 跨学科模拟考（组卷）共享契约。
 *
 * 独立文件而非扩写 shared/contracts.ts —— 与 T15 (shared/materialImport.ts)、
 * T18 (shared/studyPlan.ts) 同一策略：新增纵向切片只新增文件，便于并行工单合并。
 *
 * 铁律（ADR-0001）边界：
 *   * 本文件不定义、不产生任何 score / evidence —— 组卷只决定「哪些题进卷」，
 *     分数仍然只能由确定性 Runner 在学生作答后产出；
 *   * 报告类型（MockExamPaperReport）是对**已存在**的 Attempt.result 的只读投影，
 *     不新增分数口径、不做二次判分；
 *   * LLM 至多参与 `presentationHint`（建议层，provenance = llm_inference），
 *     它不影响 questionIds / kpCoverage / 任何分数。
 *
 * D2 闸门：只有「有权威答案」的正式题库题可以进卷。T15 的草稿题（draft_questions）
 * 在结构上根本不在题库表里，天然进不来；本文件的 `hasAnswerAuthority` 复用 T15
 * 的 `isAnswerReady` 规则，再叠加 EvidenceSource 权威等级校验，作为第二道闸门。
 */
import type {
  EvidenceSource,
  QuestionType,
  SubjectLanguage
} from './contracts'
import { isAnswerReady } from './materialImport'

/** 组卷算法版本号。同一硬输入 + 同一版本号必得同一份卷。 */
export const MOCK_EXAM_ALGORITHM = 'mockexam.assemble.v1'

/** 交卷报告投影版本号（只聚合，不判分）。 */
export const MOCK_EXAM_REPORT_ALGORITHM = 'mockexam.report.v1'

/** 默认题量 / 时长（教师可在向导里覆盖）。 */
export const DEFAULT_MOCK_EXAM_QUESTION_COUNT = 10
export const DEFAULT_MOCK_EXAM_DURATION_MINUTES = 60

/** 题量上下限，防止教师/前端传出一份 500 题的卷。 */
export const MOCK_EXAM_MIN_QUESTION_COUNT = 1
export const MOCK_EXAM_MAX_QUESTION_COUNT = 60

/** 报告里失败证据 TopN 的 N。 */
export const FAILED_EVIDENCE_TOP_N = 5

export const MOCK_EXAM_GATE_NOTICE =
  '模拟卷只收录「已入库且有权威答案」的正式题目：LLM 生成的草稿题（provenance: ' +
  'llm_inference）必须先经教师逐题校对确认入库才可能被选中；未教知识点（D4）与' +
  '无答案权威的题一律不入卷。组卷过程不产生任何分数与证据。'

// ---------------------------------------------------------------------------
// D2 闸门：可计分题判定
// ---------------------------------------------------------------------------

/**
 * 组卷闸门看的题目最小形状。刻意 duck-typed（不 import server/data 的
 * RunnerSpec），让 shared/ 不依赖 server/。
 */
export interface ScorableQuestionShape {
  questionType: QuestionType
  /** RunnerSpec 形状的答案权威载荷。 */
  payload: unknown
  source: EvidenceSource
  kpIds: string[]
}

/** D2 权威等级：只有这两种来源算「答案权威」。 */
const AUTHORITATIVE_SOURCES: readonly string[] = ['authored_key', 'test_case']

/**
 * 「这道题可以计分吗」—— 组卷唯一的准入判定。
 *
 * 两道闸门同时成立才放行：
 *   1. `source` 是 D2 权威等级（authored_key = 教师写的答案 / test_case = 用例）。
 *      题库行是从 SQLite 强转出来的，脏数据有可能带别的字符串，所以这里做运行时校验。
 *   2. payload 里结构上存在可判定的答案。choice / fill_blank / numeric /
 *      expression / chem_equation 直接复用 T15 的 `isAnswerReady`，前后口径同源；
 *      code / geometry 是 T15 出界、T03 手工录入的类型，在此补齐判定。
 *
 * essay 永远返回 false：主观题没有客观答案权威，只能走 advisory + 教师终裁
 * （T08），不能进「可计分」的模拟卷自动组卷。
 */
export function hasAnswerAuthority(question: ScorableQuestionShape): boolean {
  if (!AUTHORITATIVE_SOURCES.includes(question.source)) return false
  if (question.kpIds.length === 0) return false

  switch (question.questionType) {
    case 'code':
      return hasNonEmptyTestCases(question.payload)
    case 'geometry':
      return hasSectionVertices(question.payload)
    case 'essay':
      return false
    default:
      // 复用 T15 闸门规则（isAnswerReady 只看 questionType + payload）。
      return isAnswerReady({
        stem: '',
        questionType: question.questionType,
        kpIds: question.kpIds,
        difficulty: 0,
        payload: question.payload
      })
  }
}

function hasNonEmptyTestCases(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null) return false
  const record = payload as Record<string, unknown>
  return Array.isArray(record.testCases) && record.testCases.length > 0
}

function hasSectionVertices(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null) return false
  const record = payload as Record<string, unknown>
  return (
    Array.isArray(record.sectionVertexIds) &&
    record.sectionVertexIds.length > 0
  )
}

// ---------------------------------------------------------------------------
// 组卷数据模型
// ---------------------------------------------------------------------------

export type MockExamStatus = 'draft' | 'assigned' | 'archived'

/**
 * 组卷告警码。题量不足等情况不阻断发布（PRD：允许短卷），只如实上报。
 */
export type MockExamWarningCode =
  | 'no_weak_kp'
  | 'no_taught_kp'
  | 'short_paper'
  | 'subject_underfilled'
  | 'unit_not_owned'
  | 'unit_cross_class'
  | 'unit_not_found'
  | 'no_scorable_question'

export interface MockExamWarning {
  code: MockExamWarningCode
  message: string
  subject?: SubjectLanguage
  teachingUnitId?: string
  kpId?: string
}

/** 卷面覆盖到的一个知识点（可追溯到题目自身的学科 / KP 标签）。 */
export interface MockExamKpCoverage {
  kpId: string
  subject: SubjectLanguage
  /** 该 KP 在本卷里出现的题数（同 KP 去重后通常为 1）。 */
  questionCount: number
  /** 该 KP 来自哪个教学单元（追溯 D4 已教集合）。 */
  teachingUnitId: string
}

/** 组卷候选题（服务层从题库投影出来的最小事实，纯函数内核的输入）。 */
export interface MockExamCandidate {
  questionId: string
  subject: SubjectLanguage
  questionType: QuestionType
  kpIds: string[]
  difficulty: number
  source: EvidenceSource
  /** 该题是从哪个教学单元的已教 KP 命中的。 */
  teachingUnitId: string
  /** 排序稳定性用：题库 createdAt。 */
  createdAt: string
}

export interface MockExamPlan {
  id: string
  creatorId: string
  classId: string
  teachingUnitIds: string[]
  title: string
  durationMinutes: number
  /** 有序题号。 */
  questionIds: string[]
  kpCoverage: MockExamKpCoverage[]
  status: MockExamStatus
  createdAt: string
  /** 组卷算法版本，用于重放与审计。 */
  algorithm: string
  /** 发布后回填的 Paper id（T07 场次绑定）。 */
  paperId?: string
  /** 发布后回填的布置时间。 */
  assignedAt?: string
}

/** 卷面里的一道题（教师预览 / 学生入口用，不含答案）。 */
export interface MockExamQuestionView {
  questionId: string
  subject: SubjectLanguage
  questionType: QuestionType
  stem: string
  kpIds: string[]
  difficulty: number
  source: EvidenceSource
  teachingUnitId: string
}

/** 分学科预览分节。单科教师退化为只有一个 section。 */
export interface MockExamSubjectSection {
  subject: SubjectLanguage
  questionIds: string[]
  kpIds: string[]
}

/**
 * 建议层文案。**唯一**允许 LLM 参与的字段，provenance 恒为 llm_inference。
 * 不影响 questionIds / kpCoverage / 任何分数；缺省时前端什么都不显示。
 */
export interface MockExamHint {
  kind: 'llm_inference'
  text: string
  model?: string
}

/** POST /api/teacher/mock-exams/suggest 的响应体（未落库的建议卷）。 */
export interface MockExamSuggestion {
  plan: MockExamPlan
  questions: MockExamQuestionView[]
  sections: MockExamSubjectSection[]
  warnings: MockExamWarning[]
  gateNotice: string
  hint?: MockExamHint
}

/** GET /api/teacher/mock-exams/:id 的响应体。 */
export interface MockExamPlanView {
  plan: MockExamPlan
  questions: MockExamQuestionView[]
  sections: MockExamSubjectSection[]
  gateNotice: string
  /** 发布后的布置结果摘要（学生数 / Attempt 数）。 */
  assignment?: MockExamAssignmentSummary
}

export interface MockExamAssignmentSummary {
  paperId: string
  studentIds: string[]
  attemptCount: number
  mode: 'assessment'
  assignedAt: string
  dueAt?: string
}

// ---------------------------------------------------------------------------
// 交卷报告（对既有 Attempt 的只读投影）
// ---------------------------------------------------------------------------

/** 单个 KP 的诊断口径：只数题，不重新判分。 */
export interface MockExamKpDiagnosis {
  kpId: string
  subject: SubjectLanguage
  /** 涉及该 KP 的题数。 */
  total: number
  /** 其中判定通过（status = passed）的题数。 */
  passed: number
  /** passed / total，保留两位小数。 */
  accuracy: number
}

/** 失败证据引用。字段全部原样来自 EvidenceItem，不做改写。 */
export interface MockExamFailedEvidence {
  questionId: string
  subject: SubjectLanguage
  evidenceId: string
  label: string
  message: string
  expected?: string
  actual?: string
}

/** 分学科报告分节。 */
export interface MockExamSubjectReport {
  subject: SubjectLanguage
  questionCount: number
  /** 已完成（非占位）的题数。 */
  answeredCount: number
  passedCount: number
  /** 已完成题的平均分（0..1，两位小数）；无已完成题时为 0。 */
  averageScore: number
  kpDiagnoses: MockExamKpDiagnosis[]
}

export interface MockExamPaperReport {
  paperId: string
  studentId: string
  planId?: string
  title: string
  /** 恒为 assessment：报告只聚合测评态 Attempt（D1）。 */
  mode: 'assessment'
  generatedAt: string
  algorithm: string
  questionCount: number
  answeredCount: number
  passedCount: number
  averageScore: number
  subjects: MockExamSubjectReport[]
  /** 跨学科共性薄弱：accuracy 最低的 KP，按 accuracy 升序。 */
  commonWeakKps: MockExamKpDiagnosis[]
  failedEvidence: MockExamFailedEvidence[]
  /** 待教师终裁的主观题数（advisory 不进分数，T08）。 */
  pendingTeacherReview: number
  /** 尚未作答的占位题数，前端提示「未交卷」。 */
  notStartedCount: number
}

// ---------------------------------------------------------------------------
// 纯投影 helpers（前后端共用，避免口径漂移）
// ---------------------------------------------------------------------------

/** 卷面涉及的学科，按字典序稳定排序。 */
export function listPlanSubjects(plan: MockExamPlan): SubjectLanguage[] {
  return [...new Set(plan.kpCoverage.map((entry) => entry.subject))].sort(
    (left, right) => left.localeCompare(right)
  )
}

/** 是否跨学科（≥2 个学科）。单科时前端隐藏分科 Tab。 */
export function isInterdisciplinary(plan: MockExamPlan): boolean {
  return listPlanSubjects(plan).length > 1
}

/** 把题目视图按学科分节，学科内保持卷面原顺序。 */
export function groupQuestionsBySubject(
  questions: MockExamQuestionView[]
): MockExamSubjectSection[] {
  const bySubject = new Map<SubjectLanguage, MockExamSubjectSection>()
  for (const question of questions) {
    const section = bySubject.get(question.subject) ?? {
      subject: question.subject,
      questionIds: [],
      kpIds: []
    }
    section.questionIds.push(question.questionId)
    for (const kpId of question.kpIds) {
      if (!section.kpIds.includes(kpId)) section.kpIds.push(kpId)
    }
    bySubject.set(question.subject, section)
  }
  return [...bySubject.values()].sort((left, right) =>
    left.subject.localeCompare(right.subject)
  )
}

/** 两位小数，避免浮点噪声进 JSON。 */
export function roundRatio(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 100) / 100
}
