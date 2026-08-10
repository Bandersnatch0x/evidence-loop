import type { ComponentType } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { MockExamPlan } from '../shared/mockExam'
import { StudentPlanHub } from '../src/components/effort2/StudentPlanHub'

vi.mock('../src/components/achievements', () => ({
  AchievementWall: () => <div />
}))
vi.mock('../src/components/dialogue', () => ({
  PersonaDialoguePanel: () => <div />
}))
vi.mock('../src/components/portfolio', () => ({
  PortfolioExportPanel: () => <div />
}))
vi.mock('../src/components/reports', () => ({
  StudentWeeklyReportView: () => <div />
}))
vi.mock('../src/components/studyPlan', () => ({
  StudyPlanTimeline: () => <div />
}))

const plan: MockExamPlan = {
  id: 'plan-real',
  creatorId: 'teacher-demo',
  classId: 'class-demo',
  teachingUnitIds: ['tu-demo'],
  title: '真实已布置模拟考',
  durationMinutes: 45,
  questionIds: ['q-1'],
  kpCoverage: [],
  status: 'assigned',
  algorithm: 'mockexam.manual.v1',
  createdAt: '2026-08-07T09:00:00.000Z',
  paperId: 'paper-real',
  assignedAt: '2026-08-07T09:00:00.000Z'
}

describe('StudentPlanHub mock exam entry', () => {
  it('loads assigned plans and forwards start to the parent workflow', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ plans: [plan] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )
    )
    const onStartMockExam = vi.fn()
    const Hub = StudentPlanHub as ComponentType<{
      onStartMockExam: (paperId: string) => void
    }>
    render(<Hub onStartMockExam={onStartMockExam} />)

    await userEvent.click(
      await screen.findByRole('button', { name: '开始作答' })
    )

    expect(screen.getByText('真实已布置模拟考')).toBeInTheDocument()
    expect(onStartMockExam).toHaveBeenCalledWith('paper-real')
    vi.unstubAllGlobals()
  })
})
