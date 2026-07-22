import {
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Minus,
  UsersRound
} from 'lucide-react'
import type { CohortLearner, CohortSnapshot } from '../../shared/contracts'

interface CohortViewProps {
  cohort?: CohortSnapshot
  isLoading: boolean
}

const stateLabels: Record<CohortLearner['state'], string> = {
  'on-track': '进展正常',
  'needs-attention': '需要关注',
  'not-started': '尚未开始'
}

function Delta({ value }: { value: number }) {
  if (value > 0) return <span className="delta positive"><ArrowUpRight size={14} />+{value}</span>
  if (value < 0) return <span className="delta negative"><ArrowDownRight size={14} />{value}</span>
  return <span className="delta neutral"><Minus size={14} />0</span>
}

function formatActivity(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(value))
}

export function CohortView({ cohort, isLoading }: CohortViewProps) {
  if (isLoading || !cohort) {
    return <div className="view-loading"><span className="loading-bar" />正在汇总班级证据...</div>
  }

  return (
    <div className="page-view cohort-view">
      <header className="page-heading">
        <div>
          <span className="eyebrow">教师观察台</span>
          <h1>班级学情</h1>
          <p>{cohort.cohortName} · 基于最近一次可验证提交生成</p>
        </div>
        <div className="updated-at"><Clock3 size={15} />更新于 {formatActivity(cohort.generatedAt)}</div>
      </header>

      <section className="metric-grid" aria-label="班级概览">
        <article>
          <div className="metric-icon"><CheckCircle2 size={19} /></div>
          <span>任务完成率</span><strong>{cohort.completionRate}%</strong>
          <small>至少完成一轮验证</small>
        </article>
        <article>
          <div className="metric-icon"><UsersRound size={19} /></div>
          <span>最近中位分</span><strong>{cohort.medianScore}</strong>
          <small>只统计有效提交</small>
        </article>
        <article className="attention-metric">
          <div className="metric-icon"><CircleAlert size={19} /></div>
          <span>建议优先关注</span><strong>{cohort.needsAttention}</strong>
          <small>由证据规则筛选</small>
        </article>
      </section>

      <section className="cohort-table-section">
        <header>
          <div><h2>学习证据队列</h2><p>教师保留最终干预与成绩认定权。</p></div>
          <span>{cohort.learners.length} 名演示学员</span>
        </header>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>学员</th><th>状态</th><th>最近得分</th><th>变化</th>
                <th>当前关注点</th><th>提交轮次</th><th>最后活动</th>
              </tr>
            </thead>
            <tbody>
              {cohort.learners.map((learner) => (
                <tr key={learner.id}>
                  <td><strong>{learner.displayName}</strong><span>{learner.assignmentTitle}</span></td>
                  <td><span className={`learner-state state-${learner.state}`}>{stateLabels[learner.state]}</span></td>
                  <td><b>{learner.latestScore || '—'}</b></td>
                  <td><Delta value={learner.delta} /></td>
                  <td>{learner.focusConcept}</td>
                  <td>{learner.attempts}</td>
                  <td>{formatActivity(learner.lastActiveAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <aside className="teacher-boundary">
        <CircleAlert size={17} />
        <p><strong>教师责任边界：</strong>队列只提供基于任务证据的关注建议，不推断能力以外的个人特征，也不自动写入正式成绩。</p>
      </aside>
    </div>
  )
}
