/**
 * MockExamService — T16 跨学科模拟考的编排层。
 *
 * 职责：把「教师选了哪些教学单元」翻译成一份硬事实快照，交给确定性纯函数
 * `assembleMockExam` 组卷；教师确认后落库、并把布置动作**转交**给 T08 既有的
 * AssignmentService（产出 status=rejected / score=0 的占位 Attempt）。
 *
 * 三道闸门都在这一层强制，且 suggest 与 save 走**同一份**闸门代码，
 * 教师在前端改过的题号列表回到服务端会被重新校验一遍：
 *
 *   D2 答案权威：`hasAnswerAuthority()` —— 复用 T15 的 isAnswerReady 规则。
 *                T15 的草稿题存在独立的 draft_questions 表，QuestionStore
 *                根本读不到它们，所以「未校对草稿题进卷」在结构上就不可能；
 *                这里再叠加一次 source/payload 校验，防止脏数据绕过。
 *   D4 已教进度：题目 kpIds 必须命中所选教学单元的 taughtKpIds 并集。
 *   跨单元权限：教学单元必须属于本教师、且同属一个行政班。
 *
 * 铁律边界（ADR-0001）：本文件不 import 任何 runner / mastery 写路径 / review /
 * evaluation 写接口。依赖全部是 ports.ts 里的只读端口，唯一的写动作是
 * `plans.save()`（自有表）与转交给 assign 端口的教师显式布置。
 */
import { createHash, randomUUID } from 'node:crypto'
import type { Question } from '../../shared/contracts'
import type {
  MockExamCandidate,
  MockExamKpCoverage,
  MockExamPaperReport,
  MockExamPaperSubmitResult,
  MockExamPlan,
  MockExamPlanView,
  MockExamQuestionView,
  MockExamSubjectSection,
  MockExamSuggestion,
  MockExamWarning
} from '../../shared/mockExam'
import {
  DEFAULT_MOCK_EXAM_DURATION_MINUTES,
  DEFAULT_MOCK_EXAM_QUESTION_COUNT,
  MOCK_EXAM_GATE_NOTICE,
  MOCK_EXAM_REPORT_ALGORITHM,
  groupQuestionsBySubject,
  hasAnswerAuthority
} from '../../shared/mockExam'
import { MASTERY_THRESHOLD } from '../config/mastery'
import { assembleMockExam } from './assembleMockExam'
import {
  buildPaperReport,
  type ReportQuestionMeta
} from './buildPaperReport'
import {
  MockExamForbiddenError,
  MockExamInputError,
  MockExamPlanNotFoundError,
  MockExamUnitNotFoundError,
  type MockExamAssignPort,
  type MockExamAttemptReader,
  type MockExamMasteryReader,
  type MockExamOrgReader,
  type MockExamPlanWriter,
  type MockExamQuestionReader
} from './ports'

export interface MockExamServiceOptions {
  org: MockExamOrgReader
  questions: MockExamQuestionReader
  mastery: MockExamMasteryReader
  plans: MockExamPlanWriter
  /** 可选：提供后可排除「最近 N 天已在测评里做过」的题。 */
  attempts?: MockExamAttemptReader
  /** 可选：缺省时 publish 会抛 501 语义错误（草稿仍可保存）。 */
  assign?: MockExamAssignPort
  now?: () => Date
  newId?: () => string
  /** 低于该掌握度算薄弱，默认与 T06 同口径。 */
  masteryThreshold?: number
  /** >0 时排除近 N 天做过的题（PRD 组卷算法第 3 步）。默认 0 = 不排除。 */
  excludeRecentDays?: number
}

export interface SuggestMockExamInput {
  teacherId: string
  teachingUnitIds: string[]
  classId?: string
  questionCount?: number
  durationMinutes?: number
  title?: string
}

export interface SaveMockExamInput {
  teacherId: string
  teachingUnitIds: string[]
  questionIds: string[]
  planId?: string
  classId?: string
  title?: string
  durationMinutes?: number
  /** true = 保存并一键布置全班（或指定 enrollment）。 */
  publish?: boolean
  studentIds?: string[]
  dueAt?: string
}

export interface SaveMockExamResult {
  plan: MockExamPlan
  questions: MockExamQuestionView[]
  sections: MockExamSubjectSection[]
  warnings: MockExamWarning[]
  gateNotice: string
  assignment?: {
    paperId: string
    studentIds: string[]
    attemptCount: number
    mode: 'assessment'
    assignedAt: string
    dueAt?: string
  }
}

/** 一次组卷的硬事实快照。 */
interface UnitScope {
  classId: string
  termId: string
  teachingUnitIds: string[]
  /** kpId → 提供该 KP 的教学单元 id（先到先得，顺序即教师传入顺序）。 */
  kpOwner: Map<string, string>
  studentIds: string[]
  warnings: MockExamWarning[]
}

export class MockExamService {
  private readonly org: MockExamOrgReader
  private readonly questions: MockExamQuestionReader
  private readonly mastery: MockExamMasteryReader
  private readonly plans: MockExamPlanWriter
  private readonly attempts: MockExamAttemptReader | undefined
  private readonly assignPort: MockExamAssignPort | undefined
  private readonly now: () => Date
  private readonly newId: () => string
  private readonly masteryThreshold: number
  private readonly excludeRecentDays: number

  public constructor(options: MockExamServiceOptions) {
    this.org = options.org
    this.questions = options.questions
    this.mastery = options.mastery
    this.plans = options.plans
    this.attempts = options.attempts
    this.assignPort = options.assign
    this.now = options.now ?? (() => new Date())
    this.newId = options.newId ?? (() => `mock_${randomUUID()}`)
    this.masteryThreshold = options.masteryThreshold ?? MASTERY_THRESHOLD
    this.excludeRecentDays = options.excludeRecentDays ?? 0
  }

  // -------------------------------------------------------------------------
  // 建议卷（不落库）
  // -------------------------------------------------------------------------

  public async suggest(
    input: SuggestMockExamInput
  ): Promise<MockExamSuggestion> {
    const scope = this.resolveScope(input.teacherId, input.teachingUnitIds, input.classId)
    const allowedKpIds = [...scope.kpOwner.keys()]
    const candidates = this.collectCandidates(input.teacherId, scope)
    const weakKpIds = this.aggregateWeakKpIds(scope.studentIds, allowedKpIds)
    const excludeQuestionIds = await this.recentlyAttemptedQuestionIds(scope)

    const { plan, warnings } = assembleMockExam({
      id: this.newId(),
      createdAt: this.now().toISOString(),
      creatorId: input.teacherId,
      classId: scope.classId,
      title: input.title?.trim() || defaultTitle(this.now()),
      durationMinutes: normalizeDuration(input.durationMinutes),
      questionCount: input.questionCount ?? DEFAULT_MOCK_EXAM_QUESTION_COUNT,
      teachingUnitIds: scope.teachingUnitIds,
      candidates,
      weakKpIds,
      allowedKpIds,
      excludeQuestionIds,
      warnings: scope.warnings
    })

    const questions = this.projectQuestions(plan, scope)
    return {
      plan,
      questions,
      sections: groupQuestionsBySubject(questions),
      warnings,
      gateNotice: MOCK_EXAM_GATE_NOTICE
    }
  }

  // -------------------------------------------------------------------------
  // 保存 / 发布
  // -------------------------------------------------------------------------

  /**
   * 保存教师确认过的卷面。教师在前端可以删题换题，所以这里对**每一个**题号
   * 重跑一遍 D2 + D4 + 权限闸门 —— 前端永远不能替服务端放行。
   */
  public async save(input: SaveMockExamInput): Promise<SaveMockExamResult> {
    const scope = this.resolveScope(input.teacherId, input.teachingUnitIds, input.classId)
    const warnings: MockExamWarning[] = [...scope.warnings]
    const requestedPlanId = input.planId?.trim()
    const existingPlan = requestedPlanId
      ? this.plans.get(requestedPlanId)
      : undefined
    if (existingPlan && existingPlan.creatorId !== input.teacherId) {
      throw new MockExamForbiddenError(
        'Forbidden: mock exam plan belongs to another teacher'
      )
    }

    const accepted: MockExamCandidate[] = []
    const seen = new Set<string>()
    for (const rawId of input.questionIds) {
      const questionId = rawId.trim()
      if (questionId === '' || seen.has(questionId)) continue
      seen.add(questionId)
      const question = this.questions.get(questionId)
      if (!question) {
        warnings.push({
          code: 'no_scorable_question',
          message: `题目不存在，已从卷面移除：${questionId}`
        })
        continue
      }
      const rejection = this.rejectReason(question, input.teacherId, scope)
      if (rejection) {
        warnings.push(rejection)
        continue
      }
      accepted.push(this.toCandidate(question, scope))
    }

    if (accepted.length === 0) {
      throw new MockExamInputError(
        '卷面为空：所有题目都未通过答案权威 / 已教进度 / 归属校验（草稿题不入卷）。'
      )
    }

    const plan: MockExamPlan = {
      id: requestedPlanId || this.newId(),
      creatorId: input.teacherId,
      classId: scope.classId,
      teachingUnitIds: scope.teachingUnitIds,
      title: input.title?.trim() || defaultTitle(this.now()),
      durationMinutes: normalizeDuration(input.durationMinutes),
      questionIds: accepted.map((candidate) => candidate.questionId),
      kpCoverage: buildCoverageFromCandidates(accepted, scope),
      status: 'draft',
      createdAt: existingPlan?.createdAt ?? this.now().toISOString(),
      algorithm: 'mockexam.manual.v1'
    }

    if (input.publish !== true) {
      this.plans.save(plan)
      const questions = this.projectQuestions(plan, scope)
      return {
        plan,
        questions,
        sections: groupQuestionsBySubject(questions),
        warnings,
        gateNotice: MOCK_EXAM_GATE_NOTICE
      }
    }

    if (!this.assignPort) {
      throw new MockExamInputError(
        'Mock exam publishing is not configured on this server (assign port missing)'
      )
    }

    const paperId = existingPlan?.paperId ?? stablePaperId(plan.id)
    const publishIntent: MockExamPlan = { ...plan, paperId }
    if (existingPlan?.status !== 'assigned') {
      this.plans.save(publishIntent)
    }

    // 布置动作整体转交 T08：本模块不构造 Attempt、不构造 Evidence。
    const primaryUnitId = scope.teachingUnitIds[0] ?? ''
    const questionTeachingUnitIds = Object.fromEntries(
      accepted.map((candidate) => [candidate.questionId, candidate.teachingUnitId])
    )
    let assigned
    try {
      assigned = await this.assignPort.create(
        {
          teachingUnitId: primaryUnitId,
          mode: 'assessment',
          kind: 'handpick',
          questionIds: plan.questionIds,
          title: plan.title,
          paperId,
          questionTeachingUnitIds,
          ...(input.studentIds && input.studentIds.length > 0
            ? { studentIds: input.studentIds }
            : {}),
          ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {})
        },
        input.teacherId
      )
    } catch (error) {
      // T08 的布置错误（无学生 / 越权 / 非法截止时间）翻译成本模块的输入错误，
      // 避免把内部异常类型泄漏到 HTTP 层。
      throw new MockExamInputError(
        error instanceof Error ? error.message : '布置失败'
      )
    }

    const assignedAt = this.now().toISOString()
    if (assigned.paperId !== paperId) {
      throw new MockExamInputError('Assignment service returned a mismatched paperId')
    }
    const published: MockExamPlan = {
      ...publishIntent,
      status: 'assigned',
      paperId: assigned.paperId,
      assignedAt
    }
    this.plans.save(published)

    const questions = this.projectQuestions(published, scope)
    return {
      plan: published,
      questions,
      sections: groupQuestionsBySubject(questions),
      warnings,
      gateNotice: MOCK_EXAM_GATE_NOTICE,
      assignment: {
        paperId: assigned.paperId,
        studentIds: assigned.studentIds,
        attemptCount: assigned.attemptIds.length,
        mode: 'assessment',
        assignedAt,
        ...(assigned.dueAt !== undefined ? { dueAt: assigned.dueAt } : {})
      }
    }
  }

  // -------------------------------------------------------------------------
  // 读取
  // -------------------------------------------------------------------------

  public get(planId: string, teacherId: string): MockExamPlanView {
    const plan = this.plans.get(planId)
    if (!plan) throw new MockExamPlanNotFoundError(planId)
    if (plan.creatorId !== teacherId) {
      throw new MockExamForbiddenError(
        'Forbidden: mock exam plan belongs to another teacher'
      )
    }
    const questions = this.projectStoredQuestions(plan)
    const view: MockExamPlanView = {
      plan,
      questions,
      sections: groupQuestionsBySubject(questions),
      gateNotice: MOCK_EXAM_GATE_NOTICE
    }
    return view
  }

  /** 学生端 / 教师端按 paperId 反查卷面（报告标题、时长、学科标签）。 */
  public findByPaperId(paperId: string): MockExamPlan | undefined {
    return this.plans.findByPaperId(paperId)
  }

  public listAssignedForStudent(studentId: string): MockExamPlan[] {
    return this.plans.listAssigned().filter((plan) =>
      plan.teachingUnitIds.some((unitId) => {
        const unit = this.org.getTeachingUnit(unitId)
        if (!unit || unit.classId !== plan.classId) return false
        return this.org
          .listEnrolledStudentIds(unit.classId, unit.termId)
          .includes(studentId)
      })
    )
  }

  /**
   * 交卷报告。只读投影：
   *   1. 取该学生 mode='assessment' 的 Attempt（D1：练习态不进正式报告）；
   *   2. 过滤出属于这份 paper 的；
   *   3. 交给纯函数 buildPaperReport 做聚合 —— 不重新判分、不写任何表。
   */
  public async report(
    paperId: string,
    studentId: string
  ): Promise<MockExamPaperReport> {
    if (!this.attempts) {
      throw new MockExamInputError(
        'Mock exam reporting is not configured on this server (attempt reader missing)'
      )
    }
    const rows = await this.attempts.listAttempts({
      studentId,
      mode: 'assessment'
    })
    // D1 双保险：即便数据源忽略 mode 过滤（如测试桩），练习态也绝不入卷。
    const scoped = rows.filter(
      (attempt) =>
        attempt.paperId === paperId && attempt.mode === 'assessment'
    )
    if (scoped.length === 0) {
      throw new MockExamPlanNotFoundError(paperId)
    }

    const questionMeta: Record<string, ReportQuestionMeta> = {}
    for (const attempt of scoped) {
      if (questionMeta[attempt.questionId] !== undefined) continue
      const question = this.questions.get(attempt.questionId)
      if (!question) continue
      questionMeta[attempt.questionId] = {
        subject: question.subject,
        kpIds: [...question.kpIds]
      }
    }

    const plan = this.plans.findByPaperId(paperId)
    return buildPaperReport({
      paperId,
      studentId,
      title: plan?.title ?? '模拟考报告',
      ...(plan !== undefined ? { planId: plan.id } : {}),
      generatedAt: this.now().toISOString(),
      algorithm: MOCK_EXAM_REPORT_ALGORITHM,
      attempts: scoped,
      questionMeta
    })
  }

  /**
   * 学生交卷（成套）。服务端确认动作：
   *   1. 校验卷面存在且已布置（assigned）；
   *   2. 取该学生 mode='assessment' 且 paperId 匹配的 Attempt（D1：练习态不入卷）；
   *   3. 统计已答 / 未答，并复用 report() 做只读投影。
   *
   * 铁律边界：本方法不判分、不写 score / evidence / MasteryProfile——
   * 每题分数仍来自各 Attempt 自己的评价（Q3.4 口径：Attempt 才是聚合根）。
   * 返回的未答题列表供前端提示补答或确认交卷。
   */
  public async submitPaper(
    paperId: string,
    studentId: string
  ): Promise<MockExamPaperSubmitResult> {
    if (!this.attempts) {
      throw new MockExamInputError(
        'Mock exam submit is not configured on this server (attempt reader missing)'
      )
    }
    const plan = this.plans.findByPaperId(paperId)
    if (!plan || plan.status !== 'assigned') {
      throw new MockExamPlanNotFoundError(paperId)
    }
    const rows = await this.attempts.listAttempts({
      studentId,
      mode: 'assessment'
    })
    // D1 双保险：即便数据源忽略 mode 过滤（如测试桩），练习态也绝不入卷。
    const scoped = rows.filter(
      (attempt) =>
        attempt.paperId === paperId && attempt.mode === 'assessment'
    )
    const answered = scoped.filter(
      (attempt) => attempt.result?.status === 'completed'
    )
    const answeredQuestionIds = new Set(
      answered.map((attempt) => attempt.questionId)
    )
    const unansweredQuestionIds = plan.questionIds.filter(
      (questionId) => !answeredQuestionIds.has(questionId)
    )
    // 报告投影：元数据以卷面全题为准（含未答题的学科/KP 标记），
    // 分数仍只来自已提交 Attempt（buildPaperReport 不判分）。
    const questionMeta: Record<string, ReportQuestionMeta> = {}
    for (const questionId of plan.questionIds) {
      const question = this.questions.get(questionId)
      if (question) {
        questionMeta[questionId] = {
          subject: question.subject,
          kpIds: [...question.kpIds]
        }
      }
    }
    const report = buildPaperReport({
      paperId,
      studentId,
      title: plan.title,
      planId: plan.id,
      generatedAt: this.now().toISOString(),
      algorithm: MOCK_EXAM_REPORT_ALGORITHM,
      attempts: scoped,
      questionMeta
    })
    return {
      paperId,
      planId: plan.id,
      submittedAt: this.now().toISOString(),
      answeredCount: answeredQuestionIds.size,
      totalQuestions: plan.questionIds.length,
      unansweredQuestionIds,
      attemptIds: scoped.map((attempt) => attempt.id),
      report
    }
  }

  // -------------------------------------------------------------------------
  // 内部：闸门与快照
  // -------------------------------------------------------------------------

  /**
   * 解析教学单元集合。越权 / 跨班 / 不存在的单元不会让整次请求失败，
   * 而是被剔除 + 记 warning —— 但它们的 taughtKpIds 绝不会进入允许集合。
   */
  private resolveScope(
    teacherId: string,
    rawUnitIds: string[],
    explicitClassId: string | undefined
  ): UnitScope {
    const unitIds = [...new Set(rawUnitIds.map((id) => id.trim()).filter(Boolean))]
    if (unitIds.length === 0) {
      throw new MockExamInputError('teachingUnitIds is required')
    }

    const warnings: MockExamWarning[] = []
    const kpOwner = new Map<string, string>()
    const acceptedUnitIds: string[] = []
    let classId = explicitClassId?.trim() ?? ''
    let termId = ''

    for (const unitId of unitIds) {
      const unit = this.org.getTeachingUnit(unitId)
      if (!unit) {
        warnings.push({
          code: 'unit_not_found',
          teachingUnitId: unitId,
          message: `教学单元不存在，已忽略：${unitId}`
        })
        continue
      }
      if (unit.teacherId !== teacherId) {
        warnings.push({
          code: 'unit_not_owned',
          teachingUnitId: unitId,
          message: `教学单元不属于当前教师，已忽略：${unitId}`
        })
        continue
      }
      if (classId === '') classId = unit.classId
      if (unit.classId !== classId) {
        // 跨学科 MVP 只支持同一行政班下的多个教学单元。
        warnings.push({
          code: 'unit_cross_class',
          teachingUnitId: unitId,
          message: `教学单元属于其他行政班（${unit.classId}），跨班组卷不在 MVP 范围内，已忽略。`
        })
        continue
      }
      if (termId === '') termId = unit.termId
      acceptedUnitIds.push(unit.id)
      for (const kpId of unit.taughtKpIds) {
        if (!kpOwner.has(kpId)) kpOwner.set(kpId, unit.id)
      }
    }

    if (acceptedUnitIds.length === 0) {
      throw new MockExamUnitNotFoundError(unitIds.join(', '))
    }
    if (kpOwner.size === 0) {
      warnings.push({
        code: 'no_taught_kp',
        message: '所选教学单元没有已教知识点（D4），无题可选。'
      })
    }

    return {
      classId,
      termId,
      teachingUnitIds: acceptedUnitIds,
      kpOwner,
      studentIds: this.org.listEnrolledStudentIds(classId, termId),
      warnings
    }
  }

  /**
   * 题库 → 候选题。三重过滤：教师自有题库、命中已教 KP、有答案权威。
   * 草稿题不在 `questions` 表里，因此这条路径根本读不到它们。
   */
  private collectCandidates(
    teacherId: string,
    scope: UnitScope
  ): MockExamCandidate[] {
    const allowedKpIds = [...scope.kpOwner.keys()]
    if (allowedKpIds.length === 0) return []
    const rows = this.questions.list({
      authorId: teacherId,
      kpIds: allowedKpIds,
      limit: 2_000
    })
    const candidates: MockExamCandidate[] = []
    for (const question of rows) {
      if (this.rejectReason(question, teacherId, scope)) continue
      candidates.push(this.toCandidate(question, scope))
    }
    return candidates
  }

  /**
   * 单题闸门。返回 undefined 表示放行；返回 warning 表示拒绝并说明原因。
   * suggest（批量）与 save（教师改过的列表）共用这一份规则。
   */
  private rejectReason(
    question: Question,
    teacherId: string,
    scope: UnitScope
  ): MockExamWarning | undefined {
    if (question.authorId !== teacherId) {
      return {
        code: 'unit_not_owned',
        message: `题目属于其他教师的私有题库，已移除：${question.id}`
      }
    }
    if (!question.kpIds.some((kpId) => scope.kpOwner.has(kpId))) {
      return {
        code: 'no_taught_kp',
        message: `题目未命中所选教学单元的已教知识点（D4），已移除：${question.id}`
      }
    }
    if (
      !hasAnswerAuthority({
        questionType: question.questionType,
        payload: question.payload,
        source: question.source,
        kpIds: question.kpIds
      })
    ) {
      return {
        code: 'no_scorable_question',
        message: `题目没有权威答案（D2），不可计分，已移除：${question.id}`
      }
    }
    return undefined
  }

  private toCandidate(question: Question, scope: UnitScope): MockExamCandidate {
    const owningKp = question.kpIds.find((kpId) => scope.kpOwner.has(kpId))
    return {
      questionId: question.id,
      subject: question.subject,
      questionType: question.questionType,
      kpIds: [...question.kpIds],
      difficulty: question.difficulty,
      source: question.source,
      teachingUnitId:
        (owningKp !== undefined ? scope.kpOwner.get(owningKp) : undefined) ??
        scope.teachingUnitIds[0] ??
        '',
      createdAt: question.createdAt
    }
  }

  /**
   * cohort 薄弱 KP 聚合（与 T06 同口径）：统计每个已教 KP 上低于阈值的学生数，
   * 按人数降序、kpId 升序排列。没有 assessment 证据时返回空数组，纯函数内核
   * 会退化为「按已教顺序覆盖」并记 warning —— 不编造薄弱点。
   */
  private aggregateWeakKpIds(
    studentIds: string[],
    allowedKpIds: string[]
  ): string[] {
    if (studentIds.length === 0 || allowedKpIds.length === 0) return []
    const weakCount = new Map<string, number>()
    for (const studentId of studentIds) {
      const profile = this.mastery.getProfile(studentId)
      for (const kpId of allowedKpIds) {
        const snapshot = profile[kpId]
        if (snapshot === undefined) continue
        if (snapshot.score < this.masteryThreshold) {
          weakCount.set(kpId, (weakCount.get(kpId) ?? 0) + 1)
        }
      }
    }
    return [...weakCount.entries()]
      .filter(([, count]) => count > 0)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([kpId]) => kpId)
  }

  /** PRD 组卷算法第 3 步：排除近 N 天已在 assessment 里做过的题。 */
  private async recentlyAttemptedQuestionIds(
    scope: UnitScope
  ): Promise<string[]> {
    if (this.excludeRecentDays <= 0 || !this.attempts) return []
    const cutoff = new Date(
      this.now().getTime() - this.excludeRecentDays * 24 * 60 * 60 * 1000
    ).toISOString()
    const seen = new Set<string>()
    for (const studentId of scope.studentIds) {
      const rows = await this.attempts.listAttempts({
        studentId,
        mode: 'assessment'
      })
      for (const attempt of rows) {
        if (attempt.createdAt >= cutoff) seen.add(attempt.questionId)
      }
    }
    return [...seen].sort((left, right) => left.localeCompare(right))
  }

  private projectQuestions(
    plan: MockExamPlan,
    scope: UnitScope
  ): MockExamQuestionView[] {
    return plan.questionIds.flatMap((questionId) => {
      const question = this.questions.get(questionId)
      if (!question) return []
      const owningKp = question.kpIds.find((kpId) => scope.kpOwner.has(kpId))
      return [
        toQuestionView(
          question,
          (owningKp !== undefined ? scope.kpOwner.get(owningKp) : undefined) ??
            scope.teachingUnitIds[0] ??
            ''
        )
      ]
    })
  }

  /** 读取已落库的卷面时用 kpCoverage 反查教学单元归属（不再依赖 scope）。 */
  private projectStoredQuestions(plan: MockExamPlan): MockExamQuestionView[] {
    const unitByKp = new Map<string, string>()
    for (const entry of plan.kpCoverage) {
      if (!unitByKp.has(entry.kpId)) unitByKp.set(entry.kpId, entry.teachingUnitId)
    }
    return plan.questionIds.flatMap((questionId) => {
      const question = this.questions.get(questionId)
      if (!question) return []
      const owningKp = question.kpIds.find((kpId) => unitByKp.has(kpId))
      return [
        toQuestionView(
          question,
          (owningKp !== undefined ? unitByKp.get(owningKp) : undefined) ??
            plan.teachingUnitIds[0] ??
            ''
        )
      ]
    })
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function toQuestionView(
  question: Question,
  teachingUnitId: string
): MockExamQuestionView {
  return {
    questionId: question.id,
    subject: question.subject,
    questionType: question.questionType,
    stem: question.stem,
    kpIds: [...question.kpIds],
    difficulty: question.difficulty,
    source: question.source,
    teachingUnitId
  }
}

function buildCoverageFromCandidates(
  candidates: MockExamCandidate[],
  scope: UnitScope
): MockExamKpCoverage[] {
  const coverage = new Map<string, MockExamKpCoverage>()
  for (const candidate of candidates) {
    for (const kpId of candidate.kpIds) {
      const unitId = scope.kpOwner.get(kpId)
      if (unitId === undefined) continue
      const key = `${candidate.subject}::${kpId}`
      const existing = coverage.get(key)
      if (existing) {
        existing.questionCount += 1
        continue
      }
      coverage.set(key, {
        kpId,
        subject: candidate.subject,
        questionCount: 1,
        teachingUnitId: unitId
      })
    }
  }
  return [...coverage.values()].sort(
    (left, right) =>
      left.subject.localeCompare(right.subject) ||
      left.kpId.localeCompare(right.kpId)
  )
}

function stablePaperId(planId: string): string {
  const digest = createHash('sha256').update(planId).digest('hex').slice(0, 24)
  return `paper_${digest}`
}

function normalizeDuration(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw)) {
    return DEFAULT_MOCK_EXAM_DURATION_MINUTES
  }
  return Math.min(Math.max(Math.trunc(raw), 5), 300)
}

function defaultTitle(now: Date): string {
  return `模拟考 · ${now.toISOString().slice(0, 10)}`
}
