import { useMemo, useState } from 'react'
import { ChevronRight, Clock3, Search, X } from 'lucide-react'
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
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedSubject, setSelectedSubject] = useState<string>('all')

  const availableSubjects = useMemo(() => {
    const subjects = new Set<SubjectLanguage>()
    for (const a of assignments) {
      subjects.add(a.language)
    }
    return Array.from(subjects)
  }, [assignments])

  const filteredAssignments = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return assignments.filter((item) => {
      const matchSubject =
        selectedSubject === 'all' || item.language === selectedSubject
      if (!matchSubject) return false
      if (!query) return true
      const titleMatch = item.title.toLowerCase().includes(query)
      const typeMatch = questionTypeLabel(item.questionType).toLowerCase().includes(query)
      const subjectMatch = subjectLabel(item.language).toLowerCase().includes(query)
      const moduleMatch = (item.module ?? '').toLowerCase().includes(query)
      return titleMatch || typeMatch || subjectMatch || moduleMatch
    })
  }, [assignments, searchQuery, selectedSubject])

  const groups = groupBySubject(filteredAssignments)

  return (
    <nav className="assignment-picker" aria-label="任务列表">
      <div className="assignment-picker-toolbar">
        <div className="assignment-search-box">
          <Search size={15} aria-hidden="true" className="assignment-search-icon" />
          <input
            type="search"
            className="assignment-search-input"
            placeholder="搜索任务、题型或学科..."
            aria-label="搜索任务"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="assignment-search-clear"
              aria-label="清除搜索"
              onClick={() => setSearchQuery('')}
            >
              <X size={14} />
            </button>
          )}
        </div>
        {availableSubjects.length > 1 && (
          <div className="assignment-filter-chips" role="group" aria-label="学科筛选">
            <button
              type="button"
              className={`assignment-filter-chip ${selectedSubject === 'all' ? 'is-active' : ''}`}
              onClick={() => setSelectedSubject('all')}
            >
              全部学科
            </button>
            {availableSubjects.map((sub) => (
              <button
                key={sub}
                type="button"
                className={`assignment-filter-chip ${selectedSubject === sub ? 'is-active' : ''}`}
                onClick={() => setSelectedSubject(sub)}
              >
                {subjectLabel(sub)}
              </button>
            ))}
          </div>
        )}
      </div>

      {groups.length === 0 ? (
        <div className="assignment-picker-empty" role="status">
          <p>未找到匹配的任务（当前搜索："{searchQuery}"）</p>
        </div>
      ) : (
        <div className="assignment-groups-container">
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
        </div>
      )}
    </nav>
  )
}
