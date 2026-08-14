/**
 * ParentOverviewView — 家长端只读视图（决赛加码）。
 * 只拉 /api/parent/reports/weekly；渲染与教师/学生同源的章节组件。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ParentOverviewView } from '../src/components/parent/ParentOverviewView'
import type { WeeklyReportResponse } from '../src/components/reports/weeklyReportApi'
import type {
  WeeklyReportEvidenceRef,
  WeeklyReportMetric,
  WeeklyReportSection,
  WeeklyReportStatus
} from '../shared/weeklyReport'

vi.mock('../src/components/reports/weeklyReportApi', () => ({
  getParentWeeklyReport: vi.fn()
}))

import { getParentWeeklyReport } from '../src/components/reports/weeklyReportApi'

const evidenceRef: WeeklyReportEvidenceRef = {
  kind: 'attempt',
  attemptId: 'att-1',
  evaluationId: 'ev-1',
  questionId: 'q1',
  mode: 'assessment',
  createdAt: '2026-08-10T08:00:00.000Z',
  score: 85
}

const metric: WeeklyReportMetric = {
  id: 'completion.attempts',
  label: '答题数',
  value: 4,
  unit: '次',
  evidenceRefs: [evidenceRef]
}

const section: WeeklyReportSection = {
  id: 'completion',
  title: '完成度',
  layer: 'evidence',
  status: 'ok',
  metrics: [metric],
  items: []
}

const status: WeeklyReportStatus = 'ok'

const mockResponse: WeeklyReportResponse = {
  report: {
    id: 'wr-1',
    studentId: 'learner-demo',
    displayName: 'learner-demo',
    teachingUnitId: 'tu-demo',
    termId: 'term-demo',
    algorithm: 'weekly.v1',
    generatedAt: '2026-08-14T00:00:00.000Z',
    status,
    window: { from: '2026-08-07T00:00:00.000Z', to: '2026-08-14T00:00:00.000Z' },
    evidenceRefs: [evidenceRef],
    sections: [section]
  },
  sectionOrder: ['completion'],
  evidenceCount: 1
}

describe('ParentOverviewView', () => {
  beforeEach(() => {
    vi.mocked(getParentWeeklyReport).mockResolvedValue(mockResponse)
  })

  it('只读视图加载并渲染绑定子女周报', async () => {
    render(
      <ParentOverviewView childStudentId="learner-demo" teachingUnitId="tu-demo" />
    )
    expect(
      await screen.findByRole('heading', { name: /家长视图/ })
    ).toBeInTheDocument()
    expect((await screen.findAllByText(/learner-demo/)).length).toBeGreaterThan(0)
    expect(getParentWeeklyReport).toHaveBeenCalledWith({
      studentId: 'learner-demo',
      teachingUnitId: 'tu-demo'
    })
    expect((await screen.findAllByText(/1 条证据锚点/)).length).toBeGreaterThanOrEqual(1)
    // 复用与教师/学生同源的章节渲染：数字章节出现。
    expect(await screen.findByText('答题数')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull() // 家长端无任何按钮
  })

  it('加载失败显示错误横幅', async () => {
    vi.mocked(getParentWeeklyReport).mockRejectedValue(
      new Error('Forbidden: parent is not bound to this student')
    )
    render(
      <ParentOverviewView childStudentId="learner-demo" teachingUnitId="tu-demo" />
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Forbidden: parent is not bound/
    )
  })
})
