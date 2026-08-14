import { useEffect, useState } from 'react'
import { CalendarCheck } from 'lucide-react'
import type {
  EvaluationHistoryItem,
  NextPracticePlan
} from '../../../shared/contracts'
import {
  getNextPracticePlan,
  listEvaluations,
  questionIdToAssignmentId
} from '../../lib/api'
import { questionTypeLabel, subjectLabel } from '../../lib/labels'
import { QuestionCardGrid } from '../questionCard'
import type { QuestionCardProps } from '../questionCard'
import { ErrorBanner } from '../../components/Banner'

interface TodayPracticeProps {
  studentId: string
  teachingUnitId: string
  refreshKey: number
  /** Start an attempt for a bank question (may be seed:assignmentId). */
  onStartQuestion: (questionId: string, mode: 'practice' | 'assessment') => void
  busy?: boolean
}

/**
 * T07 "今日该练" - student-facing exit of the T06 adaptive loop.
 *
 * P1-1: upgraded from a flat list to a QuestionCardGrid with knowledge-point /
 * difficulty filters. Each card carries the question's difficulty, the student's
 * last score (color block) and an evidence-source link back to the workspace.
 * Empty plan is a valid cold-start state, not an error.
 */
export function TodayPractice({
  studentId,
  teachingUnitId,
  refreshKey,
  onStartQuestion,
  busy = false
}: TodayPracticeProps) {
  const [plan, setPlan] = useState<NextPracticePlan>()
  const [lastScoreByAssignment, setLastScoreByAssignment] = useState<
    Map<string, number>
  >(new Map())
  const [error, setError] = useState<string>()
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(undefined)
    // 评估历史是可选增强（算"上次得分"），失败不应阻塞今日队列。
    Promise.all([
      getNextPracticePlan(studentId, teachingUnitId),
      listEvaluations().catch(() => [] as EvaluationHistoryItem[])
    ])
      .then(([loaded, evals]) => {
        if (cancelled) return
        setPlan(loaded)
        setLastScoreByAssignment(latestScoreByAssignment(evals))
      })
      .catch((loadError: unknown) => {
        if (cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : '今日练习加载失败'
          )
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [studentId, teachingUnitId, refreshKey])

  const cards: QuestionCardProps[] = (plan?.items ?? []).flatMap((item) =>
    item.questions.map((question): QuestionCardProps => {
      const lastScore = lastScoreByAssignment.get(
        questionIdToAssignmentId(question.id)
      )
      return {
        id: question.id,
        title: question.stem,
        kpTags: question.kpIds,
        difficulty: question.difficulty,
        badges: (
          <>
            <span className="subject-tag">{subjectLabel(question.subject)}</span>
            <span className="subject-tag">
              {questionTypeLabel(question.questionType)}
            </span>
            <span className="mode-badge practice">
              {item.source === 'fsrs_due' ? '到期复习' : '薄弱补链'}
            </span>
          </>
        ),
        lastScore,
        evidenceLabel: lastScore !== undefined ? '查看上次证据' : undefined,
        onEvidence:
          lastScore !== undefined ? () => onStartQuestion(question.id, 'practice') : undefined,
        onOpen: () => onStartQuestion(question.id, 'practice'),
        openLabel: '开始练',
        openDisabled: busy,
        secondaryActions:
          item.source === 'dependency_gap'
            ? [
                {
                  label: '测评态',
                  onClick: () => onStartQuestion(question.id, 'assessment'),
                  disabled: busy
                }
              ]
            : undefined
      }
    })
  )

  return (
    <section className="today-practice" aria-labelledby="today-practice-title">
      <header className="today-practice-header">
        <h3 id="today-practice-title">
          <CalendarCheck size={18} style={{ verticalAlign: 'middle' }} /> 今日该练
        </h3>
        <span className="muted">FSRS 到期 ∩ 依赖薄弱 ∩ 已教进度 · 可按知识点/难度筛选</span>
      </header>

      {isLoading ? <p className="muted">正在生成今日队列…</p> : null}
      {error !== undefined ? (
        <ErrorBanner>{error}</ErrorBanner>
      ) : null}

      {!isLoading && error === undefined && cards.length === 0 ? (
        <p className="muted">
          今日暂无推荐题。可从下方双模入口自由练，或等测评后形成薄弱点再回来。
        </p>
      ) : null}

      {cards.length > 0 ? (
        <QuestionCardGrid
          cards={cards}
          emptyHint="该筛选下暂无题目，试试切换知识点或难度。"
        />
      ) : null}
    </section>
  )
}

/**
 * Build assignmentId -> most-recent-score from the student's evaluation history.
 * Uses createdAt to pick the latest attempt per assignment (order-independent).
 */
function latestScoreByAssignment(
  evals: EvaluationHistoryItem[]
): Map<string, number> {
  const latest = new Map<string, { score: number; createdAt: string }>()
  for (const item of evals) {
    const prev = latest.get(item.assignmentId)
    if (prev === undefined || item.createdAt > prev.createdAt) {
      latest.set(item.assignmentId, { score: item.score, createdAt: item.createdAt })
    }
  }
  const scores = new Map<string, number>()
  latest.forEach((value, assignmentId) => scores.set(assignmentId, value.score))
  return scores
}
