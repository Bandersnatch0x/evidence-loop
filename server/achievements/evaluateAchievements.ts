/**
 * evaluateAchievements — T20 证据驱动轻激励的**纯函数**内核。
 *
 * 签名刻意是 `(AchievementHardFacts) => AchievementEvaluation`：
 *   - 没有 db、没有 store、没有 Service 句柄 —— 物理上够不到任何写路径，
 *     所以「授予徽章顺手改了掌握度」在类型层面就不可能发生（ADR-0001）。
 *   - 同一份硬事实必得同一批徽章（确定性，可重放，可快照测试）。
 *   - `earnedAt` 一律取自触发它的 Attempt 时间，**不是**判定时刻 —— 于是
 *     重算幂等：明天再算、后天再算，结果逐字节相同。
 *
 * 五条规则全部由硬事实判定，没有一条掺入 LLM 或「学习态度」：
 *
 *   | id                   | 硬条件                                        |
 *   | -------------------- | --------------------------------------------- |
 *   | first_evidence_pass  | 首次 assessment 全证据通过                     |
 *   | repair_plus_20       | 同题连续两次 assessment 分差 ≥ 20              |
 *   | weak_kp_cleared      | 某错题按 T07 规则移出活跃                      |
 *   | streak_study_3       | 连续 3 个自然日各有产生证据的作答              |
 *   | plan_day_done        | T18 当日计划每一项都有当日作答                 |
 *
 * **不编造铁律**：每条规则都必须能构造出至少一条 AchievementEvidenceRef，
 * 否则不授予。特别地，`evidenceIds` 为空的 Attempt 表示「Runner 没产出证据」
 * —— 它不算通过、不算研习、不算完成任务，一律不参与授予。
 */
import {
  ACHIEVEMENT_ALGORITHM,
  ACHIEVEMENT_CATALOG,
  REPAIR_SCORE_DELTA,
  STREAK_STUDY_DAYS,
  type AchievementAttemptFact,
  type AchievementEvaluation,
  type AchievementEvidenceRef,
  type AchievementHardFacts,
  type AchievementId,
  type AchievementProgress,
  type StudentAchievement
} from '../../shared/achievements'

/** 一条规则的判定产物。`detail` 在未授予时说明差距。 */
interface RuleOutcome {
  refs: AchievementEvidenceRef[]
  earnedAt: string
  detail: string
}

type RuleResult =
  | { kind: 'earned'; outcome: RuleOutcome }
  | { kind: 'locked'; detail: string }
  | { kind: 'unavailable'; detail: string }

/**
 * 由硬事实快照确定性地判定全部 5 种成就。纯函数，无副作用。
 */
export function evaluateAchievements(
  facts: AchievementHardFacts
): AchievementEvaluation {
  // 一次性归一化：过滤占位 + 确定性排序（时间升序，同刻按 id 字典序）。
  const attempts = usableAttempts(facts.attempts)

  const results: Record<AchievementId, RuleResult> = {
    first_evidence_pass: ruleFirstEvidencePass(attempts),
    repair_plus_20: ruleRepairPlus20(attempts),
    weak_kp_cleared: ruleWeakKpCleared(facts.mistakes, attempts),
    streak_study_3: ruleStreakStudy3(attempts),
    plan_day_done: rulePlanDayDone(facts.planToday, attempts)
  }

  const earned: StudentAchievement[] = []
  const progress: AchievementProgress[] = []

  // 按固定目录顺序遍历 —— 输出顺序稳定，不按「稀有度」或时间重排。
  for (const entry of ACHIEVEMENT_CATALOG) {
    const result = results[entry.id]
    if (result.kind === 'earned') {
      // 双保险：内核自己也拒绝无锚点的徽章（不编造铁律）。
      if (result.outcome.refs.length === 0) {
        progress.push({
          id: entry.id,
          status: 'locked',
          detail: '缺少可追溯的硬证据，不予授予。'
        })
        continue
      }
      earned.push({
        studentId: facts.studentId,
        achievementId: entry.id,
        earnedAt: result.outcome.earnedAt,
        evidenceRefs: result.outcome.refs,
        algorithm: ACHIEVEMENT_ALGORITHM
      })
      progress.push({
        id: entry.id,
        status: 'earned',
        detail: result.outcome.detail
      })
      continue
    }
    progress.push({ id: entry.id, status: result.kind, detail: result.detail })
  }

  return {
    studentId: facts.studentId,
    algorithm: ACHIEVEMENT_ALGORITHM,
    evaluatedAt: facts.now,
    earned,
    progress
  }
}

// ---------------------------------------------------------------------------
// 规则 1 — first_evidence_pass：首次 assessment 全证据通过
// ---------------------------------------------------------------------------

/**
 * 「全证据通过」= completed + 无 failed 证据原子 + **至少有一条证据**。
 * 最后一个条件是关键：零证据的提交不是「通过」，是「没跑出证据」。
 * practice 模式不算（D1：练习不喂正式成绩，也不该点亮「测评」徽章）。
 */
function ruleFirstEvidencePass(
  attempts: readonly AchievementAttemptFact[]
): RuleResult {
  const assessments = attempts.filter((item) => item.mode === 'assessment')
  const passed = assessments.find(isFullEvidencePass)
  if (!passed) {
    return {
      kind: 'locked',
      detail:
        assessments.length === 0
          ? '尚无测评记录。'
          : `已有 ${String(assessments.length)} 次测评，暂无全证据通过的记录。`
    }
  }
  return {
    kind: 'earned',
    outcome: {
      refs: [toAttemptRef(passed)],
      earnedAt: passed.createdAt,
      detail: `首次全证据通过于 ${passed.createdAt}，证据 ${String(passed.evidenceIds.length)} 条。`
    }
  }
}

// ---------------------------------------------------------------------------
// 规则 2 — repair_plus_20：同题连续两次 assessment 分差 ≥ 20
// ---------------------------------------------------------------------------

/**
 * 奖励「修了再交」。**连续**指该题 assessment 序列中相邻的两次 —— 中间
 * 隔着一次更低分的提交就不算连续（否则挑最低分和最高分凑差值即可刷奖）。
 *
 * 边界精确：分差 19 不授，20 授（`>= REPAIR_SCORE_DELTA`）。
 * 两次都必须带证据，否则「分数」本身没有来源。
 */
function ruleRepairPlus20(
  attempts: readonly AchievementAttemptFact[]
): RuleResult {
  const byQuestion = groupBy(
    attempts.filter(
      (item) => item.mode === 'assessment' && item.evidenceIds.length > 0
    ),
    (item) => item.questionId
  )

  let best: { pair: [AchievementAttemptFact, AchievementAttemptFact]; delta: number } | undefined
  let maxDelta = Number.NEGATIVE_INFINITY

  // 题目按字典序遍历，保证多题同时满足时的选择是确定的。
  for (const questionId of [...byQuestion.keys()].sort()) {
    const series = byQuestion.get(questionId) ?? []
    for (let index = 1; index < series.length; index += 1) {
      const earlier = series[index - 1]
      const later = series[index]
      if (!earlier || !later) continue
      const delta = later.score - earlier.score
      if (delta > maxDelta) maxDelta = delta
      if (delta < REPAIR_SCORE_DELTA) continue
      // 取**最早**达成的那一对（earnedAt 因此不随后续作答漂移，重算幂等）。
      if (!best || later.createdAt < best.pair[1].createdAt) {
        best = { pair: [earlier, later], delta }
      }
    }
  }

  if (!best) {
    return {
      kind: 'locked',
      detail:
        maxDelta === Number.NEGATIVE_INFINITY
          ? '尚无同一道题的两次测评记录。'
          : `同题连续两次测评的最大提升 ${formatDelta(maxDelta)} 分（需 ≥ ${String(REPAIR_SCORE_DELTA)} 分）。`
    }
  }

  const [earlier, later] = best.pair
  return {
    kind: 'earned',
    outcome: {
      refs: [toAttemptRef(earlier), toAttemptRef(later)],
      earnedAt: later.createdAt,
      detail: `题目 ${later.questionId}：${String(earlier.score)} → ${String(later.score)}，提升 ${formatDelta(best.delta)} 分。`
    }
  }
}

// ---------------------------------------------------------------------------
// 规则 3 — weak_kp_cleared：错题按 T07 规则移出活跃
// ---------------------------------------------------------------------------

/**
 * 直接消费 T07 `MistakeBookView` 判定好的 `mastered` 标志 —— 本模块**不**
 * 重新实现移出规则，避免两套规则漂移。
 *
 * 证据链补全：从 Attempt 历史里回捞那几次连续 assessment 通过的 attemptId，
 * 于是「凭什么说我清除了」能一路点到具体作答。捞不到就不授予。
 */
function ruleWeakKpCleared(
  mistakes: AchievementHardFacts['mistakes'],
  attempts: readonly AchievementAttemptFact[]
): RuleResult {
  const cleared = mistakes
    .filter((item) => item.mastered && item.kpIds.length > 0)
    .sort(
      (a, b) =>
        a.lastActiveAt.localeCompare(b.lastActiveAt) ||
        a.questionId.localeCompare(b.questionId)
    )

  const activeCount = mistakes.filter((item) => !item.mastered).length

  for (const entry of cleared) {
    const passes = trailingAssessmentPasses(attempts, entry.questionId)
    if (passes.length === 0) continue
    const last = passes[passes.length - 1]
    if (!last) continue
    return {
      kind: 'earned',
      outcome: {
        refs: [
          {
            kind: 'mistake_cleared',
            questionId: entry.questionId,
            kpIds: [...entry.kpIds],
            attemptIds: passes.map((item) => item.attemptId),
            consecutiveAssessmentPasses: passes.length,
            clearedAt: last.createdAt
          },
          // 连带挂上每一次通过的 Attempt 锚点 —— 直指 Evidence 原子。
          ...passes.map(toAttemptRef)
        ],
        earnedAt: last.createdAt,
        detail: `错题 ${entry.questionId}（${entry.kpIds.join('、')}）已连续 ${String(passes.length)} 次测评通过并移出活跃。`
      }
    }
  }

  return {
    kind: 'locked',
    detail:
      activeCount === 0
        ? '错题本暂无活跃条目。'
        : `活跃错题 ${String(activeCount)} 项，连续测评通过后即移出。`
  }
}

// ---------------------------------------------------------------------------
// 规则 4 — streak_study_3：连续 3 个自然日有产生证据的作答
// ---------------------------------------------------------------------------

/**
 * 「有练习或测评」以**产生了 Evidence** 为准 —— 点开题目不算，交了白卷
 * 但 Runner 没产出证据也不算。这样每一天都能挂上 attemptId 自证。
 *
 * 日历日按 UTC 切分，与 T18 计划的 7 天窗口口径一致。
 * 注意这是**一次性成就**，不是「连胜」：断了不清零、不惩罚，也不展示
 * 当前连胜天数以外的任何压力指标（PRD 反连胜压力）。
 */
function ruleStreakStudy3(
  attempts: readonly AchievementAttemptFact[]
): RuleResult {
  const byDay = new Map<string, string[]>()
  for (const attempt of attempts) {
    if (attempt.evidenceIds.length === 0) continue
    const date = attempt.createdAt.slice(0, 10)
    const list = byDay.get(date)
    if (list) list.push(attempt.attemptId)
    else byDay.set(date, [attempt.attemptId])
  }

  const days = [...byDay.keys()].sort()
  if (days.length === 0) {
    return { kind: 'locked', detail: '尚无产生证据的练习或测评记录。' }
  }

  let runStart = 0
  let longest = 1
  for (let index = 0; index < days.length; index += 1) {
    const today = days[index]
    const yesterday = days[index - 1]
    if (index > 0 && (!today || !yesterday || !isNextUtcDay(yesterday, today))) {
      runStart = index
    }
    const runLength = index - runStart + 1
    if (runLength > longest) longest = runLength

    if (runLength === STREAK_STUDY_DAYS) {
      // 命中即返回 ⇒ 取**最早**的那个 3 天窗口，earnedAt 不随后续作答漂移。
      const window = days.slice(runStart, index + 1)
      const lastDay = window[window.length - 1]
      const earnedAt = earliestCreatedAtOn(attempts, lastDay ?? '')
      const refs = window.map((date) => ({
        kind: 'study_day' as const,
        date,
        attemptIds: [...(byDay.get(date) ?? [])].sort()
      }))
      const total = refs.reduce((sum, ref) => sum + ref.attemptIds.length, 0)
      return {
        kind: 'earned',
        outcome: {
          refs,
          earnedAt,
          detail: `连续研习 ${window.join(' → ')}，共 ${String(total)} 次产生证据的作答。`
        }
      }
    }
  }

  return {
    kind: 'locked',
    detail: `最长连续研习 ${String(longest)} 天（需 ${String(STREAK_STUDY_DAYS)} 天）。`
  }
}

// ---------------------------------------------------------------------------
// 规则 5 — plan_day_done：T18 当日计划全部完成
// ---------------------------------------------------------------------------

/**
 * 依赖 T18。计划不可用（未接线 / 教学单元缺失）时报 `unavailable`，
 * 而不是 `locked` —— 「做不到判定」和「判定为未达成」是两回事，不能混。
 *
 * 空计划（证据不足）同样不授予：没有任务就没有「全部完成」这回事。
 */
function rulePlanDayDone(
  plan: AchievementHardFacts['planToday'],
  attempts: readonly AchievementAttemptFact[]
): RuleResult {
  if (!plan) {
    return {
      kind: 'unavailable',
      detail: '当日学习计划不可用，暂不判定该成就。'
    }
  }
  if (plan.tasks.length === 0) {
    return {
      kind: 'locked',
      detail: '当日计划为空（硬输入不足），无可完成项。'
    }
  }

  const sameDay = attempts.filter(
    (item) =>
      item.createdAt.slice(0, 10) === plan.date && item.evidenceIds.length > 0
  )

  const refs: AchievementEvidenceRef[] = []
  const planRefs: AchievementEvidenceRef[] = []
  let doneCount = 0
  let latest = ''

  for (const task of plan.tasks) {
    const questionIds = new Set(task.questionIds)
    const matched = sameDay.filter(
      (item) => questionIds.has(item.questionId) || item.kpIds.includes(task.kpId)
    )
    if (matched.length === 0) continue
    doneCount += 1
    const attemptIds = matched.map((item) => item.attemptId).sort()
    refs.push({
      kind: 'plan_task_done',
      planId: plan.planId,
      algorithm: plan.algorithm,
      kpId: task.kpId,
      attemptIds
    })
    // T18 任务自己的锚点原样带回来：徽章 → 计划任务 → ReviewCard/掌握度快照。
    planRefs.push(...task.evidenceRefs)
    for (const item of matched) {
      if (item.createdAt > latest) latest = item.createdAt
    }
  }

  if (doneCount < plan.tasks.length) {
    return {
      kind: 'locked',
      detail: `当日计划 ${String(plan.tasks.length)} 项，已完成 ${String(doneCount)} 项。`
    }
  }

  return {
    kind: 'earned',
    outcome: {
      refs: [...refs, ...planRefs],
      earnedAt: latest,
      detail: `${plan.date} 的 ${String(plan.tasks.length)} 项计划全部完成。`
    }
  }
}

// ---------------------------------------------------------------------------
// 确定性排序 / 纯工具
// ---------------------------------------------------------------------------

/**
 * 去掉占位 Attempt，并按 (createdAt, attemptId) 升序 —— 这是整个内核唯一的
 * 排序入口，所有规则共享它，因此判定结果与输入数组顺序无关。
 */
function usableAttempts(
  attempts: readonly AchievementAttemptFact[]
): AchievementAttemptFact[] {
  return attempts
    .filter((item) => !item.placeholder)
    .slice()
    .sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) ||
        a.attemptId.localeCompare(b.attemptId)
    )
}

function isFullEvidencePass(attempt: AchievementAttemptFact): boolean {
  return (
    attempt.status === 'completed' &&
    attempt.evidenceIds.length > 0 &&
    !attempt.hasFailedEvidence
  )
}

/**
 * 该题末尾连续的 assessment 通过序列（最早 → 最晚）。
 * 与 T07 `countTrailingAssessmentPasses` 同口径：practice 跳过（不打断也不
 * 计数），遇到未通过的 assessment 即停止。
 */
function trailingAssessmentPasses(
  attempts: readonly AchievementAttemptFact[],
  questionId: string
): AchievementAttemptFact[] {
  const series = attempts.filter((item) => item.questionId === questionId)
  const passes: AchievementAttemptFact[] = []
  for (let index = series.length - 1; index >= 0; index -= 1) {
    const attempt = series[index]
    if (!attempt) continue
    if (attempt.mode !== 'assessment') continue
    if (!isFullEvidencePass(attempt)) break
    passes.unshift(attempt)
  }
  return passes
}

function toAttemptRef(attempt: AchievementAttemptFact): AchievementEvidenceRef {
  return {
    kind: 'attempt',
    attemptId: attempt.attemptId,
    questionId: attempt.questionId,
    mode: attempt.mode,
    score: attempt.score,
    maxScore: attempt.maxScore,
    evidenceIds: [...attempt.evidenceIds],
    createdAt: attempt.createdAt
  }
}

function groupBy<T>(
  items: readonly T[],
  key: (item: T) => string
): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const bucket = map.get(key(item))
    if (bucket) bucket.push(item)
    else map.set(key(item), [item])
  }
  return map
}

/** `YYYY-MM-DD` 意义上的「后一天」（UTC，跨月跨年安全）。 */
function isNextUtcDay(previous: string, next: string): boolean {
  const base = Date.parse(`${previous}T00:00:00.000Z`)
  if (Number.isNaN(base)) return false
  return new Date(base + 86_400_000).toISOString().slice(0, 10) === next
}

/** 指定自然日里最早一次作答的时间戳（作为 earnedAt，确定性）。 */
function earliestCreatedAtOn(
  attempts: readonly AchievementAttemptFact[],
  date: string
): string {
  for (const attempt of attempts) {
    if (attempt.evidenceIds.length === 0) continue
    if (attempt.createdAt.slice(0, 10) === date) return attempt.createdAt
  }
  return date
}

/** 分差展示：整数不带小数点，小数保留两位（避免 20.000000001 这种噪声）。 */
function formatDelta(delta: number): string {
  if (!Number.isFinite(delta)) return '0'
  return Number.isInteger(delta) ? String(delta) : delta.toFixed(2)
}
