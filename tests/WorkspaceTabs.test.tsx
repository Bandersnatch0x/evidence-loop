import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  Assignment,
  EvaluationResult
} from '../shared/contracts'
import { DEFAULT_EVIDENCE_PROVENANCE } from '../shared/contracts'
import { WorkspaceTabs } from '../src/components/WorkspaceTabs'

/**
 * WorkspaceTabs is a container that mutually excludes the GPU-heavy
 * demonstration/visualizer region from ResultsPanel. These tests pin the tab
 * behavior; the heavy children are stubbed so we assert mounting, not 3D.
 */
vi.mock('../src/components/demonstration/StudentDemonstration', () => ({
  StudentDemonstration: () => (
    <div data-testid="student-demonstration">demonstration</div>
  )
}))
vi.mock('../src/components/visualizer/Visualizer', () => ({
  Visualizer: () => <div data-testid="visualizer">visualizer</div>
}))
vi.mock('../src/components/ResultsPanel', () => ({
  ResultsPanel: () => <div data-testid="results-panel">results</div>
}))
vi.mock('../src/components/AssignmentPanel', () => ({
  AssignmentPanel: () => <div data-testid="assignment-panel" />
}))
vi.mock('../src/components/SubmissionPanel', () => ({
  SubmissionPanel: () => <div data-testid="submission-panel" />
}))
vi.mock('../src/components/tutoring', () => ({
  TutoringPanel: () => <div data-testid="tutoring-panel">tutoring</div>
}))

function buildAssignment(overrides: Partial<Assignment> = {}): Assignment {
  return {
    id: 'python-average',
    title: '边界条件诊断：平均分函数',
    module: 'Python 基础',
    language: 'python',
    questionType: 'code',
    estimatedMinutes: 12,
    status: 'ready',
    objective: '实现可靠的平均分函数。',
    scenario: '上游数据可能为空。',
    requirements: ['声明函数'],
    constraints: ['评分来自运行证据'],
    functionSignature: 'def calculate_average(scores):',
    rubric: [{ id: 'correctness', label: '功能正确性', description: '测试结果', maxScore: 60 }],
    demoVariants: [
      {
        id: 'boundary-bug',
        label: '存在边界缺陷',
        description: '空列表报错',
        code: 'def calculate_average(scores):\n    return sum(scores) / len(scores)'
      }
    ],
    ...overrides
  }
}

const primaryDemo = {
  id: 'demo-1',
  role: 'primary' as const,
  title: '主演示',
  authorName: '作者',
  license: 'CC-BY',
  versionSeq: 1,
  source: 'public' as const,
  demoId: 'demo-1',
  versionId: 'v1',
  health: 'healthy' as const
}

const evaluation: EvaluationResult = {
  id: 'eval-1',
  assignmentId: 'python-average',
  attempt: 1,
  createdAt: '2026-07-22T08:00:00.000Z',
  status: 'completed',
  score: 80,
  summary: '当前得分 80 分。',
  evidence: [],
  dimensions: [],
  diagnoses: [],
  trace: [],
  mastery: [],
  feedbackSource: 'local-policy',
  provenance: DEFAULT_EVIDENCE_PROVENANCE
}

function buildProps(overrides: Record<string, unknown> = {}) {
  return {
    assignment: buildAssignment({ demonstrations: [primaryDemo] }),
    evaluation: undefined,
    history: [],
    submission: 'print(1)',
    selectedVariantId: 'boundary-bug',
    isEvaluating: false,
    isSwitching: false,
    activeAttempt: undefined,
    onSubmissionChange: vi.fn(),
    onVariantChange: vi.fn(),
    onEvaluate: vi.fn(),
    onApplyRepair: vi.fn(),
    ...overrides
  }
}

describe('WorkspaceTabs (P1-2)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('defaults to the demo tab when demonstrations exist', async () => {
    render(<WorkspaceTabs {...buildProps()} />)

    expect(await screen.findByTestId('student-demonstration')).toBeInTheDocument()
    expect(screen.queryByTestId('results-panel')).toBeNull()
    expect(screen.getByRole('tab', { name: '演示' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: '评估结果' })).toHaveAttribute('aria-selected', 'false')
  })

  it('defaults to the results tab when there are no demonstrations', () => {
    render(<WorkspaceTabs {...buildProps({ assignment: buildAssignment() })} />)

    expect(screen.getByTestId('results-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('student-demonstration')).toBeNull()
    expect(screen.queryByRole('tab', { name: '演示' })).toBeNull()
    expect(screen.getByRole('tab', { name: '评估结果' })).toHaveAttribute('aria-selected', 'true')
  })

  it('switches to results on click and unmounts the demonstration', async () => {
    render(<WorkspaceTabs {...buildProps()} />)
    await screen.findByTestId('student-demonstration')

    fireEvent.click(screen.getByRole('tab', { name: '评估结果' }))

    await waitFor(() => {
      expect(screen.getByTestId('results-panel')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('student-demonstration')).toBeNull()
    expect(screen.getByRole('tab', { name: '评估结果' })).toHaveAttribute('aria-selected', 'true')
  })

  it('auto-switches to results when an evaluation is produced', async () => {
    const props = buildProps()
    const { rerender } = render(<WorkspaceTabs {...props} />)
    await screen.findByTestId('student-demonstration')

    rerender(<WorkspaceTabs {...props} evaluation={evaluation} />)

    await waitFor(() => {
      expect(screen.getByTestId('results-panel')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('student-demonstration')).toBeNull()
  })

  it('shows the mid-problem help entry in the demo tab for practice mode before submit', async () => {
    render(
      <WorkspaceTabs
        {...buildProps({
          activeAttempt: { attemptId: 'att-1', mode: 'practice' }
        })}
      />
    )

    expect(await screen.findByTestId('student-demonstration')).toBeInTheDocument()
    expect(screen.getByTestId('tutoring-panel')).toBeInTheDocument()
  })

  it('hides the mid-problem help in assessment mode', async () => {
    render(
      <WorkspaceTabs
        {...buildProps({
          activeAttempt: { attemptId: 'att-1', mode: 'assessment' }
        })}
      />
    )

    expect(await screen.findByTestId('student-demonstration')).toBeInTheDocument()
    expect(screen.queryByTestId('tutoring-panel')).toBeNull()
  })

  it('resets to the demo tab when a new assignment with demos is loaded', async () => {
    const props = buildProps()
    const { rerender } = render(<WorkspaceTabs {...props} />)
    await screen.findByTestId('student-demonstration')

    // Manually switch to results, then load a new assignment.
    fireEvent.click(screen.getByRole('tab', { name: '评估结果' }))
    await waitFor(() => expect(screen.getByTestId('results-panel')).toBeInTheDocument())

    rerender(
      <WorkspaceTabs
        {...props}
        assignment={buildAssignment({ id: 'python-median', demonstrations: [primaryDemo] })}
      />
    )

    expect(await screen.findByTestId('student-demonstration')).toBeInTheDocument()
    expect(screen.queryByTestId('results-panel')).toBeNull()
  })
})
