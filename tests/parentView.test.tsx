/**
 * ParentOverviewView — 家长端只读视图（决赛加码）。
 * 先拉 /api/parent/children 绑定，再拉选中子女的 /api/parent/reports/weekly。
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
  getParentChildren: vi.fn(),
  getParentWeeklyReport: vi.fn()
}))

import {
  getParentChildren,
  getParentWeeklyReport
} from '../src/components/reports/weeklyReportApi'

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

function makeResponse(studentId: string): WeeklyReportResponse {
  return {
    report: {
      id: `wr-${studentId}`,
      studentId,
      displayName: studentId,
      teachingUnitId: 'tu-demo',
      termId: 'term-demo',
      algorithm: 'weekly.v1',
      generatedAt: '2026-08-14T00:00:00.000Z',
      status,
      window: {
        from: '2026-08-07T00:00:00.000Z',
        to: '2026-08-14T00:00:00.000Z'
      },
      evidenceRefs: [evidenceRef],
      sections: [section]
    },
    sectionOrder: ['completion'],
    evidenceCount: 1
  }
}

describe('ParentOverviewView', () => {
  beforeEach(() => {
    vi.mocked(getParentChildren).mockResolvedValue(['learner-demo'])
    vi.mocked(getParentWeeklyReport).mockResolvedValue(
      makeResponse('learner-demo')
    )
  })

  it('按绑定列表渲染子女周报（DB 绑定驱动）', async () => {
    render(<ParentOverviewView teachingUnitId="tu-demo" />)
    expect(
      await screen.findByRole('heading', { name: /家长视图/ })
    ).toBeInTheDocument()
    // 先等周报渲染完成（子女绑定 → 周报两个异步阶段）。
    expect(await screen.findByText('答题数')).toBeInTheDocument()
    expect(getParentChildren).toHaveBeenCalledTimes(1)
    expect(getParentWeeklyReport).toHaveBeenCalledWith({
      studentId: 'learner-demo',
      teachingUnitId: 'tu-demo'
    })
    expect((await screen.findAllByText(/1 条证据锚点/)).length).toBeGreaterThanOrEqual(1)
    // 家长端无任何按钮（多子女 tab 只在该情形出现）。
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('多子女时渲染切换 tab', async () => {
    vi.mocked(getParentChildren).mockResolvedValue(['learner-a', 'learner-b'])
    vi.mocked(getParentWeeklyReport).mockResolvedValue(makeResponse('learner-a'))
    render(<ParentOverviewView teachingUnitId="tu-demo" />)
    expect(await screen.findByRole('button', { name: 'learner-a' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'learner-b' })).toBeInTheDocument()
  })

  it('无绑定子女显示空态', async () => {
    vi.mocked(getParentChildren).mockResolvedValue([])
    render(<ParentOverviewView teachingUnitId="tu-demo" />)
    expect(await screen.findByText(/尚未绑定子女/)).toBeInTheDocument()
  })

  it('加载失败显示错误横幅', async () => {
    vi.mocked(getParentChildren).mockRejectedValue(
      new Error('Forbidden: only parent sessions may list bound children')
    )
    render(<ParentOverviewView teachingUnitId="tu-demo" />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Forbidden: only parent sessions/
    )
  })
})
