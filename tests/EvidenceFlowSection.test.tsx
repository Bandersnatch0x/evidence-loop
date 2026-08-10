import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EvaluationResult } from '../shared/contracts'
import { DEFAULT_EVIDENCE_PROVENANCE } from '../shared/contracts'

vi.mock('../src/lib/api', () => ({
  listEvaluations: vi.fn(),
  getEvaluation: vi.fn()
}))

import { listEvaluations, getEvaluation } from '../src/lib/api'
import { EvidenceFlowSection } from '../src/components/evidenceFlow'

const realEvaluation: EvaluationResult = {
  id: 'real-1',
  assignmentId: 'a1',
  attempt: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  status: 'completed',
  score: 90,
  summary: 'ok',
  evidence: [
    {
      id: 're1',
      kind: 'test',
      label: '真实证据标记',
      dimensionId: 'd1',
      visibility: 'public',
      state: 'passed',
      weight: 10,
      message: 'ok',
      source: 'test_case'
    }
  ],
  dimensions: [],
  diagnoses: [],
  trace: [],
  mastery: [],
  feedbackSource: 'local-policy',
  provenance: DEFAULT_EVIDENCE_PROVENANCE
}

describe('EvidenceFlowSection (P2-2 真实数据)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the latest real evaluation when available', async () => {
    vi.mocked(listEvaluations).mockResolvedValue([
      {
        id: 'real-1',
        assignmentId: 'a1',
        attempt: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        score: 90,
        status: 'completed'
      }
    ])
    vi.mocked(getEvaluation).mockResolvedValue(realEvaluation)

    render(<EvidenceFlowSection />)

    await waitFor(() =>
      expect(screen.getByText('真实证据标记')).toBeInTheDocument()
    )
  })

  it('falls back to the fixture when there are no evaluations', () => {
    vi.mocked(listEvaluations).mockResolvedValue([])

    render(<EvidenceFlowSection />)

    // fixture carries the "空序列边界" evidence label
    expect(screen.getByText('空序列边界')).toBeInTheDocument()
  })
})
