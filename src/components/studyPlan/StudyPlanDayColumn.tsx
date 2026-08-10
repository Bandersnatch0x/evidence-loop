/**
 * StudyPlanDayColumn — 时间条里的一个日格（T18）。学生端与教师端共用。
 *
 * 每张任务卡都强制展示它的硬事实理由 + 证据锚点条数：UI 层面也守住
 * 「每条建议都能追溯到 Evidence / MasteryProfile」这条铁律，
 * 没有锚点的任务在服务端就已经不存在，前端不做兜底渲染。
 */
import type {
  StudyPlanDay,
  StudyPlanTask,
  StudyPlanTaskReason
} from '../../../shared/studyPlan'

const REASON_LABEL: Record<StudyPlanTaskReason, string> = {
  fsrs: 'FSRS 到期',
  weak: '依赖链薄弱',
  mastery: '掌握度偏低'
}

interface StudyPlanDayColumnProps {
  day: StudyPlanDay
  onStartTask?: (task: StudyPlanTask) => void
  busy?: boolean
  /** 只读模式（教师抽屉）：不渲染进练习入口。 */
  readOnly?: boolean
}

export function StudyPlanDayColumn({
  day,
  onStartTask,
  busy = false,
  readOnly = false
}: StudyPlanDayColumnProps) {
  const isToday = day.dayIndex === 0
  // 只有今天的任务能直接进练习：计划是路径，不是提前开锁。
  const interactive = !readOnly && isToday && onStartTask !== undefined

  return (
    <div
      className={isToday ? 'study-plan-day is-today' : 'study-plan-day'}
      role="listitem"
    >
      <span className="study-plan-day-label">
        <span>{isToday ? '今天' : formatDate(day.date)}</span>
        <span>{day.tasks.length > 0 ? `${day.tasks.length} 项` : ''}</span>
      </span>

      {day.tasks.length === 0 ? (
        <span className="study-plan-day-empty">无硬输入</span>
      ) : null}

      {day.tasks.map((task) =>
        interactive ? (
          <button
            key={task.kpId}
            type="button"
            className="study-plan-task"
            onClick={() => onStartTask?.(task)}
            disabled={busy || task.questionIds.length === 0}
            title={
              task.questionIds.length === 0
                ? '题库暂无该知识点的题'
                : '进入练习'
            }
          >
            <TaskBody task={task} />
          </button>
        ) : (
          <div key={task.kpId} className="study-plan-task">
            <TaskBody task={task} />
          </div>
        )
      )}
    </div>
  )
}

function TaskBody({ task }: { task: StudyPlanTask }) {
  return (
    <>
      <span className="study-plan-task-kp">{task.kpId}</span>
      <span className="study-plan-task-meta">
        <span className="study-plan-reason">{REASON_LABEL[task.reason]}</span>
        <span>建议 {task.targetCount} 题</span>
        <span>{task.mode === 'practice' ? '练习' : '测评'}</span>
      </span>
      <span className="study-plan-evidence">
        证据 {task.evidenceRefs.length} 条
        {task.questionIds.length === 0 ? ' · 题库待补' : ''}
      </span>
    </>
  )
}

function formatDate(date: string): string {
  const parts = date.split('-')
  if (parts.length !== 3) return date
  return `${parts[1] ?? ''}/${parts[2] ?? ''}`
}
