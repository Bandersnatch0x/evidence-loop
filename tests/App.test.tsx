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
import * as api from '../src/lib/api'

vi.mock('../src/lib/api')

const assignment: Assignment = {
  id: 'python-average',
  title: '边界条件诊断：平均分函数',
  module: 'Python 基础 · 函数与边界',
  language: 'python',
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
      conceptId: 'empty-sequence'
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
      id: 'run',
      label: '在受限环境运行提交',
      tool: 'python.safe-runner',
      status: 'completed',
      summary: '完成',
      durationMs: 28
    }
  ],
  mastery: [],
  feedbackSource: 'local-policy'
}

describe('App', () => {
  beforeEach(() => {
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

    const editor = screen.getByLabelText('Python 代码编辑器')
    await waitFor(() => {
      expect((editor as HTMLTextAreaElement).value).toContain('if not scores')
    })
    expect(api.evaluateCode).toHaveBeenCalledWith(
      expect.objectContaining({ assignmentId: assignment.id })
    )
  })

  it('keeps a successful evaluation when secondary refreshes fail', async () => {
    const user = userEvent.setup()
    render(<App />)

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
})
