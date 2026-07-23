import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { AdvisorySuggestion } from '../shared/contracts'
import { AdvisoryPanel } from '../src/components/AdvisoryPanel'

function makeSuggestion(overrides: Partial<AdvisorySuggestion> = {}): AdvisorySuggestion {
  return {
    id: 'advisory-0-thesis',
    dimensionLabel: '立意与观点',
    suggestion: '建议在开头亮明中心论点。',
    provenance: {
      kind: 'llm_inference',
      sourceMessages: ['建议在开头亮明中心论点。'],
      model: 'advisory-rules.v1',
      extractedAt: '2026-07-23T00:00:00.000Z',
      confidence: 0.4
    },
    requiresTeacherConfirmation: true,
    ...overrides
  }
}

describe('AdvisoryPanel', () => {
  it('renders nothing when there are no suggestions', () => {
    const { container } = render(<AdvisoryPanel suggestions={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('labels the section as AI advice that does not enter the score', () => {
    render(<AdvisoryPanel suggestions={[makeSuggestion()]} />)

    expect(
      screen.getByText('AI 建议 · 需教师确认 · 不计入分数')
    ).toBeInTheDocument()
  })

  it('renders each suggestion with its dimension and llm_inference model tag', () => {
    render(
      <AdvisoryPanel
        suggestions={[
          makeSuggestion(),
          makeSuggestion({
            id: 'advisory-1-argument',
            dimensionLabel: '论证质量',
            suggestion: '补充数据或事例支撑论点。'
          })
        ]}
      />
    )

    expect(screen.getByText('立意与观点')).toBeInTheDocument()
    expect(screen.getByText('论证质量')).toBeInTheDocument()
    expect(screen.getByText('建议在开头亮明中心论点。')).toBeInTheDocument()
    expect(
      screen.getAllByText(/AI 推断 · advisory-rules\.v1/)
    ).toHaveLength(2)
  })

  it('states the teacher-confirmation gate on every item', () => {
    render(<AdvisoryPanel suggestions={[makeSuggestion()]} />)

    expect(screen.getByText('需教师确认后才可采纳')).toBeInTheDocument()
  })
})
