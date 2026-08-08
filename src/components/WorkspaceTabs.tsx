import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent
} from 'react'
import type {
  Assignment,
  EvaluationHistoryItem,
  EvaluationResult,
  SessionMode
} from '../../shared/contracts'
import { AssignmentPanel } from './AssignmentPanel'
import { ResultsPanel } from './ResultsPanel'
import { SubmissionPanel } from './SubmissionPanel'
import { TutoringPanel } from './tutoring'
import { Visualizer } from './visualizer/Visualizer'

// Lazy-load the student demonstration player so its renderer/3D probe stays
// off the critical path (build budget gate: StudentPlayer chunk ≤ 100 KiB).
const StudentDemonstration = lazy(async () => ({
  default: (await import('./demonstration/StudentDemonstration')).StudentDemonstration
}))

type WorkspaceTab = 'demo' | 'results'

export interface WorkspaceTabsProps {
  assignment: Assignment
  evaluation?: EvaluationResult
  history: EvaluationHistoryItem[]
  submission: string
  selectedVariantId: string
  isEvaluating: boolean
  isSwitching: boolean
  activeAttempt?: { attemptId: string; mode: SessionMode }
  onSubmissionChange: (value: string) => void
  onVariantChange: (variantId: string) => void
  onEvaluate: () => void
  onApplyRepair: () => void
}

/**
 * P1-2 工作区重负载区 Tab 化。
 *
 * 演示/Visualizer 区域与 ResultsPanel 做 tab 互斥挂载——同屏只渲染一个，
 * 卸载 3D Canvas 释放 GPU（机房老设备同时挂载 3D + 编辑器 + 结果会掉帧）。
 * AssignmentPanel 与 SubmissionPanel 常驻同屏，不破坏"题目↔代码"对照。
 *
 * 证据先于表达：提交产出证据后自动切到评估结果 tab；练习态未提交时在
 * demo tab 底部保留苏格拉底求助入口（mid-problem help）。
 */
export function WorkspaceTabs({
  assignment,
  evaluation,
  history,
  submission,
  selectedVariantId,
  isEvaluating,
  isSwitching,
  activeAttempt,
  onSubmissionChange,
  onVariantChange,
  onEvaluate,
  onApplyRepair
}: WorkspaceTabsProps) {
  const hasDemos =
    !!assignment.demonstrations && assignment.demonstrations.length > 0
  // Visualizer 是无 primary 演示时的回退可视化（ADR-0013/0015），仅展示、不入分。
  const hasPrimaryDemo =
    assignment.demonstrations?.some((ref) => ref.role === 'primary') === true

  const [tab, setTab] = useState<WorkspaceTab>(hasDemos ? 'demo' : 'results')

  // 提交产出证据后自动切到评估结果 tab（证据先于表达）。
  useEffect(() => {
    if (evaluation !== undefined) setTab('results')
  }, [evaluation])

  // 切换任务时回到默认 tab：有演示先看演示，再看评估结果。
  useEffect(() => {
    setTab(hasDemos ? 'demo' : 'results')
  }, [assignment.id, hasDemos])

  // 练习态提交前求助：仅 practice + 未提交时开放（D1）。assessment 永不开放。
  const showMidProblemHelp =
    activeAttempt?.mode === 'practice' && evaluation === undefined
  const helpAttemptId = showMidProblemHelp ? activeAttempt?.attemptId : undefined

  const demoTabRef = useRef<HTMLButtonElement>(null)
  const resultsTabRef = useRef<HTMLButtonElement>(null)
  const tabs: WorkspaceTab[] = hasDemos ? ['demo', 'results'] : ['results']

  const focusTab = (next: WorkspaceTab) => {
    const el = next === 'demo' ? demoTabRef.current : resultsTabRef.current
    el?.focus()
  }

  // WAI-ARIA tabs: roving tabindex + 方向键切换，保证键盘可操作。
  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    const index = tabs.indexOf(tab)
    const direction = event.key === 'ArrowRight' ? 1 : -1
    const next = tabs[(index + direction + tabs.length) % tabs.length]
    if (!next) return
    setTab(next)
    focusTab(next)
  }

  return (
    <>
      <div className="workspace-tabs" role="tablist" aria-label="工作区视图切换">
        {hasDemos && (
          <button
            ref={demoTabRef}
            type="button"
            role="tab"
            id="workspace-tab-demo"
            aria-selected={tab === 'demo'}
            tabIndex={tab === 'demo' ? 0 : -1}
            className={`workspace-tab${tab === 'demo' ? ' is-active' : ''}`}
            onClick={() => setTab('demo')}
            onKeyDown={handleTabKeyDown}
          >
            演示
          </button>
        )}
        <button
          ref={resultsTabRef}
          type="button"
          role="tab"
          id="workspace-tab-results"
          aria-selected={tab === 'results'}
          tabIndex={tab === 'results' ? 0 : -1}
          className={`workspace-tab${tab === 'results' ? ' is-active' : ''}`}
          onClick={() => setTab('results')}
          onKeyDown={handleTabKeyDown}
        >
          评估结果
        </button>
      </div>

      <div className="workspace-grid">
        <AssignmentPanel assignment={assignment} />

        {tab === 'demo' && hasDemos && (
          <Suspense fallback={<div className="view-loading">正在加载演示…</div>}>
            <StudentDemonstration
              refs={assignment.demonstrations ?? []}
              expanded={evaluation !== undefined}
            />
          </Suspense>
        )}

        <SubmissionPanel
          assignment={assignment}
          value={submission}
          selectedVariantId={selectedVariantId}
          isEvaluating={isEvaluating || isSwitching}
          onChange={onSubmissionChange}
          onVariantChange={onVariantChange}
          onEvaluate={onEvaluate}
        />

        {tab === 'results' && (
          <ResultsPanel
            evaluation={evaluation}
            history={history}
            onApplyRepair={onApplyRepair}
            sessionMode={activeAttempt?.mode}
            attemptId={activeAttempt?.attemptId}
            showMidProblemHelp={showMidProblemHelp}
          />
        )}
      </div>

      {tab === 'demo' && (
        <>
          {!hasPrimaryDemo && (
            <Visualizer assignment={assignment} submission={submission} />
          )}
          {showMidProblemHelp && helpAttemptId !== undefined && (
            <div className="mid-problem-help">
              <p className="muted mid-problem-help-caption">
                练习态可在提交前求助：苏格拉底引导一次一问，不直接给答案。
              </p>
              <TutoringPanel
                attemptId={helpAttemptId}
                mode="practice"
                evaluationCompleted={false}
              />
            </div>
          )}
        </>
      )}
    </>
  )
}
