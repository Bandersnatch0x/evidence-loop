import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { QuestionCard, QuestionCardGrid } from '../src/components/questionCard'
import type { QuestionCardProps } from '../src/components/questionCard'

function buildCard(overrides: Partial<QuestionCardProps> = {}): QuestionCardProps {
  return {
    id: 'q-1',
    title: '边界条件诊断：平均分函数',
    kpTags: ['kp-empty-sequence', 'kp-loop'],
    difficulty: 3,
    openLabel: '开始练',
    onOpen: vi.fn(),
    ...overrides
  }
}

describe('QuestionCard (P1-1)', () => {
  it('renders title, knowledge-point tags and difficulty', () => {
    render(<QuestionCard {...buildCard()} />)

    expect(screen.getByText('边界条件诊断：平均分函数')).toBeInTheDocument()
    expect(screen.getByText('kp-empty-sequence')).toBeInTheDocument()
    expect(screen.getByText('kp-loop')).toBeInTheDocument()
    expect(screen.getByText(/难度/)).toHaveTextContent('难度 3')
  })

  it('renders a last-score color block tiered by score', () => {
    const { rerender } = render(<QuestionCard {...buildCard({ lastScore: 85 })} />)
    expect(screen.getByText('85')).toBeInTheDocument()
    expect(screen.getByText('85').closest('.score-chip')).toHaveClass('score-high')

    rerender(<QuestionCard {...buildCard({ lastScore: 65 })} />)
    expect(screen.getByText('65').closest('.score-chip')).toHaveClass('score-mid')

    rerender(<QuestionCard {...buildCard({ lastScore: 40 })} />)
    expect(screen.getByText('40').closest('.score-chip')).toHaveClass('score-low')
  })

  it('omits the last-score block when no score is available', () => {
    render(<QuestionCard {...buildCard()} />)
    expect(screen.queryByText(/上次得分/)).toBeNull()
  })

  it('fires onEvidence when the evidence link is clicked', () => {
    const onEvidence = vi.fn()
    render(
      <QuestionCard {...buildCard({ evidenceLabel: '查看上次证据', onEvidence })} />
    )
    fireEvent.click(screen.getByRole('button', { name: '查看上次证据' }))
    expect(onEvidence).toHaveBeenCalledTimes(1)
  })

  it('fires onOpen with its label', () => {
    const onOpen = vi.fn()
    render(<QuestionCard {...buildCard({ openLabel: '开始练', onOpen })} />)
    fireEvent.click(screen.getByRole('button', { name: '开始练' }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('renders footer actions when provided', () => {
    render(
      <QuestionCard
        {...buildCard({ footer: <button type="button">编辑</button> })}
      />
    )
    expect(screen.getByRole('button', { name: '编辑' })).toBeInTheDocument()
  })

  it('disables the primary action when openDisabled is true', () => {
    render(<QuestionCard {...buildCard({ openDisabled: true })} />)
    expect(screen.getByRole('button', { name: '开始练' })).toBeDisabled()
  })

  it('renders the evidence link only when both label and handler are provided', () => {
    const { rerender } = render(
      <QuestionCard {...buildCard({ evidenceLabel: '查看上次证据', onEvidence: vi.fn() })} />
    )
    expect(screen.getByRole('button', { name: '查看上次证据' })).toBeInTheDocument()

    // missing handler -> no link (caller omits it when no evidence exists)
    rerender(<QuestionCard {...buildCard({ evidenceLabel: '查看上次证据' })} />)
    expect(screen.queryByRole('button', { name: '查看上次证据' })).toBeNull()
  })
})

describe('QuestionCardGrid (P1-1)', () => {
  const cards: QuestionCardProps[] = [
    buildCard({ id: 'q-1', title: '平均分函数', kpTags: ['kp-empty', 'kp-loop'], difficulty: 3 }),
    buildCard({ id: 'q-2', title: '链表反转', kpTags: ['kp-loop'], difficulty: 5 }),
    buildCard({ id: 'q-3', title: '递归求和', kpTags: ['kp-recursion'], difficulty: 1 })
  ]

  it('renders every card by default', () => {
    render(<QuestionCardGrid cards={cards} />)
    expect(screen.getByText('平均分函数')).toBeInTheDocument()
    expect(screen.getByText('链表反转')).toBeInTheDocument()
    expect(screen.getByText('递归求和')).toBeInTheDocument()
  })

  it('builds knowledge-point filter chips from unique tags', () => {
    render(<QuestionCardGrid cards={cards} />)
    expect(screen.getByRole('button', { name: /kp-empty/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /kp-loop/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /kp-recursion/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /全部/ })).toBeInTheDocument()
  })

  it('filters cards to the selected knowledge point', () => {
    render(<QuestionCardGrid cards={cards} />)
    fireEvent.click(screen.getByRole('button', { name: /^kp-loop$/ }))

    // q-1 and q-2 share kp-loop; q-3 (kp-recursion) is hidden
    const visible = screen.getAllByRole('button', { name: '开始练' })
    expect(visible).toHaveLength(2)
  })

  it('filters cards by difficulty', () => {
    render(<QuestionCardGrid cards={cards} />)
    fireEvent.click(screen.getByRole('button', { name: /^难度 5$/ }))

    expect(screen.getAllByRole('button', { name: '开始练' })).toHaveLength(1)
  })

  it('resets the filter via the 全部 chip', () => {
    render(<QuestionCardGrid cards={cards} />)
    fireEvent.click(screen.getByRole('button', { name: /^kp-recursion$/ }))
    expect(screen.getAllByRole('button', { name: '开始练' })).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: /全部/ }))
    expect(screen.getAllByRole('button', { name: '开始练' })).toHaveLength(3)
  })

  it('shows an empty hint when no card matches the filter', () => {
    render(<QuestionCardGrid cards={cards} emptyHint="该筛选下暂无题目" />)
    fireEvent.click(screen.getByRole('button', { name: /^kp-recursion$/ }))
    // narrow further is not possible (single kp); instead pick a difficulty that
    // conflicts with kp-recursion (q-3 is difficulty 1) -> pick 5
    fireEvent.click(screen.getByRole('button', { name: /^难度 5$/ }))
    expect(screen.getByText('该筛选下暂无题目')).toBeInTheDocument()
  })

  it('exposes filter chips as focusable buttons', () => {
    render(<QuestionCardGrid cards={cards} />)
    const allChip = screen.getByRole('button', { name: /全部/ })
    expect(allChip.tagName).toBe('BUTTON')
  })
})
