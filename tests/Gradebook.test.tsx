import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GradingQueueItem } from '../shared/contracts'
import { Gradebook } from '../src/components/teacher/Gradebook'
import * as api from '../src/lib/api'

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual('../src/lib/api')
  return {
    ...(actual as object),
    getGradingQueue: vi.fn(),
    gradeSubjective: vi.fn()
  }
})

const pendingItem: GradingQueueItem = {
  attemptId: 'att-essay-1',
  studentId: 'learner-demo',
  questionId: 'seed:essay-perseverance-growth',
  teachingUnitId: 'tu-demo',
  stem: '以「坚持」为题写一篇议论文',
  submittedAt: '2026-07-24T08:00:00.000Z',
  objectiveScore: 40,
  objectiveMaxScore: 100,
  advisory: [
    {
      id: 'adv-1',
      dimensionLabel: '立意',
      suggestion: '建议深化论点',
      provenance: {
        kind: 'llm_inference',
        sourceMessages: ['建议深化论点'],
        model: 'rule-based',
        extractedAt: '2026-07-24T08:00:00.000Z'
      },
      requiresTeacherConfirmation: true
    }
  ],
  submissionText: '坚持就是胜利……'
}

describe('Gradebook (T08 主观题终裁)', () => {
  beforeEach(() => {
    vi.mocked(api.getGradingQueue).mockResolvedValue([pendingItem])
    vi.mocked(api.gradeSubjective).mockResolvedValue({
      attemptId: 'att-essay-1',
      teacherAnnotation: {
        teacherId: 'teacher-demo',
        subjectiveScore: 8,
        subjectiveMaxScore: 10,
        note: '立意深刻，论证可加强',
        adjudicatedAt: '2026-07-24T09:00:00.000Z'
      }
    })
  })

  it('shows AI 推断 badge and objective layer separately', async () => {
    render(<Gradebook teachingUnitId="tu-demo" />)

    await waitFor(() => {
      expect(screen.getByText(/以「坚持」为题/)).toBeTruthy()
    })

    expect(screen.getByText(/AI 推断/)).toBeTruthy()
    expect(screen.getByText(/建议深化论点/)).toBeTruthy()
    expect(screen.getByText(/自动评分 40 \/ 100/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /提交终裁/ })).toBeTruthy()
  })

  it('after grade, flips row to 教师终裁 without requiring reload', async () => {
    const user = userEvent.setup()
    render(<Gradebook teachingUnitId="tu-demo" />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /提交终裁/ })).toBeTruthy()
    })

    await user.type(screen.getByLabelText('主观分'), '8')
    await user.clear(screen.getByLabelText('主观满分'))
    await user.type(screen.getByLabelText('主观满分'), '20')
    await user.type(screen.getByLabelText('批改说明'), '立意深刻，论证可加强')
    await user.click(screen.getByRole('button', { name: /提交终裁/ }))

    await waitFor(() => {
      expect(screen.getByText(/教师终裁/)).toBeTruthy()
    })
    expect(screen.getByText(/立意深刻，论证可加强/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /提交终裁/ })).toBeNull()
    expect(api.gradeSubjective).toHaveBeenCalledWith('att-essay-1', {
      subjectiveScore: 8,
      subjectiveMaxScore: 20,
      note: '立意深刻，论证可加强'
    })
  })
})
