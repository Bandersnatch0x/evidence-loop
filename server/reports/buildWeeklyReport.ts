/**
 * buildWeeklyReport — 硬事实 → 学情周报的**纯函数**内核（T19）。
 *
 * 唯一输入是 `WeeklyReportHardFacts` 扁平快照，唯一输出是 `WeeklyReport`。
 * 这里没有 db、没有 store、没有 fetch —— 物理上够不到任何写路径，所以
 * 「生成周报不写分」（ADR-0001）是结构性成立的，不靠人自觉。
 *
 * 三条贯穿全文件的规则：
 *
 *   1. **每个数字都挂锚点**。派生型计数（如「完成 0 次」）锚定它所扫描的
 *      **全部样本**，而不是空数组 —— 「在这 12 次提交里完成 0 次」是可核
 *      对的结论，「凭空一个 0」不是。
 *   2. **缺证据 ≠ 零**。没有掌握度快照就报 `insufficient_evidence` + 空态
 *      文案，绝不当成 0 分薄弱点（与 T18 `buildStudyPlan` 同一口径）。
 *   3. **确定性**。所有排序都带次级 key（id 字典序），同一份快照必得逐字节
 *      相同的报告，可做快照测试、可重放审计。
 */
import {
  WEEKLY_REPORT_ALGORITHM,
  WEEKLY_REPORT_MISTAKE_TOP_N,
  WEEKLY_REPORT_SECTION_ORDER,
  WEEKLY_REPORT_SECTION_TITLES,
  WEEKLY_REPORT_TIP_TOP_N,
  WEEKLY_REPORT_WEAK_TOP_N,
  type WeeklyReport,
  type WeeklyReportAttemptFact,
  type WeeklyReportEvidenceRef,
  type WeeklyReportHardFacts,
  type WeeklyReportItem,
  type WeeklyReportMetric,
  type WeeklyReportSection,
  type WeeklyReportSectionId,
  type WeeklyReportTrendPoint
} from '../../shared/weeklyReport'

export interface BuildWeeklyReportOptions {
  /** 错题章节展示上限，默认 5（PRD Top3–5）。 */
  mistakeTopN?: number
  /** 薄弱知识点展示上限，默认 5。 */
  weakTopN?: number
  /** 教师提示摘录上限，默认 5。 */
  tipTopN?: number
}

/** 硬事实 → 周报。同一输入必得同一输出。 */
export function buildWeeklyReport(
  facts: WeeklyReportHardFacts,
  options: BuildWeeklyReportOptions = {}
): WeeklyReport {
  const mistakeTopN = clampTopN(options.mistakeTopN, WEEKLY_REPORT_MISTAKE_TOP_N)
  const weakTopN = clampTopN(options.weakTopN, WEEKLY_REPORT_WEAK_TOP_N)
  const tipTopN = clampTopN(options.tipTopN, WEEKLY_REPORT_TIP_TOP_N)

  const attempts = [...facts.attempts].sort(compareAttempts)

  const byId: Record<WeeklyReportSectionId, WeeklyReportSection> = {
    completion: buildCompletion(attempts),
    assessment_trend: buildAssessmentTrend(attempts),
    weak_kps: buildWeakKps(facts, weakTopN),
    mistake_top: buildMistakeTop(facts, mistakeTopN),
    practice_activity: buildPracticeActivity(attempts),
    next_week: buildNextWeek(facts),
    teacher_tips: buildTeacherTips(facts, tipTopN)
  }

  // 固定顺序输出 —— 渲染层与打印页共用同一份章节序列。
  const sections = WEEKLY_REPORT_SECTION_ORDER.map((id) => byId[id])
  const status = sections.some((section) => section.status === 'ok')
    ? 'ok'
    : 'insufficient_evidence'

  return {
    id: reportId(facts),
    studentId: facts.studentId,
    displayName: facts.displayName,
    teachingUnitId: facts.teachingUnitId,
    termId: facts.termId,
    window: { from: facts.window.from, to: facts.window.to },
    algorithm: WEEKLY_REPORT_ALGORITHM,
    generatedAt: facts.now,
    status,
    sections,
    evidenceRefs: dedupeRefs(
      sections.flatMap((section) => [
        ...section.metrics.flatMap((metric) => metric.evidenceRefs),
        ...section.items.flatMap((item) => item.evidenceRefs)
      ])
    )
  }
}

// ---------------------------------------------------------------------------
// 1. 完成与时长（evidence）
// ---------------------------------------------------------------------------

function buildCompletion(
  attempts: WeeklyReportAttemptFact[]
): WeeklyReportSection {
  if (attempts.length === 0) {
    return emptySection(
      'completion',
      '本周没有任何提交记录，暂无完成与时长数据。'
    )
  }

  // 扫描样本 —— 本章节所有派生计数都锚定它，口径统一且可核对。
  const scanned = attempts.map(toAttemptRef)
  const completed = attempts.filter((item) => item.status === 'completed')
  const questionIds = new Set(attempts.map((item) => item.questionId))

  return {
    id: 'completion',
    title: WEEKLY_REPORT_SECTION_TITLES.completion,
    layer: 'evidence',
    status: 'ok',
    metrics: [
      metric('completion.attempts', '提交次数', attempts.length, '次', scanned),
      metric(
        'completion.completedAttempts',
        '判定完成次数',
        completed.length,
        '次',
        scanned
      ),
      metric(
        'completion.questions',
        '覆盖题目数',
        questionIds.size,
        '题',
        scanned
      ),
      metric(
        'completion.durationMinutes',
        '判题耗时合计',
        toMinutes(attempts),
        '分钟',
        scanned
      )
    ],
    items: [],
    notes: [
      '「判题耗时」为确定性 Runner trace 步骤耗时之和，不是学生真实作答时长的估算。'
    ]
  }
}

// ---------------------------------------------------------------------------
// 2. 测评得分趋势（evidence）
// ---------------------------------------------------------------------------

function buildAssessmentTrend(
  attempts: WeeklyReportAttemptFact[]
): WeeklyReportSection {
  const assessments = attempts.filter((item) => item.mode === 'assessment')
  if (assessments.length === 0) {
    return emptySection(
      'assessment_trend',
      '本周没有测评（assessment）记录，暂不生成得分趋势。练习成绩不计入正式得分。'
    )
  }

  const scanned = assessments.map(toAttemptRef)
  const series: WeeklyReportTrendPoint[] = assessments.map((item) => ({
    date: item.createdAt.slice(0, 10),
    score: item.score,
    attemptId: item.attemptId,
    evaluationId: item.evaluationId,
    questionId: item.questionId
  }))

  const first = assessments[0]
  const latest = assessments[assessments.length - 1]
  const total = assessments.reduce((sum, item) => sum + item.score, 0)

  const metrics: WeeklyReportMetric[] = [
    metric('trend.count', '测评次数', assessments.length, '次', scanned),
    metric(
      'trend.averageScore',
      '平均得分',
      round1(total / assessments.length),
      '分',
      scanned
    )
  ]
  if (latest) {
    metrics.push(
      metric('trend.latestScore', '最近一次得分', latest.score, '分', [
        toAttemptRef(latest)
      ])
    )
  }
  // 首末差值只在有两个及以上数据点时成立 —— 单点无「趋势」可言。
  if (first && latest && assessments.length >= 2) {
    metrics.push(
      metric(
        'trend.delta',
        '较本周首次变化',
        round1(latest.score - first.score),
        '分',
        [toAttemptRef(first), toAttemptRef(latest)]
      )
    )
  }

  return {
    id: 'assessment_trend',
    title: WEEKLY_REPORT_SECTION_TITLES.assessment_trend,
    layer: 'evidence',
    status: 'ok',
    metrics,
    items: [],
    series,
    notes: ['仅统计 assessment 模式提交；练习（practice）不计入正式得分（D1）。']
  }
}

// ---------------------------------------------------------------------------
// 3. 薄弱知识点（evidence）
// ---------------------------------------------------------------------------

function buildWeakKps(
  facts: WeeklyReportHardFacts,
  topN: number
): WeeklyReportSection {
  const taught = new Set(facts.taughtKpIds)
  // D4：未教 KP 不进报告；缺快照的 KP **不**当成 0 分（与 T18 同口径）。
  const tracked = facts.mastery
    .filter((snapshot) => taught.has(snapshot.kpId))
    .sort((a, b) => a.score - b.score || a.kpId.localeCompare(b.kpId))

  if (tracked.length === 0) {
    return emptySection(
      'weak_kps',
      '本教学单元暂无 assessment 掌握度快照，无法判定薄弱知识点（缺少快照不等于零分）。'
    )
  }

  const scanned = tracked.map(toMasteryRef)
  const weak = tracked.filter(
    (snapshot) => snapshot.score < facts.masteryThreshold
  )
  const items: WeeklyReportItem[] = weak.slice(0, topN).map((snapshot) => ({
    id: `weak.${snapshot.kpId}`,
    label: snapshot.kpId,
    detail: `掌握度 ${formatScore(snapshot.score)}（阈值 ${formatScore(
      facts.masteryThreshold
    )}） · 算法 ${snapshot.algorithmVersion}`,
    value: snapshot.score,
    layer: 'evidence',
    evidenceRefs: [toMasteryRef(snapshot)]
  }))

  return {
    id: 'weak_kps',
    title: WEEKLY_REPORT_SECTION_TITLES.weak_kps,
    layer: 'evidence',
    status: 'ok',
    metrics: [
      metric('weak.trackedKpCount', '有快照的知识点', tracked.length, '个', scanned),
      metric('weak.count', '低于掌握阈值', weak.length, '个', scanned)
    ],
    items,
    notes:
      weak.length === 0
        ? ['本单元已有快照的知识点全部达到掌握阈值。']
        : ['掌握度来自 assessment 证据聚合；每条都可回溯到 evidenceIds。']
  }
}

// ---------------------------------------------------------------------------
// 4. 错题 Top（evidence）
// ---------------------------------------------------------------------------

function buildMistakeTop(
  facts: WeeklyReportHardFacts,
  topN: number
): WeeklyReportSection {
  const active = facts.mistakes
    .filter(
      (entry) =>
        !entry.mastered && entry.teachingUnitId === facts.teachingUnitId
    )
    .sort(
      (a, b) =>
        a.lastScore - b.lastScore ||
        b.lastActiveAt.localeCompare(a.lastActiveAt) ||
        a.questionId.localeCompare(b.questionId)
    )

  if (active.length === 0) {
    return emptySection(
      'mistake_top',
      '错题本暂无本教学单元的活跃错题。'
    )
  }

  const scanned = active.map(toMistakeRef)
  const items: WeeklyReportItem[] = active.slice(0, topN).map((entry) => ({
    id: `mistake.${entry.questionId}`,
    label: entry.questionId,
    detail: `最近得分 ${formatScore(entry.lastScore)} · 知识点 ${
      entry.kpIds.length > 0 ? entry.kpIds.join('、') : '未标注'
    }`,
    value: entry.lastScore,
    layer: 'evidence',
    evidenceRefs: [toMistakeRef(entry)]
  }))

  return {
    id: 'mistake_top',
    title: WEEKLY_REPORT_SECTION_TITLES.mistake_top,
    layer: 'evidence',
    status: 'ok',
    metrics: [
      metric('mistake.activeCount', '活跃错题', active.length, '题', scanned),
      metric(
        'mistake.shownCount',
        '本报告展示',
        Math.min(active.length, topN),
        '题',
        scanned
      )
    ],
    items,
    notes: ['错题按最近得分升序取前若干条；连续 assessment 通过后自动移出活跃错题本。']
  }
}

// ---------------------------------------------------------------------------
// 5. 练习活动量（evidence，标注不入正式掌握）
// ---------------------------------------------------------------------------

function buildPracticeActivity(
  attempts: WeeklyReportAttemptFact[]
): WeeklyReportSection {
  const practice = attempts.filter((item) => item.mode === 'practice')
  if (practice.length === 0) {
    return emptySection('practice_activity', '本周没有练习（practice）记录。')
  }

  const scanned = practice.map(toAttemptRef)
  const questionIds = new Set(practice.map((item) => item.questionId))

  return {
    id: 'practice_activity',
    title: WEEKLY_REPORT_SECTION_TITLES.practice_activity,
    layer: 'evidence',
    status: 'ok',
    metrics: [
      metric('practice.attempts', '练习次数', practice.length, '次', scanned),
      metric('practice.questions', '练习题目数', questionIds.size, '题', scanned),
      metric(
        'practice.durationMinutes',
        '练习判题耗时',
        toMinutes(practice),
        '分钟',
        scanned
      )
    ],
    items: [],
    notes: [
      '练习（practice）成绩**不计入**正式掌握度与成绩单（D1），此处仅作活动量参考。'
    ]
  }
}

// ---------------------------------------------------------------------------
// 6. 下周建议（evidence 任务 + 可选 advisory 文案）
// ---------------------------------------------------------------------------

function buildNextWeek(facts: WeeklyReportHardFacts): WeeklyReportSection {
  const plan = facts.plan
  if (!plan || plan.tasks.length === 0) {
    return emptySection(
      'next_week',
      '下周计划暂无硬事实任务（FSRS 到期 / 依赖链薄弱 / 掌握度低于阈值均无命中），不编造学习项。'
    )
  }

  // T18 已保证 task.evidenceRefs 非空；这里再兜一层，锚点为空的任务不展示。
  const backed = plan.tasks.filter((task) => task.evidenceRefs.length > 0)
  if (backed.length === 0) {
    return emptySection(
      'next_week',
      '下周计划任务缺少硬事实锚点，已按证据不足处理。'
    )
  }

  const allRefs = dedupeRefs(backed.flatMap((task) => task.evidenceRefs))
  const kpIds = new Set(backed.map((task) => task.kpId))
  const items: WeeklyReportItem[] = backed.map((task, index) => ({
    id: `nextWeek.${String(index)}.${task.kpId}`,
    label: task.kpId,
    detail: `建议 ${String(task.targetCount)} 题 · ${
      task.mode === 'assessment' ? '测评' : '练习'
    } · 依据 ${reasonLabel(task.reason)}`,
    value: task.targetCount,
    layer: 'evidence',
    evidenceRefs: [...task.evidenceRefs],
    reason: task.reason
  }))

  return {
    id: 'next_week',
    title: WEEKLY_REPORT_SECTION_TITLES.next_week,
    layer: 'evidence',
    status: 'ok',
    metrics: [
      metric('nextWeek.taskCount', '计划任务', backed.length, '项', allRefs),
      metric('nextWeek.kpCount', '涉及知识点', kpIds.size, '个', allRefs)
    ],
    items,
    notes: [
      `任务全部来自硬事实计划（算法 ${plan.algorithm}，状态 ${plan.status}），非 AI 生成。`
    ]
  }
}

// ---------------------------------------------------------------------------
// 7. 教师提示摘录（teacher_annotation）
// ---------------------------------------------------------------------------

function buildTeacherTips(
  facts: WeeklyReportHardFacts,
  topN: number
): WeeklyReportSection {
  const inWindow = facts.tips
    .filter(
      (tip) =>
        tip.teachingUnitId === facts.teachingUnitId &&
        tip.createdAt >= facts.window.from &&
        tip.createdAt < facts.window.to
    )
    .sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt) || a.tipId.localeCompare(b.tipId)
    )

  if (inWindow.length === 0) {
    return emptySection('teacher_tips', '本周没有教师提示。')
  }

  const items: WeeklyReportItem[] = inWindow.slice(0, topN).map((tip) => ({
    id: `tip.${tip.tipId}`,
    label: tip.body,
    detail: `${tip.createdAt.slice(0, 10)}${
      tip.kpIds.length > 0 ? ` · 关联知识点 ${tip.kpIds.join('、')}` : ''
    }`,
    layer: 'teacher_annotation',
    evidenceRefs: [toTipRef(tip)],
    // teacher_annotation 自证来源：谁写的、属于哪条提示（ADR-0006）。
    provenance: {
      kind: 'teacher_annotation',
      teacherId: tip.teacherId,
      note: `teacher_tip:${tip.tipId}`
    }
  }))

  return {
    id: 'teacher_tips',
    title: WEEKLY_REPORT_SECTION_TITLES.teacher_tips,
    layer: 'teacher_annotation',
    status: 'ok',
    metrics: [
      metric(
        'tips.count',
        '本周教师提示',
        inWindow.length,
        '条',
        inWindow.map(toTipRef)
      )
    ],
    items,
    notes: ['教师提示是站内消息（teacher_annotation），不参与任何评分计算。']
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function emptySection(
  id: WeeklyReportSectionId,
  emptyStateText: string
): WeeklyReportSection {
  return {
    id,
    title: WEEKLY_REPORT_SECTION_TITLES[id],
    layer: id === 'teacher_tips' ? 'teacher_annotation' : 'evidence',
    status: 'insufficient_evidence',
    emptyStateText,
    metrics: [],
    items: []
  }
}

function metric(
  id: string,
  label: string,
  value: number,
  unit: string,
  evidenceRefs: WeeklyReportEvidenceRef[]
): WeeklyReportMetric {
  return { id, label, value, unit, evidenceRefs }
}

function toAttemptRef(
  attempt: WeeklyReportAttemptFact
): WeeklyReportEvidenceRef {
  return {
    kind: 'attempt',
    attemptId: attempt.attemptId,
    evaluationId: attempt.evaluationId,
    questionId: attempt.questionId,
    mode: attempt.mode,
    createdAt: attempt.createdAt,
    score: attempt.score
  }
}

function toMasteryRef(snapshot: {
  kpId: string
  score: number
  evidenceIds: string[]
  computedAt: string
  algorithmVersion: string
}): WeeklyReportEvidenceRef {
  return {
    kind: 'mastery_snapshot',
    kpId: snapshot.kpId,
    score: snapshot.score,
    evidenceIds: [...snapshot.evidenceIds],
    computedAt: snapshot.computedAt,
    algorithmVersion: snapshot.algorithmVersion
  }
}

function toMistakeRef(entry: {
  questionId: string
  attemptId: string
  lastScore: number
  lastActiveAt: string
}): WeeklyReportEvidenceRef {
  return {
    kind: 'mistake_entry',
    questionId: entry.questionId,
    attemptId: entry.attemptId,
    lastScore: entry.lastScore,
    lastActiveAt: entry.lastActiveAt
  }
}

function toTipRef(tip: {
  tipId: string
  teacherId: string
  createdAt: string
}): WeeklyReportEvidenceRef {
  return {
    kind: 'teacher_tip',
    tipId: tip.tipId,
    teacherId: tip.teacherId,
    createdAt: tip.createdAt
  }
}

/** 锚点去重键。同一条证据在多个章节出现时只在并集里记一次。 */
function refKey(ref: WeeklyReportEvidenceRef): string {
  switch (ref.kind) {
    case 'attempt':
      return `attempt:${ref.attemptId}`
    case 'mistake_entry':
      return `mistake:${ref.questionId}:${ref.attemptId}`
    case 'teacher_tip':
      return `tip:${ref.tipId}`
    case 'review_card':
      return `card:${ref.cardId}`
    case 'mastery_snapshot':
      return `mastery:${ref.kpId}:${ref.computedAt}`
  }
}

function dedupeRefs(
  refs: WeeklyReportEvidenceRef[]
): WeeklyReportEvidenceRef[] {
  const seen = new Set<string>()
  const out: WeeklyReportEvidenceRef[] = []
  for (const ref of refs) {
    const key = refKey(ref)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(ref)
  }
  return out
}

function compareAttempts(
  a: WeeklyReportAttemptFact,
  b: WeeklyReportAttemptFact
): number {
  return (
    a.createdAt.localeCompare(b.createdAt) ||
    a.attemptId.localeCompare(b.attemptId)
  )
}

function toMinutes(attempts: WeeklyReportAttemptFact[]): number {
  const total = attempts.reduce((sum, item) => sum + item.durationMs, 0)
  return round1(total / 60000)
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function formatScore(score: number): string {
  return String(Math.round(score * 100) / 100)
}

function reasonLabel(reason: 'fsrs' | 'weak' | 'mastery'): string {
  if (reason === 'fsrs') return 'FSRS 到期复习'
  if (reason === 'weak') return '依赖链薄弱前置'
  return '掌握度低于阈值'
}

function clampTopN(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.trunc(value), 1), 20)
}

function reportId(facts: WeeklyReportHardFacts): string {
  return [
    'report',
    facts.studentId,
    facts.teachingUnitId,
    facts.window.from.slice(0, 10),
    facts.window.to.slice(0, 10)
  ].join('_')
}
