import { useState } from 'react'
import {
  BookMarked,
  Building2,
  ClipboardList,
  MessageSquareText,
  Send,
  Upload
} from 'lucide-react'
import type { TeachingUnit } from '../../../shared/contracts'
import { ClassSetup } from './ClassSetup'
import { StudentImport } from './StudentImport'
import { AssignmentComposer } from './AssignmentComposer'
import { Gradebook } from './Gradebook'
import { TipComposer } from './TipComposer'
import { QuestionBankPanel } from './QuestionBankPanel'

type TeacherTab = 'class' | 'bank' | 'roster' | 'assign' | 'tips' | 'grade'

const TABS: Array<{
  id: TeacherTab
  label: string
  icon: typeof Building2
  /** Bank is teacher-scoped and does not need a teaching unit first. */
  requiresUnit: boolean
}> = [
  { id: 'class', label: '建教学单元', icon: Building2, requiresUnit: false },
  { id: 'bank', label: '题库录入', icon: BookMarked, requiresUnit: false },
  { id: 'roster', label: '导入名单', icon: Upload, requiresUnit: true },
  { id: 'assign', label: '布置作业', icon: Send, requiresUnit: true },
  { id: 'tips', label: '发提示', icon: MessageSquareText, requiresUnit: true },
  { id: 'grade', label: '主观题批改', icon: ClipboardList, requiresUnit: true }
]

/**
 * T08 teacher workbench — one surface for the班主任×学科教师 workflow.
 *
 * T03 题库录入 is available without a unit (teacher-private bank). Roster /
 * assignment / grading still gate on `unit`.
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
          教学单元 = 班级 × 学科 × 学期（D3）。题库可先录；布置/批改需先建单元。
        </p>
        {hasUnit ? (
          <div className="active-unit">
            当前单元：<code>{unit.id}</code>（班级 {unit.classId} · 学科{' '}
            {unit.subjectId} · 学期 {unit.termId}）
          </div>
        ) : (
          <div className="muted">尚未选择教学单元（题库录入仍可用）。</div>
        )}
      </header>

      <nav className="teacher-tabs" role="tablist">
        {TABS.map((t) => {
          const Icon = t.icon
          const disabled = t.requiresUnit && !hasUnit
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
            onSelected={(selected) => {
              setUnit(selected)
              // New units usually need roster first; re-selecting demo goes to assign.
              setTab(selected.id === 'tu-demo' ? 'assign' : 'roster')
            }}
          />
        ) : null}
        {tab === 'bank' ? <QuestionBankPanel /> : null}
        {tab === 'roster' && unit !== undefined ? (
          <StudentImport teachingUnitId={unit.id} />
        ) : null}
        {tab === 'assign' && unit !== undefined ? (
          <AssignmentComposer teachingUnitId={unit.id} />
        ) : null}
        {tab === 'tips' && unit !== undefined ? (
          <TipComposer teachingUnitId={unit.id} />
        ) : null}
        {tab === 'grade' && unit !== undefined ? (
          <Gradebook teachingUnitId={unit.id} />
        ) : null}
      </section>
    </div>
  )
}
