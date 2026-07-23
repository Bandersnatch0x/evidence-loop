import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TraceStep } from '../shared/contracts'
import { PipelineBar } from '../src/components/PipelineBar'

function mockMatchMedia(matches: boolean) {
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
  return mediaQueryList
}

describe('PipelineBar', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('renders five workflow steps while idle without matchMedia', () => {
    // jsdom may not implement matchMedia; the component must stay safe.
    // @ts-expect-error intentional missing browser API
    delete window.matchMedia

    render(<PipelineBar isEvaluating={false} />)

    expect(screen.getByLabelText('评估流程')).toBeInTheDocument()
    expect(screen.getByLabelText('读取任务：待执行')).toBeInTheDocument()
    expect(screen.getByLabelText('受限运行：待执行')).toBeInTheDocument()
    expect(screen.getByLabelText('量规评分：待执行')).toBeInTheDocument()
    expect(screen.getByLabelText('知识匹配：待执行')).toBeInTheDocument()
    expect(screen.getByLabelText('反馈生成：待执行')).toBeInTheDocument()
    expect(
      screen.getByText('提交代码后，五步流程将依次执行')
    ).toBeInTheDocument()
  })

  it('animates active steps when reduced motion is not preferred', () => {
    mockMatchMedia(false)

    render(<PipelineBar isEvaluating />)

    expect(screen.getByLabelText('读取任务：执行中')).toBeInTheDocument()
    expect(screen.getByLabelText('受限运行：待执行')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(620)
    })

    expect(screen.getByLabelText('读取任务：完成')).toBeInTheDocument()
    expect(screen.getByLabelText('受限运行：执行中')).toBeInTheDocument()
  })

  it('jumps to the final step when reduced motion is preferred', () => {
    mockMatchMedia(true)

    render(<PipelineBar isEvaluating />)

    expect(screen.getByLabelText('反馈生成：执行中')).toBeInTheDocument()
    expect(screen.getByLabelText('读取任务：完成')).toBeInTheDocument()
    expect(screen.getByLabelText('受限运行：完成')).toBeInTheDocument()
    expect(screen.getByLabelText('量规评分：完成')).toBeInTheDocument()
    expect(screen.getByLabelText('知识匹配：完成')).toBeInTheDocument()
  })

  it('prefers trace status over animated progress', () => {
    mockMatchMedia(false)
    const trace: TraceStep[] = [
      {
        id: 'retrieve-assignment',
        label: '读取任务',
        tool: 'assignment.retrieve',
        status: 'completed',
        summary: 'ok',
        durationMs: 12
      },
      {
        id: 'run-submission',
        label: '受限运行',
        tool: 'python.safe-runner',
        status: 'failed',
        summary: 'error',
        durationMs: 30
      }
    ]

    render(<PipelineBar isEvaluating={false} trace={trace} />)

    expect(screen.getByLabelText('读取任务：完成')).toBeInTheDocument()
    expect(screen.getByText('完成 · 12 ms')).toBeInTheDocument()
    expect(screen.getByLabelText('受限运行：失败')).toBeInTheDocument()
    expect(screen.getByLabelText('量规评分：待执行')).toBeInTheDocument()
  })
})
