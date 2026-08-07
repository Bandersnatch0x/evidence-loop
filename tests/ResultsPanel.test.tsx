import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EvaluationResult } from '../shared/contracts'
import { ResultsPanel } from '../src/components/ResultsPanel'

function mockMatchMedia(matches: boolean): void {
  const mediaQueryList = {
    matches,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  }
  window.matchMedia = vi.fn().mockReturnValue(mediaQueryList)
}

function makeEvaluation(
  overrides: Partial<EvaluationResult> = {}
): EvaluationResult {
  const evidence = Array.from({ length: 8 }, (_, i) => ({
    id: `e${i + 1}`,
    kind: 'test' as const,
    label: `测试 ${i + 1}`,
    dimensionId: 'd1',
    visibility: 'public' as const,
    state: 'passed' as const,
    weight: 10,
    message: 'ok',
    source: 'test_case' as const
  }))
  return {
    id: 'eval-1',
    assignmentId: 'asg-1',
    attempt: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'completed',
    score: 100,
    previousScore: 80,
    scoreDelta: 20,
    summary: '全部通过',
    evidence,
    dimensions: [],
    diagnoses: [],
    trace: [],
    mastery: [],
    feedbackSource: 'local-policy',
    provenance: {
      kind: 'evidence',
      evidenceIds: ['e1'],
      algorithm: 'simple.v1'
    },
    ...overrides
  }
}

describe('ResultsPanel 证据计分板动画 (P0-2)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('reduced-motion 时立即显示最终分数与全部证据', () => {
    mockMatchMedia(true)
    render(<ResultsPanel evaluation={makeEvaluation()} history={[]} onApplyRepair={vi.fn()} />)

    expect(screen.getByTestId('evaluation-score')).toHaveTextContent(/^100$/)
    expect(document.querySelectorAll('.evidence-row')).toHaveLength(8)
  })

  it('动画从 previousScore 开始，逐步点亮证据并滚动分数', () => {
    mockMatchMedia(false)
    render(<ResultsPanel evaluation={makeEvaluation()} history={[]} onApplyRepair={vi.fn()} />)

    // 初始：分数=previousScore(80)，证据 0 条
    expect(screen.getByTestId('evaluation-score')).toHaveTextContent(/^80$/)
    expect(document.querySelectorAll('.evidence-row')).toHaveLength(0)

    // 推进一个间隔：1 条证据点亮
    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(document.querySelectorAll('.evidence-row')).toHaveLength(1)

    // 推进到结束：8 条，分数=100
    act(() => {
      vi.advanceTimersByTime(400 * 8)
    })
    expect(document.querySelectorAll('.evidence-row')).toHaveLength(8)
    expect(screen.getByTestId('evaluation-score')).toHaveTextContent(/^100$/)
  })

  it('无 previousScore 时从 0 开始动画', () => {
    mockMatchMedia(false)
    render(
      <ResultsPanel
        evaluation={makeEvaluation({ previousScore: undefined, score: 60 })}
        history={[]}
        onApplyRepair={vi.fn()}
      />
    )

    expect(screen.getByTestId('evaluation-score')).toHaveTextContent(/^0$/)
    act(() => {
      vi.advanceTimersByTime(400 * 8)
    })
    expect(screen.getByTestId('evaluation-score')).toHaveTextContent(/^60$/)
  })
})
