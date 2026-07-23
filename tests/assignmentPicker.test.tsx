import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { AssignmentSummary } from '../shared/contracts'
import { AssignmentPicker } from '../src/components/AssignmentPicker'

const assignments: AssignmentSummary[] = [
  {
    id: 'python-average',
    title: '平均分函数',
    module: 'Python 基础',
    language: 'python',
    questionType: 'code',
    estimatedMinutes: 12,
    status: 'ready'
  },
  {
    id: 'choice-algebra-simplify',
    title: '代数式化简',
    module: '数学 · 代数',
    language: 'math',
    questionType: 'choice',
    estimatedMinutes: 5,
    status: 'ready'
  },
  {
    id: 'expression-perfect-square',
    title: '完全平方展开',
    module: '数学 · 代数式',
    language: 'math',
    questionType: 'expression',
    estimatedMinutes: 8,
    status: 'ready'
  },
  {
    id: 'essay-perseverance-growth',
    title: '论坚持与成长',
    module: '语文 · 议论文',
    language: 'chinese',
    questionType: 'essay',
    estimatedMinutes: 30,
    status: 'coming-soon'
  }
]

describe('AssignmentPicker', () => {
  it('groups assignments by subject', () => {
    render(
      <AssignmentPicker
        assignments={assignments}
        activeId="python-average"
        disabled={false}
        onSelect={vi.fn()}
      />
    )

    expect(screen.getByRole('heading', { name: '编程' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '数学' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '语文' })).toBeInTheDocument()
  })

  it('tags each row with its question type', () => {
    render(
      <AssignmentPicker
        assignments={assignments}
        activeId="python-average"
        disabled={false}
        onSelect={vi.fn()}
      />
    )

    expect(screen.getByText('代码题')).toBeInTheDocument()
    expect(screen.getByText('选择题')).toBeInTheDocument()
    expect(screen.getByText('表达式题')).toBeInTheDocument()
    expect(screen.getByText('作文题')).toBeInTheDocument()
  })

  it('selects a ready assignment on click', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <AssignmentPicker
        assignments={assignments}
        activeId="python-average"
        disabled={false}
        onSelect={onSelect}
      />
    )

    await user.click(screen.getByText('代数式化简'))

    expect(onSelect).toHaveBeenCalledWith('choice-algebra-simplify')
  })

  it('disables coming-soon assignments', () => {
    render(
      <AssignmentPicker
        assignments={assignments}
        activeId="python-average"
        disabled={false}
        onSelect={vi.fn()}
      />
    )

    const comingSoon = screen.getByText('论坚持与成长').closest('button')
    expect(comingSoon).toBeDisabled()
    expect(screen.getByText('即将上线')).toBeInTheDocument()
  })

  it('marks the active assignment with aria-current', () => {
    render(
      <AssignmentPicker
        assignments={assignments}
        activeId="python-average"
        disabled={false}
        onSelect={vi.fn()}
      />
    )

    const activeRow = screen.getByText('平均分函数').closest('button')
    expect(activeRow).toHaveAttribute('aria-current', 'true')
  })

  it('disables all rows while a switch or evaluation is in flight', () => {
    render(
      <AssignmentPicker
        assignments={assignments}
        activeId="python-average"
        disabled
        onSelect={vi.fn()}
      />
    )

    const mathGroup = screen
      .getByRole('heading', { name: '数学' })
      .closest('.assignment-group')
    expect(mathGroup).not.toBeNull()
    if (mathGroup) {
      for (const button of within(mathGroup as HTMLElement).getAllByRole('button')) {
        expect(button).toBeDisabled()
      }
    }
  })
})
