import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TutoringPanel } from '../src/components/tutoring'
import { AiInferenceBadge } from '../src/components/tutoring/AiInferenceBadge'

describe('TutoringPanel UI (T05)', () => {
  it('renders three layers with grey AI 推断 badges', () => {
    render(
      <TutoringPanel
        attemptId="att-1"
        mode="practice"
        evaluationCompleted
      />
    )
    expect(screen.getByRole('heading', { name: 'AI 辅导' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '单向讲解' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '苏格拉底引导' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '追问对话' })).toBeInTheDocument()
    expect(screen.getAllByText(/AI 推断/).length).toBeGreaterThan(0)
    expect(screen.getByText(/练习/)).toBeInTheDocument()
  })

  it('closes socratic/dialogue in assessment mode (D1)', () => {
    render(
      <TutoringPanel
        attemptId="att-1"
        mode="assessment"
        evaluationCompleted
      />
    )
    expect(
      screen.getByText(/测评态关闭苏格拉底辅导/)
    ).toBeInTheDocument()
    expect(screen.getByText(/测评态关闭追问对话/)).toBeInTheDocument()
    // Explain remains available after completed assessment submit.
    expect(screen.getByRole('button', { name: /生成讲解/ })).toBeInTheDocument()
  })

  it('AiInferenceBadge shows model tag when provided', () => {
    render(<AiInferenceBadge model="deepseek:deepseek-chat" />)
    expect(
      screen.getByText('AI 推断 · deepseek:deepseek-chat')
    ).toBeInTheDocument()
  })
})
