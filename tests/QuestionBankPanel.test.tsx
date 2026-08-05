import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Question, QuestionSummary } from '../shared/contracts'
import { QuestionBankPanel } from '../src/components/teacher/QuestionBankPanel'
import * as api from '../src/lib/api'

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual('../src/lib/api')
  return {
    ...(actual as object),
    listQuestions: vi.fn(),
    createQuestion: vi.fn(),
    getQuestion: vi.fn(),
    updateQuestion: vi.fn(),
    deleteQuestion: vi.fn(),
    adoptSolution: vi.fn()
  }
})

const summary: QuestionSummary = {
  id: 'q_demo_1',
  questionBankId: 'teacher-private-bank',
  subject: 'math',
  questionType: 'choice',
  stem: '2+2=?',
  kpIds: ['kp.math.arith'],
  difficulty: 1,
  source: 'authored_key',
  hasSolution: false
}

const fullQuestion: Question = {
  ...summary,
  authorId: 'teacher-demo',
  createdAt: '2026-07-24T00:00:00.000Z',
  payload: { kind: 'choice', correctOptionIds: ['A'] }
}

describe('QuestionBankPanel (T03 hand-entry)', () => {
  beforeEach(() => {
    vi.mocked(api.listQuestions).mockResolvedValue([summary])
    vi.mocked(api.createQuestion).mockResolvedValue({
      ...fullQuestion,
      id: 'q_new',
      stem: '新题干'
    })
    vi.mocked(api.getQuestion).mockResolvedValue(fullQuestion)
    vi.mocked(api.adoptSolution).mockResolvedValue({
      question: {
        ...fullQuestion,
        solution: {
          content: '标准解：答案是 A',
          authorId: 'teacher-demo',
          source: 'authored'
        }
      },
      solution: {
        content: '标准解：答案是 A',
        authorId: 'teacher-demo',
        source: 'authored'
      },
      tutoring: {
        mode: 'rag_restate',
        needsSolution: false,
        requiresDisclaimer: false
      }
    })
  })

  it('lists bank rows and opens create form', async () => {
    const user = userEvent.setup()
    render(<QuestionBankPanel />)

    await waitFor(() => {
      expect(screen.getByText(/2\+2=\?/)).toBeTruthy()
    })
    expect(screen.getByText('待补解析')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /录入新题/ }))
    expect(screen.getByRole('heading', { name: /手工录入题目/ })).toBeTruthy()
    expect(screen.getByText(/标准解析（T09，可选）/)).toBeTruthy()
  })

  it('creates a choice question from the hand-entry form', async () => {
    const user = userEvent.setup()
    render(<QuestionBankPanel />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /录入新题/ })).toBeTruthy()
    })
    await user.click(screen.getByRole('button', { name: /录入新题/ }))

    await user.clear(screen.getByPlaceholderText(/支持 LaTeX/))
    await user.type(screen.getByPlaceholderText(/支持 LaTeX/), '3+3=?')
    await user.click(screen.getByRole('button', { name: /创建题目/ }))

    await waitFor(() => {
      expect(api.createQuestion).toHaveBeenCalledWith(
        expect.objectContaining({
          stem: '3+3=?',
          questionType: 'choice',
          payload: { kind: 'choice', correctOptionIds: ['A'] }
        })
      )
    })
  })

  it('adopts AI draft as standard solution on edit (T09)', async () => {
    const user = userEvent.setup()
    render(<QuestionBankPanel />)
    await waitFor(() => {
      expect(screen.getByText(/2\+2=\?/)).toBeTruthy()
    })

    await user.click(screen.getByRole('button', { name: /编辑/ }))
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /编辑题目/ })).toBeTruthy()
    })

    await user.type(
      screen.getByPlaceholderText(/粘贴 AI 讲解正文/),
      'AI 说选 A'
    )
    await user.click(screen.getByRole('button', { name: /采纳为标准解析/ }))

    await waitFor(() => {
      expect(api.adoptSolution).toHaveBeenCalledWith(
        'q_demo_1',
        expect.objectContaining({ content: 'AI 说选 A' })
      )
    })
    expect(
      await screen.findByText(/已采纳为标准解析/)
    ).toBeTruthy()
  })

  it('exposes the reference binding drawer in edit mode', async () => {
    // ReferenceDrawer refreshes bound refs + library cards on mount.
    const fetchStub = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"error":"not found"}', { status: 404, headers: { 'content-type': 'application/json' } })
    )
    const user = userEvent.setup()
    render(<QuestionBankPanel />)
    await waitFor(() => {
      expect(screen.getByText(/2\+2=\?/)).toBeTruthy()
    })
    await user.click(screen.getByRole('button', { name: /编辑/ }))
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /编辑题目/ })).toBeTruthy()
    })
    // Drawer starts collapsed; opening mounts the search/bind surface.
    expect(screen.queryByLabelText('检索')).toBeNull()
    await user.click(screen.getByRole('button', { name: /管理教学演示引用/ }))
    await waitFor(() => {
      expect(screen.getByLabelText('检索')).toBeTruthy()
    })
    expect(screen.getByText(/已引用/)).toBeTruthy()
    fetchStub.mockRestore()
  })
})
