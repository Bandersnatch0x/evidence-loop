import type { CohortSnapshot, EvaluationHistoryItem } from '../../shared/contracts'

export function createCohortSnapshot(
  history: EvaluationHistoryItem[]
): CohortSnapshot {
  const latestDemo = history.find((item) => item.assignmentId === 'python-average')
  const demoAttempts = history.filter(
    (item) => item.assignmentId === 'python-average'
  ).length

  return {
    cohortName: 'Python 入门营 · 7 月班',
    generatedAt: new Date().toISOString(),
    completionRate: 78,
    medianScore: latestDemo?.score ?? 82,
    needsAttention: latestDemo && latestDemo.score < 70 ? 4 : 3,
    learners: [
      {
        id: 'learner-demo',
        displayName: '当前演示学员',
        assignmentTitle: '边界条件诊断：平均分函数',
        attempts: Math.max(1, demoAttempts),
        latestScore: latestDemo?.score ?? 80,
        delta: latestDemo?.scoreDelta ?? 0,
        focusConcept:
          latestDemo?.score === 100 ? '已掌握全部目标' : '空序列边界',
        state:
          latestDemo?.score === undefined || latestDemo.score >= 80
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
