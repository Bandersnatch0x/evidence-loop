import type {
  CohortSnapshot,
  EvaluationHistoryItem,
  EvaluationResult
} from '../../shared/contracts'

/**
 * T08/T11 P4 — formal cohort eligibility.
 *
 * A completed result is formal-eligible when either:
 *   - it has no teacher-gated advisory (pure objective path), or
 *   - a teacher has written teacherAnnotation (终裁后才入 Cohort).
 *
 * Pending subjective submissions (requiresTeacherConfirmation advisory,
 * no teacherAnnotation yet) are excluded from formal median / completion
 * aggregates. result.score itself stays objective-only (铁律不变).
 */
export function isAwaitingTeacherAdjudication(
  result: Pick<EvaluationResult, 'advisory' | 'teacherAnnotation' | 'status'>
): boolean {
  if (result.status !== 'completed') return false
  if (result.teacherAnnotation !== undefined) return false
  return (result.advisory ?? []).some((a) => a.requiresTeacherConfirmation)
}

/** Formal score for cohort aggregates, or undefined if not yet eligible. */
export function formalScoreForCohort(
  result: Pick<
    EvaluationResult,
    'score' | 'status' | 'advisory' | 'teacherAnnotation'
  >
): number | undefined {
  if (result.status !== 'completed') return undefined
  if (isAwaitingTeacherAdjudication(result)) return undefined
  return result.score
}

export function createCohortSnapshot(
  history: EvaluationHistoryItem[],
  /** Full results when available — enables T11 teacherAnnotation gate. */
  results: EvaluationResult[] = []
): CohortSnapshot {
  const latestDemo = history.find((item) => item.assignmentId === 'python-average')
  const demoAttempts = history.filter(
    (item) => item.assignmentId === 'python-average'
  ).length

  const completedResults = results.filter((r) => r.status === 'completed')
  const pendingAdjudication = completedResults.filter((r) =>
    isAwaitingTeacherAdjudication(r)
  ).length

  const formalScores = completedResults
    .map((r) => formalScoreForCohort(r))
    .filter((s): s is number => s !== undefined)

  // Prefer real formal median when we have gated results; else legacy demo fallback.
  const medianScore =
    formalScores.length > 0
      ? medianOf(formalScores)
      : (latestDemo?.score ?? 82)

  // Demo learner: if their latest full result is pending adjudication, do not
  // treat the raw objective score as a formal "on-track" signal.
  const latestDemoResult = results
    .filter((r) => r.assignmentId === 'python-average')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  const demoPending =
    latestDemoResult !== undefined &&
    isAwaitingTeacherAdjudication(latestDemoResult)
  const demoFormalScore =
    latestDemoResult !== undefined
      ? formalScoreForCohort(latestDemoResult)
      : latestDemo?.score

  const needsAttentionFromPending = pendingAdjudication > 0 ? 1 : 0
  const baseNeedsAttention =
    demoFormalScore !== undefined && demoFormalScore < 70
      ? 4
      : demoPending
        ? 4
        : 3

  return {
    cohortName: 'Python 入门营 · 7 月班',
    generatedAt: new Date().toISOString(),
    completionRate: 78,
    medianScore,
    needsAttention: baseNeedsAttention + needsAttentionFromPending,
    pendingAdjudication,
    learners: [
      {
        id: 'learner-demo',
        displayName: '当前演示学员',
        assignmentTitle: '边界条件诊断：平均分函数',
        attempts: Math.max(1, demoAttempts),
        // Show objective score for visibility, but state respects formal gate.
        latestScore: latestDemo?.score ?? 80,
        delta: latestDemo?.scoreDelta ?? 0,
        focusConcept: demoPending
          ? '待教师终裁（主观题）'
          : demoFormalScore === 100
            ? '已掌握全部目标'
            : '空序列边界',
        state: demoPending
          ? 'needs-attention'
          : demoFormalScore === undefined || demoFormalScore >= 80
            ? 'on-track'
            : 'needs-attention',
        lastActiveAt: latestDemo?.createdAt ?? new Date().toISOString()
      },
      {
        id: 'learner-02',
        displayName: '陈屿',
        assignmentTitle: '边界条件诊断：平均分函数',
        attempts: 2,
        latestScore: 100,
        delta: 20,
        focusConcept: '已掌握全部目标',
        state: 'on-track',
        lastActiveAt: '2026-07-22T02:18:00.000Z'
      },
      {
        id: 'learner-03',
        displayName: '周然',
        assignmentTitle: '边界条件诊断：平均分函数',
        attempts: 1,
        latestScore: 55,
        delta: 0,
        focusConcept: '函数接口契约',
        state: 'needs-attention',
        lastActiveAt: '2026-07-21T11:42:00.000Z'
      },
      {
        id: 'learner-04',
        displayName: '何清',
        assignmentTitle: '边界条件诊断：平均分函数',
        attempts: 0,
        latestScore: 0,
        delta: 0,
        focusConcept: '尚未开始',
        state: 'not-started',
        lastActiveAt: '2026-07-20T08:05:00.000Z'
      }
    ]
  }
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const even = sorted.length % 2 === 0
  if (even) {
    const lo = sorted[mid - 1] ?? 0
    const hi = sorted[mid] ?? 0
    return Math.round((lo + hi) / 2)
  }
  return sorted[mid] ?? 0
}
