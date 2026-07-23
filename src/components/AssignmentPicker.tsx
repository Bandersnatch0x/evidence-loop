import { ChevronRight, Clock3 } from 'lucide-react'
import type { AssignmentSummary, SubjectLanguage } from '../../shared/contracts'
import { questionTypeLabel, subjectLabel } from '../lib/labels'

interface AssignmentPickerProps {
  assignments: AssignmentSummary[]
  activeId: string
  disabled: boolean
  onSelect: (id: string) => void
}

interface SubjectGroup {
  language: SubjectLanguage
  items: AssignmentSummary[]
}

/**
 * Group assignments by subject (`language`) preserving first-seen order.
 * Subject is only the knowledge-graph ownership dimension (ADR-0008); the
 * question type is surfaced separately as a badge on each row.
 */
function groupBySubject(assignments: AssignmentSummary[]): SubjectGroup[] {
  const groups: SubjectGroup[] = []
  for (const item of assignments) {
    const existing = groups.find((group) => group.language === item.language)
    if (existing) {
      existing.items.push(item)
    } else {
      groups.push({ language: item.language, items: [item] })
    }
  }
  return groups
}

/**
 * Subject-grouped task list (工单 030). Lets the learner pick any discipline /
 * question type. Each row is tagged with its question type so the scoring path
 * (ADR-0008) is legible before opening the task.
 */
export function AssignmentPicker({
  assignments,
  activeId,
  disabled,
  onSelect
}: AssignmentPickerProps) {
  const groups = groupBySubject(assignments)

  return (
    <nav className="assignment-picker" aria-label="任务列表">
      {groups.map((group) => (
        <section className="assignment-group" key={group.language}>
          <h2 className="assignment-group-title">{subjectLabel(group.language)}</h2>
          <ul className="assignment-group-list">
            {group.items.map((item) => {
              const isActive = item.id === activeId
              const isReady = item.status === 'ready'
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`assignment-row ${isActive ? 'is-active' : ''}`}
                    aria-current={isActive ? 'true' : undefined}
                    disabled={disabled || !isReady}
                    onClick={() => onSelect(item.id)}
                  >
                    <div className="assignment-row-main">
                      <div className="assignment-row-head">
                        <span className="assignment-type-badge">
                          {questionTypeLabel(item.questionType)}
                        </span>
                        {!isReady && (
                          <span className="assignment-status-badge">即将上线</span>
                        )}
                      </div>
                      <strong className="assignment-row-title">{item.title}</strong>
                      <span className="assignment-row-meta">
                        <Clock3 size={12} aria-hidden="true" />
                        约 {item.estimatedMinutes} 分钟
                      </span>
                    </div>
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </nav>
  )
}
