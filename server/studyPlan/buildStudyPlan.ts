/**
 * buildStudyPlan — T18 硬事实学习计划的**纯函数**内核。
 *
 * 签名刻意是 `(StudyPlanHardFacts) => StudyPlan`：
 *   - 没有 db、没有 store、没有 Service 句柄 —— 物理上够不到任何写路径，
 *     所以「生成计划反向写分」在类型层面就不可能发生（ADR-0001）。
 *   - 同一份硬事实必得同一份计划（确定性，可重放，可快照测试）。
 *
 * 决策源优先级（高 → 低），同一 KP 只取最高优先级那条：
 *   1. `fsrs`    FSRS 到期卡片（ReviewCard）
 *   2. `weak`    依赖链薄弱（前置 KP 未过阈值）
 *   3. `mastery` assessment MasteryProfile 低于 MASTERY_THRESHOLD
 * 全部再 ∩ `taughtKpIds`（D4：未教 KP 永不进计划）。
 *
 * **不编造铁律**：候选项必须能挂上至少一条 StudyPlanEvidenceRef，否则丢弃。
 * 特别地，MasteryProfile 里**不存在**的 KP 表示「没有证据」——绝不像 T06
 * 那样退化成 score 0 当薄弱点。没有硬输入就产出空计划 +
 * `status: 'insufficient_evidence'`。
 */
import { MASTERY_THRESHOLD } from '../config/mastery'
import type {
  MasteryProfileMap,
  MasterySnapshot,
  ReviewCard
} from '../../shared/contracts'
import {
  STUDY_PLAN_ALGORITHM,
  STUDY_PLAN_HORIZON_DAYS,
  type StudyPlan,
  type StudyPlanDay,
  type StudyPlanEvidenceRef,
  type StudyPlanHardFacts,
  type StudyPlanTask,
  type StudyPlanTaskReason
} from '../../shared/studyPlan'

export interface BuildStudyPlanOptions {
  /** 覆盖滚动窗口长度（默认 7）。 */
  horizonDays?: number
  /** 每个 KP 槽位的建议题量上限（默认 3）。 */
  maxTargetCount?: number
  /** 整份计划的 task 上限（默认 horizonDays * 2）。 */
  maxTasks?: number
}

/** 各理由的默认建议题量 —— 到期复习轻、薄弱补齐重。 */
const BASE_TARGET_COUNT: Record<StudyPlanTaskReason, number> = {
  fsrs: 2,
  weak: 3,
  mastery: 3
}

/** 内部候选项：已确认硬事实锚点非空。 */
interface Candidate {
  kpId: string
  reason: StudyPlanTaskReason
  evidenceRefs: StudyPlanEvidenceRef[]
  /** 排序键：fsrs 用 dueAt，其余用 mastery score（越低越靠前）。 */
  sortKey: string
}

/**
 * 由硬事实快照确定性地生成滚动 7 日计划。纯函数，无副作用。
 */
export function buildStudyPlan(
  facts: StudyPlanHardFacts,
  options: BuildStudyPlanOptions = {}
): StudyPlan {
  const horizonDays = clamp(options.horizonDays ?? STUDY_PLAN_HORIZON_DAYS, 1, 31)
  const maxTargetCount = clamp(options.maxTargetCount ?? 3, 1, 10)
  const maxTasks = clamp(options.maxTasks ?? horizonDays * 2, 1, 100)

  const taughtKpIds = [...facts.taughtKpIds]
  const taughtSet = new Set(taughtKpIds)
  const candidates = collectCandidates(facts, taughtSet, maxTasks)

  const days = spreadAcrossDays({
    candidates,
    horizonDays,
    startDate: facts.now,
    questionsByKp: facts.questionsByKp,
    maxTargetCount
  })

  const evidenceRefs = days
    .flatMap((day) => day.tasks)
    .flatMap((task) => task.evidenceRefs)

  return {
    id: makePlanId(facts.studentId, facts.teachingUnitId, facts.now),
    studentId: facts.studentId,
    teachingUnitId: facts.teachingUnitId,
    termId: facts.termId,
    horizonDays,
    days,
    algorithm: STUDY_PLAN_ALGORITHM,
    generatedAt: facts.now,
    // 没有任何硬事实锚点 ⇒ 明确报「证据不足」，绝不用 LLM 填内容。
    status: candidates.length === 0 ? 'insufficient_evidence' : 'ok',
    taughtKpIds,
    evidenceRefs
  }
}

/**
 * 三路硬输入合并。每一路都自带锚点构造；构造不出锚点的直接不入选。
 */
function collectCandidates(
  facts: StudyPlanHardFacts,
  taughtSet: ReadonlySet<string>,
  maxTasks: number
): Candidate[] {
  const merged: Candidate[] = []
  const seen = new Set<string>()

  const push = (candidate: Candidate): void => {
    if (merged.length >= maxTasks) return
    if (seen.has(candidate.kpId)) return
    // 不编造铁律：锚点为空的候选项一律丢弃。
    if (candidate.evidenceRefs.length === 0) return
    seen.add(candidate.kpId)
    merged.push(candidate)
  }

  // 1) FSRS 到期 —— 最高优先级。按 dueAt 升序、同刻按 kpId 字典序（确定性）。
  for (const card of sortDueCards(facts.dueCards)) {
    if (!taughtSet.has(card.kpId)) continue
    push({
      kpId: card.kpId,
      reason: 'fsrs',
      evidenceRefs: [
        {
          kind: 'review_card',
          cardId: card.id,
          kpId: card.kpId,
          dueAt: card.scheduling.dueAt
        },
        // 若同时有掌握度快照，一并挂上（更强的可追溯性）。
        ...snapshotRefOrNone(facts.masteryProfile, card.kpId)
      ],
      sortKey: card.scheduling.dueAt
    })
  }

  // 2) 依赖链薄弱 —— 触发诊断的 weakKp 必须有真实快照，否则该诊断无硬事实基础。
  for (const gap of sortGaps(facts.dependencyGaps)) {
    if (!taughtSet.has(gap.targetKp)) continue
    const trigger = facts.masteryProfile[gap.weakKp]
    if (!trigger || trigger.score >= MASTERY_THRESHOLD) continue
    push({
      kpId: gap.targetKp,
      reason: 'weak',
      evidenceRefs: [
        toSnapshotRef(gap.weakKp, trigger),
        ...snapshotRefOrNone(facts.masteryProfile, gap.targetKp)
      ],
      sortKey: formatScoreKey(trigger.score)
    })
  }

  // 3) assessment MasteryProfile 低于阈值。只遍历**真实存在**的快照条目。
  for (const [kpId, snapshot] of sortSnapshots(facts.masteryProfile)) {
    if (!taughtSet.has(kpId)) continue
    if (snapshot.score >= MASTERY_THRESHOLD) continue
    push({
      kpId,
      reason: 'mastery',
      evidenceRefs: [toSnapshotRef(kpId, snapshot)],
      sortKey: formatScoreKey(snapshot.score)
    })
  }

  return merged
}

/**
 * 把候选项铺到滚动窗口上。轮转分配（第 i 个候选 → 第 i % horizon 天），
 * 于是最高优先级的候选必然落在今天，其余均匀铺开。
 *
 * 候选不足时后面的天就是空的 —— 这是诚实的「没有硬输入」，不是缺陷。
 */
function spreadAcrossDays(input: {
  candidates: Candidate[]
  horizonDays: number
  startDate: string
  questionsByKp: Record<string, string[]>
  maxTargetCount: number
}): StudyPlanDay[] {
  const days: StudyPlanDay[] = []
  for (let index = 0; index < input.horizonDays; index += 1) {
    days.push({
      date: addUtcDays(input.startDate, index),
      dayIndex: index,
      tasks: []
    })
  }

  input.candidates.forEach((candidate, index) => {
    const day = days[index % input.horizonDays]
    if (!day) return
    day.tasks.push(toTask(candidate, input.questionsByKp, input.maxTargetCount))
  })

  return days
}

function toTask(
  candidate: Candidate,
  questionsByKp: Record<string, string[]>,
  maxTargetCount: number
): StudyPlanTask {
  const targetCount = Math.min(
    BASE_TARGET_COUNT[candidate.reason],
    maxTargetCount
  )
  const available = questionsByKp[candidate.kpId] ?? []
  return {
    kpId: candidate.kpId,
    targetCount,
    // T18 建议 mode 恒为 practice：先练后测，绝不自动升级为正式测评（D1）。
    mode: 'practice',
    reason: candidate.reason,
    questionIds: available.slice(0, targetCount),
    evidenceRefs: candidate.evidenceRefs
  }
}

// ---------------------------------------------------------------------------
// 确定性排序 / 纯工具
// ---------------------------------------------------------------------------

function sortDueCards(cards: readonly ReviewCard[]): ReviewCard[] {
  return [...cards].sort(
    (a, b) =>
      a.scheduling.dueAt.localeCompare(b.scheduling.dueAt) ||
      a.kpId.localeCompare(b.kpId)
  )
}

function sortGaps<T extends { weakKp: string; targetKp: string }>(
  gaps: readonly T[]
): T[] {
  return [...gaps].sort(
    (a, b) =>
      a.weakKp.localeCompare(b.weakKp) || a.targetKp.localeCompare(b.targetKp)
  )
}

/** 掌握度低者优先；同分按 kpId 字典序，保证跨平台稳定。 */
function sortSnapshots(
  profile: MasteryProfileMap
): Array<[string, MasterySnapshot]> {
  return Object.entries(profile).sort(
    (a, b) => a[1].score - b[1].score || a[0].localeCompare(b[0])
  )
}

function snapshotRefOrNone(
  profile: MasteryProfileMap,
  kpId: string
): StudyPlanEvidenceRef[] {
  const snapshot = profile[kpId]
  return snapshot ? [toSnapshotRef(kpId, snapshot)] : []
}

function toSnapshotRef(
  kpId: string,
  snapshot: MasterySnapshot
): StudyPlanEvidenceRef {
  return {
    kind: 'mastery_snapshot',
    kpId,
    score: snapshot.score,
    evidenceIds: [...snapshot.evidenceIds],
    computedAt: snapshot.computedAt,
    algorithmVersion: snapshot.algorithmVersion
  }
}

/** 定宽分数键，保证字符串排序与数值排序一致。 */
function formatScoreKey(score: number): string {
  return score.toFixed(6).padStart(10, '0')
}

/** UTC 自然日推进，输出 YYYY-MM-DD。 */
function addUtcDays(iso: string, days: number): string {
  const base = new Date(iso)
  const time = base.getTime()
  if (Number.isNaN(time)) return iso.slice(0, 10)
  const shifted = new Date(time + days * 86_400_000)
  return shifted.toISOString().slice(0, 10)
}

function makePlanId(
  studentId: string,
  teachingUnitId: string,
  now: string
): string {
  return `plan_${studentId}_${teachingUnitId}_${addUtcDays(now, 0)}`
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(Math.trunc(value), min), max)
}
