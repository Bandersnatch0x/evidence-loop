import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MistakeBookView } from '../shared/contracts'
import { MistakeBook } from '../src/components/student/MistakeBook'
import * as api from '../src/lib/api'

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual('../src/lib/api')
  return {
    ...(actual as object),
    getMistakeBook: vi.fn()
  }
})

const book: MistakeBookView = {
  studentId: 'stu-1',
  activeCount: 1,
  masteredCount: 1,
  entries: [
    {
      questionId: 'assign-boundary-bug',
      teachingUnitId: 'tu-demo',
      subject: 'math',
      kpIds: ['kp-1'],
      attemptId: 'att-1',
      lastScore: 40,
      lastActiveAt: '2026-07-24T00:00:00.000Z',
      consecutiveAssessmentPasses: 0,
      mastered: false
    },
    {
      questionId: 'assign-mastered',
      teachingUnitId: 'tu-demo',
      subject: 'math',
      kpIds: ['kp-2'],
      attemptId: 'att-2',
      lastScore: 100,
      lastActiveAt: '2026-07-24T00:00:00.000Z',
      consecutiveAssessmentPasses: 2,
      mastered: true
    }
  ]
}

describe('MistakeBook (T07 重练)', () => {
  beforeEach(() => {
    vi.mocked(api.getMistakeBook).mockResolvedValue(book)
  })

  it('shows 重练 only on active entries and fires callback', async () => {
    const onRepractice = vi.fn()
    const user = userEvent.setup()
    render(
      <MistakeBook refreshKey={0} onRepractice={onRepractice} />
    )

    await waitFor(() => {
      expect(screen.getByText(/题 assign-boundary-bug/)).toBeTruthy()
    })

    const buttons = screen.getAllByRole('button', { name: /重练/ })
    expect(buttons).toHaveLength(1)

    const button = buttons[0]
    if (button === undefined) {
      throw new Error('expected repractice button')
    }

    await user.click(button)
    expect(onRepractice).toHaveBeenCalledWith('assign-boundary-bug')
  })

  it('hides 重练 when callback omitted', async () => {
    render(<MistakeBook refreshKey={0} />)
    await waitFor(() => {
      expect(screen.getByText(/活跃 1/)).toBeTruthy()
    })
    expect(screen.queryByRole('button', { name: /重练/ })).toBeNull()
  })
})
