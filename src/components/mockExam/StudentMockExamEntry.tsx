/**
 * StudentMockExamEntry — 学生测评入口的模拟考卡片（T16）。
 *
 * 纯展示组件：卷名 + 时长 + 学科标签 + 题量，外加「测评态，AI 辅导关闭」的
 * 明示（D1）。卷面数据由父级（作业列表 / paper 场次）传入 —— 本组件不自己
 * 发请求，也不显示任何分数（还没作答，本来就没有分数）。
 */
import { CircleAlert, Clock, FileText } from 'lucide-react'
import type { MockExamPlan } from '../../../shared/mockExam'
import { listPlanSubjects } from '../../../shared/mockExam'
import { subjectLabel } from '../../lib/labels'
import './mockExam.css'

interface StudentMockExamEntryProps {
  plan: MockExamPlan
  /** 点击进入打包作答（沿用 T07 paper 场次）。 */
  onStart?: (paperId: string) => void
  disabled?: boolean
}

export function StudentMockExamEntry({
  plan,
  onStart,
  disabled = false
}: StudentMockExamEntryProps) {
  const subjects = listPlanSubjects(plan)

  return (
    <article className="mock-exam-entry" aria-labelledby={`mock-${plan.id}`}>
      <header className="mock-exam-entry-header">
        <h4 id={`mock-${plan.id}`}>
          <FileText size={16} /> {plan.title}
        </h4>
        <span className="mock-exam-tag">
          <Clock size={12} /> {plan.durationMinutes} 分钟
        </span>
      </header>

      <p className="mock-exam-tags">
        {subjects.map((subject) => (
          <span key={subject} className="mock-exam-tag">
            {subjectLabel(subject)}
          </span>
        ))}
        <span className="mock-exam-tag">{plan.questionIds.length} 题</span>
      </p>

      <p className="mock-exam-note">
        <CircleAlert size={12} /> 测评态：打包作答、计时交卷，AI 辅导关闭。
      </p>

      <button
        type="button"
        className="primary-button"
        disabled={disabled || plan.paperId === undefined}
        onClick={() => {
          if (plan.paperId !== undefined) onStart?.(plan.paperId)
        }}
      >
        开始作答
      </button>
    </article>
  )
}
