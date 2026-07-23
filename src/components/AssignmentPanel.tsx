import { Check, Clock3, FileCode2, ShieldAlert } from 'lucide-react'
import type { Assignment } from '../../shared/contracts'

interface AssignmentPanelProps {
  assignment: Assignment
}

export function AssignmentPanel({ assignment }: AssignmentPanelProps) {
  return (
    <section className="assignment-panel" aria-labelledby="assignment-title">
      <div className="assignment-heading">
        <span className="module-label">{assignment.module}</span>
        <h1 id="assignment-title">{assignment.title}</h1>
        <div className="assignment-meta">
          <span><FileCode2 size={14} /> Python</span>
          <span><Clock3 size={14} /> 约 {assignment.estimatedMinutes} 分钟</span>
        </div>
      </div>

      <div className="assignment-section scenario-block">
        <span className="section-label">业务情境</span>
        <p>{assignment.scenario}</p>
      </div>

      <div className="assignment-section">
        <h2>本轮目标</h2>
        <p>{assignment.objective}</p>
      </div>

      <div className="assignment-section">
        <h2>验收要求</h2>
        <ul className="check-list">
          {assignment.requirements.map((requirement) => (
            <li key={requirement}>
              <Check size={15} />
              <span>{requirement}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="assignment-section">
        <h2>评分量规</h2>
        <div className="rubric-list">
          {assignment.rubric.map((dimension) => (
            <div className="rubric-row" key={dimension.id}>
              <div>
                <strong>{dimension.label}</strong>
                <span>{dimension.description}</span>
              </div>
              <b>{dimension.maxScore}</b>
            </div>
          ))}
        </div>
      </div>

      <details className="constraint-details">
        <summary><ShieldAlert size={15} /> 执行与评分约束</summary>
        <ul>
          {assignment.constraints.map((constraint) => (
            <li key={constraint}>{constraint}</li>
          ))}
        </ul>
      </details>
    </section>
  )
}
