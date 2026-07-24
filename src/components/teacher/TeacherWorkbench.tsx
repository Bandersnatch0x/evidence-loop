import { useState } from 'react'
import { Building2, ClipboardList, Send, Upload } from 'lucide-react'
import type { TeachingUnit } from '../../../shared/contracts'
import { ClassSetup } from './ClassSetup'
import { StudentImport } from './StudentImport'
import { AssignmentComposer } from './AssignmentComposer'
import { Gradebook } from './Gradebook'

type TeacherTab = 'class' | 'roster' | 'assign' | 'grade'

const TABS: Array<{ id: TeacherTab; label: string; icon: typeof Building2 }> = [
  { id: 'class', label: '建教学单元', icon: Building2 },
  { id: 'roster', label: '导入名单', icon: Upload },
  { id: 'assign', label: '布置作业', icon: Send },
  { id: 'grade', label: '主观题批改', icon: ClipboardList }
]

/**
 * T08 teacher workbench — one surface for the班主任×学科教师 workflow.
 *
 * The teaching unit created (or entered) here is threaded to the roster import,
 * assignment composer, and Gradebook so the four tools operate on one D3 unit.
 * Roster import + assignment + grading all require a unit first, so the tabs
 * gate on `unit` being set.
 */
export function TeacherWorkbench() {
  const [tab, setTab] = useState<TeacherTab>('class')
  const [unit, setUnit] = useState<TeachingUnit>()

  const hasUnit = unit !== undefined

  return (
    <div className="teacher-workbench">
      <header className="workbench-header">
        <h2>教师工作台</h2>
        <p className="muted">
          教学单元 = 班级 × 学科 × 学期（D3）。先建单元，再导入名单、布置、批改。
        </p>
        {hasUnit ? (
          <div className="active-unit">
            当前单元：<code>{unit.id}</code>（班级 {unit.classId} · 学科{' '}
            {unit.subjectId} · 学期 {unit.termId}）
          </div>
        ) : (
          <div className="muted">尚未选择教学单元。</div>
        )}
      </header>

      <nav className="teacher-tabs" role="tablist">
        {TABS.map((t) => {
          const Icon = t.icon
          const disabled = t.id !== 'class' && !hasUnit
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? 'tab active' : 'tab'}
              disabled={disabled}
              onClick={() => setTab(t.id)}
            >
              <Icon size={16} /> {t.label}
            </button>
          )
        })}
      </nav>

      <section className="teacher-tab-body">
        {tab === 'class' ? (
          <ClassSetup
            onCreated={(created) => {
              setUnit(created)
              setTab('roster')
            }}
          />
        ) : null}
        {tab === 'roster' && unit !== undefined ? (
          <StudentImport classId={unit.classId} termId={unit.termId} />
        ) : null}
        {tab === 'assign' && unit !== undefined ? (
          <AssignmentComposer teachingUnitId={unit.id} />
        ) : null}
        {tab === 'grade' && unit !== undefined ? (
          <Gradebook teachingUnitId={unit.id} />
        ) : null}
      </section>
    </div>
  )
}
