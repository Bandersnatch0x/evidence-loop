/**
 * assembleMockExam — T16 组卷的**确定性纯函数内核**。
 *
 * 输入是一份硬事实快照（候选题 + cohort 薄弱 KP + 已教 KP 全集），输出是
 * 一份有序卷面。同一输入必得同一输出：没有随机数、没有 Date.now()、没有 IO、
 * 没有 LLM。`id` / `createdAt` 由调用方注入，保证可重放。
 *
 * 铁律边界（ADR-0001）：
 *   * 本文件不 import 任何评分 / 证据 / mastery 写路径；
 *   * 输出里没有 score、没有 evidence —— 组卷只决定「哪些题进卷」；
 *   * 候选题的准入（D2 答案权威、D4 已教 KP、跨单元权限）在服务层完成，
 *     本函数只对**已经合法**的候选做排序与配额，不做放行决策。
 *
 * 算法（PRD §组卷算法）：
 *   1. 候选按「薄弱 KP 优先级 → 难度 → 入库时间 → id」稳定排序；
 *   2. 按 subject 轮转取题，避免一科占满；
 *   3. 同 KP 去重：一个知识点在一份卷里最多出一题；
 *   4. 题量不足不阻断，返回 warnings[]，允许短卷发布。
 */
import type {
  MockExamCandidate,
  MockExamKpCoverage,
  MockExamPlan,
  MockExamWarning
} from '../../shared/mockExam'
import {
  MOCK_EXAM_ALGORITHM,
  MOCK_EXAM_MAX_QUESTION_COUNT,
  MOCK_EXAM_MIN_QUESTION_COUNT
} from '../../shared/mockExam'
import type { SubjectLanguage } from '../../shared/contracts'

export interface AssembleMockExamInput {
  /** 由调用方注入，保持纯函数可重放。 */
  id: string
  createdAt: string
  creatorId: string
  classId: string
  title: string
  durationMinutes: number
  /** 目标题量，函数内会 clamp 到 [1, 60]。 */
  questionCount: number
  /** 参与组卷的教学单元 id，顺序即优先级。 */
  teachingUnitIds: string[]
  /** 已通过 D2/D4/权限闸门的候选题。 */
  candidates: MockExamCandidate[]
  /** cohort 薄弱 KP，按「薄弱学生数」降序；空数组表示无薄弱信号。 */
  weakKpIds: string[]
  /** 已教 KP 全集（D4），用于 kpCoverage 归属。 */
  allowedKpIds: string[]
  /** 近期已在 assessment 里做过的题，去重排除。 */
  excludeQuestionIds?: string[]
  /** 前置阶段（权限 / 未教 / 无题）收集到的告警，原样透传到结果里。 */
  warnings?: MockExamWarning[]
}

export interface AssembleMockExamResult {
  plan: MockExamPlan
  warnings: MockExamWarning[]
}

export function assembleMockExam(
  input: AssembleMockExamInput
): AssembleMockExamResult {
  const warnings: MockExamWarning[] = [...(input.warnings ?? [])]
  const target = clampCount(input.questionCount)
  const allowedKpSet = new Set(input.allowedKpIds)
  const excluded = new Set(input.excludeQuestionIds ?? [])

  // 薄弱 KP 缺失时退化为「已教 KP 全集」优先级，仍然确定性可重放。
  const priorityKpIds =
    input.weakKpIds.length > 0 ? input.weakKpIds : [...input.allowedKpIds]
  if (input.weakKpIds.length === 0) {
    warnings.push({
      code: 'no_weak_kp',
      message:
        '没有可用的 cohort 薄弱信号（尚无 assessment 证据），退化为按已教知识点顺序覆盖。'
    })
  }

  const kpRank = new Map<string, number>()
  priorityKpIds.forEach((kpId, index) => {
    if (!kpRank.has(kpId)) kpRank.set(kpId, index)
  })

  const usable = input.candidates.filter(
    (candidate) => !excluded.has(candidate.questionId)
  )
  if (usable.length === 0) {
    warnings.push({
      code: 'no_scorable_question',
      message:
        '题库中没有可计分且命中已教知识点的正式题目（草稿题不入卷），卷面为空。'
    })
    return {
      plan: makePlan(input, [], [], 'draft'),
      warnings
    }
  }

  // 学科顺序固定字典序，保证轮转起点稳定。
  const subjects = [...new Set(usable.map((c) => c.subject))].sort((a, b) =>
    a.localeCompare(b)
  )
  const bySubject = new Map<SubjectLanguage, MockExamCandidate[]>()
  for (const subject of subjects) {
    bySubject.set(
      subject,
      usable
        .filter((candidate) => candidate.subject === subject)
        .sort((left, right) => compareCandidates(left, right, kpRank))
    )
  }

  if (subjects.length > target) {
    warnings.push({
      code: 'subject_underfilled',
      message: `目标题量 ${String(target)} 小于学科数 ${String(subjects.length)}，部分学科不会出现在卷面上。`
    })
  }

  // ---- 轮转选题：一轮给每个学科一个名额，同 KP 只出一题 ----------------
  const cursor = new Map<SubjectLanguage, number>(
    subjects.map((subject) => [subject, 0])
  )
  const coveredKpIds = new Set<string>()
  const selectedBySubject = new Map<SubjectLanguage, MockExamCandidate[]>(
    subjects.map((subject) => [subject, []])
  )
  let selectedCount = 0

  let progressed = true
  while (selectedCount < target && progressed) {
    progressed = false
    for (const subject of subjects) {
      if (selectedCount >= target) break
      const pool = bySubject.get(subject) ?? []
      let index = cursor.get(subject) ?? 0
      let picked: MockExamCandidate | undefined
      while (index < pool.length) {
        const candidate = pool[index]
        index += 1
        if (candidate === undefined) continue
        const fresh = candidate.kpIds.filter(
          (kpId) => allowedKpSet.has(kpId) && !coveredKpIds.has(kpId)
        )
        // 同 KP 去重：这道题若不能带来任何新的已教 KP，就跳过。
        if (fresh.length === 0) continue
        picked = candidate
        for (const kpId of fresh) coveredKpIds.add(kpId)
        break
      }
      cursor.set(subject, index)
      if (picked) {
        selectedBySubject.get(subject)?.push(picked)
        selectedCount += 1
        progressed = true
      }
    }
  }

  // ---- 卷面顺序：学科分组（字典序），组内保持轮转选中的先后 -------------
  const ordered: MockExamCandidate[] = []
  for (const subject of subjects) {
    const picks = selectedBySubject.get(subject) ?? []
    if (picks.length === 0 && (bySubject.get(subject)?.length ?? 0) > 0) {
      warnings.push({
        code: 'subject_underfilled',
        subject,
        message: `学科 ${subject} 有候选题但未能进入卷面（题量或同知识点去重限制）。`
      })
    }
    ordered.push(...picks)
  }

  if (ordered.length < target) {
    warnings.push({
      code: 'short_paper',
      message: `可用题目不足：目标 ${String(target)} 题，实际组出 ${String(ordered.length)} 题。可直接发布短卷，或先补充题库。`
    })
  }

  const coverage = buildCoverage(ordered, allowedKpSet)
  return {
    plan: makePlan(
      input,
      ordered.map((candidate) => candidate.questionId),
      coverage,
      'draft'
    ),
    warnings
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * 排序键：薄弱 KP 优先级升序 → 难度升序 → 入库时间升序 → id 升序。
 * 全部是全序，所以排序结果与输入数组顺序无关（真·确定性）。
 */
function compareCandidates(
  left: MockExamCandidate,
  right: MockExamCandidate,
  kpRank: Map<string, number>
): number {
  const leftRank = bestKpRank(left, kpRank)
  const rightRank = bestKpRank(right, kpRank)
  if (leftRank !== rightRank) return leftRank - rightRank
  if (left.difficulty !== right.difficulty) {
    return left.difficulty - right.difficulty
  }
  const byCreated = left.createdAt.localeCompare(right.createdAt)
  if (byCreated !== 0) return byCreated
  return left.questionId.localeCompare(right.questionId)
}

function bestKpRank(
  candidate: MockExamCandidate,
  kpRank: Map<string, number>
): number {
  let best = Number.MAX_SAFE_INTEGER
  for (const kpId of candidate.kpIds) {
    const rank = kpRank.get(kpId)
    if (rank !== undefined && rank < best) best = rank
  }
  return best
}

/**
 * kpCoverage 只统计「题目自身标签 ∩ 已教 KP」，学科取该题自身的 subject —— 
 * 跨学科映射因此可以逐条追溯回题目的学科 / 知识点标签，而不是靠推断。
 */
function buildCoverage(
  selected: MockExamCandidate[],
  allowedKpSet: Set<string>
): MockExamKpCoverage[] {
  const coverage = new Map<string, MockExamKpCoverage>()
  for (const candidate of selected) {
    for (const kpId of candidate.kpIds) {
      if (!allowedKpSet.has(kpId)) continue
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
        teachingUnitId: candidate.teachingUnitId
      })
    }
  }
  return [...coverage.values()].sort(
    (left, right) =>
      left.subject.localeCompare(right.subject) ||
      left.kpId.localeCompare(right.kpId)
  )
}

function makePlan(
  input: AssembleMockExamInput,
  questionIds: string[],
  kpCoverage: MockExamKpCoverage[],
  status: MockExamPlan['status']
): MockExamPlan {
  return {
    id: input.id,
    creatorId: input.creatorId,
    classId: input.classId,
    teachingUnitIds: [...input.teachingUnitIds],
    title: input.title,
    durationMinutes: input.durationMinutes,
    questionIds,
    kpCoverage,
    status,
    createdAt: input.createdAt,
    algorithm: MOCK_EXAM_ALGORITHM
  }
}

function clampCount(value: number): number {
  if (!Number.isFinite(value)) return MOCK_EXAM_MIN_QUESTION_COUNT
  return Math.min(
    Math.max(Math.trunc(value), MOCK_EXAM_MIN_QUESTION_COUNT),
    MOCK_EXAM_MAX_QUESTION_COUNT
  )
}
