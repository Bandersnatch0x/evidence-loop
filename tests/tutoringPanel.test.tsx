import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TutoringPanel } from '../src/components/tutoring'
import { ExplainPanel } from '../src/components/tutoring/ExplainPanel'
import { AiInferenceBadge } from '../src/components/tutoring/AiInferenceBadge'
import type { TutoringMessage } from '../shared/contracts'

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

/** jsdom has no speechSynthesis; stub the TTS surface useSpeak touches. */
function installSynthFakes(): void {
  class FakeUtterance {
    public lang = ''
    public onend: (() => void) | null = null
    public onerror: (() => void) | null = null
    public constructor(public text: string) {}
  }
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
  vi.stubGlobal('speechSynthesis', { speak: vi.fn(), cancel: vi.fn() })
}

const sampleExplainMessage: TutoringMessage = {
  id: 'm1',
  layer: 'explain',
  role: 'assistant',
  content: '空列表边界未返回约定结果，导致索引 0 读取失败。',
  provenance: {
    kind: 'llm_inference',
    sourceMessages: [],
    model: 'demo',
    extractedAt: '2026-01-01T00:00:00.000Z'
  },
  source: 'llm',
  createdAt: '2026-01-01T00:00:00.000Z'
}

describe('ExplainPanel 朗读按钮 (P0 useSpeak)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('shows 朗读讲解 button when speechSynthesis is supported and message exists', () => {
    installSynthFakes()
    render(<ExplainPanel message={sampleExplainMessage} onRequest={vi.fn()} />)

    expect(
      screen.getByRole('button', { name: '朗读讲解' })
    ).toBeInTheDocument()
  })

  it('hides the speak button when speechSynthesis is unsupported', () => {
    // No installSynthFakes -> isSupported is false -> button hidden.
    render(<ExplainPanel message={sampleExplainMessage} onRequest={vi.fn()} />)

    expect(screen.queryByRole('button', { name: '朗读讲解' })).toBeNull()
  })

  it('hides the speak button when there is no message yet', () => {
    installSynthFakes()
    render(<ExplainPanel onRequest={vi.fn()} />)

    expect(screen.queryByRole('button', { name: '朗读讲解' })).toBeNull()
  })
})
