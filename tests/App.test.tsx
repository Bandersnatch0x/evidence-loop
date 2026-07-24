import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  Assignment,
  AssignmentSummary,
  CohortSnapshot,
  EvaluationResult
} from '../shared/contracts'
import { App } from '../src/App'
import { isMultimodalEnabled } from '../src/config/features'
import * as api from '../src/lib/api'

vi.mock('../src/lib/api')
vi.mock('../src/config/features', () => ({
  isMultimodalEnabled: vi.fn()
}))

const assignment: Assignment = {
  id: 'python-average',
  title: '边界条件诊断：平均分函数',
  module: 'Python 基础 · 函数与边界',
  language: 'python',
  questionType: 'code',
  estimatedMinutes: 12,
  status: 'ready',
  objective: '实现可靠的平均分函数。',
  scenario: '上游数据可能为空。',
  requirements: ['声明函数', '空列表返回 0'],
  constraints: ['评分来自运行证据'],
  functionSignature: 'def calculate_average(scores):',
  rubric: [
    {
      id: 'correctness',
      label: '功能正确性',
      description: '测试结果',
      maxScore: 60
    }
  ],
  demoVariants: [
    {
      id: 'boundary-bug',
      label: '存在边界缺陷',
      description: '空列表报错',
      code: 'def calculate_average(scores):\n    return sum(scores) / len(scores)'
    },
    {
      id: 'fixed',
      label: '完成边界修复',
      description: '空列表返回 0',
      code:
        'def calculate_average(scores):\n    if not scores:\n        return 0\n    return sum(scores) / len(scores)'
    }
  ]
}

const evaluation: EvaluationResult = {
  id: 'eval-1',
  assignmentId: assignment.id,
  attempt: 1,
  createdAt: '2026-07-22T08:00:00.000Z',
  status: 'completed',
  score: 80,
  summary: '当前得分 80 分，优先处理空序列边界。',
  evidence: [
    {
      id: 'empty-input',
      kind: 'test',
      label: '空序列边界',
      dimensionId: 'correctness',
      visibility: 'hidden',
      state: 'failed',
      weight: 20,
      expected: '0',
      actual: 'ZeroDivisionError',
      message: '空列表路径没有返回约定结果',
      conceptId: 'empty-sequence',
      source: 'test_case'
    }
  ],
  dimensions: [
    {
      ...assignment.rubric[0]!,
      earnedScore: 40,
      state: 'failed',
      evidenceIds: ['empty-input']
    }
  ],
  diagnoses: [
    {
      conceptId: 'empty-sequence',
      title: '空序列边界未处理',
      explanation: '输入为空时分母为零。',
      severity: 'high',
      evidenceIds: ['empty-input']
    }
  ],
  intervention: {
    conceptId: 'empty-sequence',
    title: '先封住空序列路径',
    rationale: '这是最短修复路径。',
    instruction: '在除法前处理空列表。',
    successCriteria: ['空列表返回 0'],
    hints: ['使用布尔判断']
  },
  trace: [
    {
      id: 'retrieve-assignment',
      label: '读取任务与评分量规',
      tool: 'assignment.retrieve',
      status: 'completed',
      summary: '完成',
      durationMs: 4
    },
    {
      id: 'run-submission',
      label: '在受限环境运行提交',
      tool: 'python.safe-runner',
      status: 'completed',
      summary: '完成',
      durationMs: 28
    },
    {
      id: 'score-rubric',
      label: '将运行证据映射到量规',
      tool: 'rubric.score',
      status: 'completed',
      summary: '完成',
      durationMs: 2
    },
    {
      id: 'retrieve-knowledge',
      label: '匹配薄弱概念与训练策略',
      tool: 'knowledge.retrieve',
      status: 'completed',
      summary: '完成',
      durationMs: 3
    },
    {
      id: 'compose-feedback',
      label: '生成受证据约束的反馈',
      tool: 'feedback.compose',
      status: 'completed',
      summary: '完成',
      durationMs: 6
    }
  ],
  mastery: [],
  feedbackSource: 'local-policy',
  provenance: {
    kind: 'evidence',
    evidenceIds: ['empty-input'],
    algorithm: 'simple.v1'
  }
}

describe('App', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.mocked(isMultimodalEnabled).mockReturnValue(false)
    vi.mocked(api.getActiveDemoRole).mockReturnValue('student')
    vi.mocked(api.setActiveDemoRole).mockImplementation(() => undefined)
    vi.mocked(api.listAssignments).mockResolvedValue([
      assignment satisfies AssignmentSummary
    ])
    vi.mocked(api.getAssignment).mockResolvedValue(assignment)
    vi.mocked(api.listEvaluations).mockResolvedValue([])
    vi.mocked(api.getCohort).mockResolvedValue({
      cohortName: 'Python 入门营',
      generatedAt: '2026-07-22T08:00:00.000Z',
      completionRate: 78,
      medianScore: 82,
      needsAttention: 3,
      learners: []
    } satisfies CohortSnapshot)
    vi.mocked(api.evaluateCode).mockResolvedValue(evaluation)
    vi.mocked(api.getKnowledgeGraph).mockResolvedValue({ points: [], edges: [] })
    vi.mocked(api.listDueReviews).mockResolvedValue([])
    vi.mocked(api.getMasteryProfile).mockResolvedValue({})
    vi.mocked(api.assignmentIdToQuestionId).mockImplementation((id) =>
      id.startsWith('seed:') ? id : `seed:${id}`
    )
    vi.mocked(api.startPractice).mockResolvedValue({
      attemptId: 'att-demo-1',
      mode: 'practice',
      tutoringEnabled: true
    })
    vi.mocked(api.listPracticeSessions).mockResolvedValue([])
    vi.mocked(api.getMistakeBook).mockResolvedValue({
      studentId: 'learner-demo',
      entries: [],
      activeCount: 0,
      masteredCount: 0
    })
    vi.mocked(api.getNextPracticePlan).mockResolvedValue({
      studentId: 'learner-demo',
      teachingUnitId: 'tu-demo',
      generatedAt: '2026-07-24T08:00:00.000Z',
      taughtKpIds: [],
      items: []
    })
  })

  it('loads an assignment, evaluates code, and applies the suggested repair', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(
      await screen.findByRole('heading', { name: assignment.title })
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '运行循证评估' }))

    expect(await screen.findByText('80')).toBeInTheDocument()
    expect(screen.getByText('空序列边界未处理')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '应用修复示例' }))

    const editor = screen.getByLabelText('代码编辑器')
    await waitFor(() => {
      expect((editor as HTMLTextAreaElement).value).toContain('if not scores')
    })
    expect(api.evaluateCode).toHaveBeenCalledWith(
      expect.objectContaining({
        assignmentId: assignment.id,
        attemptId: 'att-demo-1'
      })
    )
    expect(api.startPractice).toHaveBeenCalledWith(
      expect.objectContaining({
        questionId: 'seed:python-average',
        mode: 'practice'
      })
    )
  })

  it('starts dual-mode practice with the seed bank question id, not the bare assignment id', async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByRole('heading', { name: assignment.title })
    await user.click(screen.getByRole('button', { name: '我的练习' }))
    await user.click(
      await screen.findByRole('button', { name: /练习态 · 辅导开启/ })
    )

    await waitFor(() => {
      expect(api.startPractice).toHaveBeenCalledWith(
        expect.objectContaining({
          questionId: 'seed:python-average',
          mode: 'practice'
        })
      )
    })
  })

  it('keeps a successful evaluation when secondary refreshes fail', async () => {
    const user = userEvent.setup()
    // Teacher role also refreshes cohort after evaluate.
    vi.mocked(api.getActiveDemoRole).mockReturnValue('teacher')
    render(<App />)

    // Switch the visible role control to teacher so App state matches.
    await user.selectOptions(
      await screen.findByLabelText('演示角色切换'),
      'teacher'
    )

    expect(
      await screen.findByRole('heading', { name: assignment.title })
    ).toBeInTheDocument()

    vi.mocked(api.listEvaluations).mockRejectedValueOnce(
      new Error('history unavailable')
    )
    vi.mocked(api.getCohort).mockRejectedValueOnce(
      new Error('cohort unavailable')
    )

    await user.click(screen.getByRole('button', { name: '运行循证评估' }))

    expect(await screen.findByText('80')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(
      '本轮评估已完成，但历史记录和班级学情暂未同步'
    )
  })

  it('does not mount VoiceCompanion or OverlayLayer when multimodal flag is off', async () => {
    vi.mocked(isMultimodalEnabled).mockReturnValue(false)
    render(<App />)

    expect(
      await screen.findByRole('heading', { name: assignment.title })
    ).toBeInTheDocument()

    // ADR-0005 §8: flag off must leave the pre-Phase-1 workspace stable.
    expect(screen.queryByRole('button', { name: '按住说话' })).toBeNull()
    expect(document.querySelector('.overlay-layer')).toBeNull()
    expect(document.querySelector('.voice-companion')).toBeNull()
    expect(document.querySelector('.math-problem-slot')).toBeNull()
  })

  it('renders the demo role switcher defaulting to student', async () => {
    render(<App />)
    const roleSelect = await screen.findByLabelText('演示角色切换')
    expect(roleSelect).toHaveValue('student')
  })

  it('hides the voice companion while the multimodal flag is off', async () => {
    vi.mocked(isMultimodalEnabled).mockReturnValue(false)
    render(<App />)

    await screen.findByRole('heading', { name: assignment.title })
    expect(screen.queryByRole('button', { name: '按住说话' })).toBeNull()
  })

  it('mounts the voice companion FAB when the multimodal flag is on', async () => {
    vi.mocked(isMultimodalEnabled).mockReturnValue(true)
    render(<App />)

    expect(
      await screen.findByRole('button', { name: '打开语音辅导' })
    ).toBeInTheDocument()
  })

  it('navigates to 今日复习 and 项目透明度 from the sidebar', async () => {
    const user = userEvent.setup()
    vi.mocked(api.getKnowledgeGraph).mockResolvedValue({
      points: [],
      edges: []
    })
    vi.mocked(api.listDueReviews).mockResolvedValue([])
    render(<App />)

    await screen.findByRole('heading', { name: assignment.title })

    await user.click(screen.getByRole('button', { name: '今日复习' }))
    expect(
      await screen.findByRole('heading', { name: '今日复习' })
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '项目透明度' }))
    expect(
      await screen.findByRole('heading', { name: '项目透明度' })
    ).toBeInTheDocument()
  })
})
