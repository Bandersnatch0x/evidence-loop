import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { EvaluationResult } from '../shared/contracts'
import { DEFAULT_EVIDENCE_PROVENANCE } from '../shared/contracts'
import { EvidenceFlowDiagram } from '../src/components/evidenceFlow'

function buildEvaluation(overrides: Partial<EvaluationResult> = {}): EvaluationResult {
  return {
    id: 'eval-flow',
    assignmentId: 'python-average',
    attempt: 1,
    createdAt: '2026-08-08T08:00:00.000Z',
    status: 'completed',
    score: 67,
    summary: '空序列边界未处理拉低正确性维度。',
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
        source: 'test_case'
      },
      {
        id: 'normal-input',
        kind: 'test',
        label: '正常输入',
        dimensionId: 'correctness',
        visibility: 'public',
        state: 'passed',
        weight: 30,
        message: '正常列表计算正确',
        source: 'test_case'
      }
    ],
    dimensions: [
      {
        id: 'correctness',
        label: '功能正确性',
        description: '测试结果',
        maxScore: 60,
        earnedScore: 30,
        state: 'failed',
        evidenceIds: ['empty-input', 'normal-input']
      }
    ],
    diagnoses: [],
    trace: [],
    mastery: [],
    feedbackSource: 'local-policy',
    provenance: DEFAULT_EVIDENCE_PROVENANCE,
    ...overrides
  }
}

describe('EvidenceFlowDiagram (P2-2)', () => {
  it('renders one node per evidence item with label and weight contribution', () => {
    render(<EvidenceFlowDiagram evaluation={buildEvaluation()} />)

    expect(screen.getByText('空序列边界')).toBeInTheDocument()
    expect(screen.getByText('正常输入')).toBeInTheDocument()
    // passed evidence shows +weight, failed shows 0
    expect(screen.getByText('+30')).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
  })

  it('marks evidence nodes with their result state class', () => {
    const { container } = render(<EvidenceFlowDiagram evaluation={buildEvaluation()} />)
    const failedNode = screen.getByText('空序列边界').closest('.flow-node')
    const passedNode = screen.getByText('正常输入').closest('.flow-node')

    expect(failedNode).toHaveClass('is-failed')
    expect(passedNode).toHaveClass('is-passed')
    // sanity: the container is the figure
    expect(container.querySelector('.evidence-flow')).toHaveAttribute('role', 'figure')
  })

  it('renders dimension nodes with earned / max scores', () => {
    render(<EvidenceFlowDiagram evaluation={buildEvaluation()} />)

    expect(screen.getByText('功能正确性')).toBeInTheDocument()
    expect(screen.getByText('30/60')).toBeInTheDocument()
  })

  it('renders the final total score', () => {
    render(<EvidenceFlowDiagram evaluation={buildEvaluation()} />)

    expect(screen.getByText('67')).toBeInTheDocument()
    expect(screen.getByText('/ 100')).toBeInTheDocument()
  })

  it('exposes the flow as a labelled figure for assistive tech', () => {
    render(<EvidenceFlowDiagram evaluation={buildEvaluation()} />)

    const figure = screen.getByRole('figure')
    expect(figure).toHaveAttribute('aria-label')
    expect(figure.getAttribute('aria-label')).toContain('2')
    expect(figure.getAttribute('aria-label')).toContain('67')
  })

  it('renders gracefully when there is no evidence', () => {
    render(
      <EvidenceFlowDiagram
        evaluation={buildEvaluation({ evidence: [], dimensions: [], score: 0 })}
      />
    )

    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getByText('/ 100')).toBeInTheDocument()
  })
})
