import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  MathProblem,
  type MathProblemData
} from '../src/components/MathProblem'

const FIXTURE: MathProblemData[] = [
  {
    id: 'math-test',
    title: '测试题',
    prompt: '指出平方项',
    steps: [
      {
        id: 'math-test-step-1',
        label: '原式',
        latex: 'x^{2}+3',
        formula: 'x^2+3',
        speak: 'x 的平方加 3'
      },
      {
        id: 'math-test-step-2',
        label: '平方项',
        latex: 'x^{2}',
        formula: 'x^2',
        speak: 'x 的平方'
      }
    ]
  }
]

describe('MathProblem', () => {
  it('renders each step with data-katex-id anchors', () => {
    render(<MathProblem problems={FIXTURE} problemId="math-test" />)

    expect(screen.getByLabelText('测试题')).toBeInTheDocument()
    expect(screen.getByText('指出平方项')).toBeInTheDocument()

    const step1 = document.querySelector('[data-katex-id="math-test-step-1"]')
    const step2 = document.querySelector('[data-katex-id="math-test-step-2"]')
    expect(step1).not.toBeNull()
    expect(step2).not.toBeNull()
    expect(step1?.getAttribute('data-katex-formula')).toBe('x^2+3')
    expect(step2?.getAttribute('data-speak')).toBe('x 的平方')
  })

  it('renders KaTeX markup inside each step', () => {
    const { container } = render(
      <MathProblem problems={FIXTURE} problemId="math-test" />
    )
    // katex.renderToString wraps output in .katex
    expect(container.querySelectorAll('.katex').length).toBeGreaterThan(0)
  })
})
