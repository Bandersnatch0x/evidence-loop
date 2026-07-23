import {
  act,
  render,
  renderHook,
  screen,
  waitFor
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VoiceCompanion } from '../src/components/VoiceCompanion'
import { useVoiceSession } from '../src/components/VoiceCompanion/useVoiceSession'

interface FakeRecognitionEvent {
  readonly resultIndex: number
  readonly results: Array<Array<{ transcript: string }>>
}

/**
 * jsdom ships no Web Speech API. Stub the minimal surface useVoiceSession
 * touches: a SpeechRecognition whose stop() immediately emits a final result,
 * and a speechSynthesis whose speak() fires onend synchronously.
 */
function installSpeechFakes(): void {
  class FakeRecognition {
    public lang = ''
    public continuous = false
    public interimResults = false
    public onresult: ((event: FakeRecognitionEvent) => void) | null = null
    public onerror: ((event: { error: string }) => void) | null = null
    public onend: (() => void) | null = null
    public start(): void {}
    public stop(): void {
      this.onresult?.({
        resultIndex: 0,
        results: [[{ transcript: '帮我看看这道题' }]]
      })
      this.onend?.()
    }
  }

  class FakeUtterance {
    public lang = ''
    public onend: (() => void) | null = null
    public onerror: (() => void) | null = null
    public constructor(public text: string) {}
  }

  const synth = {
    speak: (utterance: FakeUtterance): void => {
      utterance.onend?.()
    },
    cancel: (): void => {}
  }

  vi.stubGlobal('SpeechRecognition', FakeRecognition)
  vi.stubGlobal('webkitSpeechRecognition', FakeRecognition)
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
  vi.stubGlobal('speechSynthesis', synth)
}

describe('VoiceCompanion', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders a FAB when closed and opens the drawer on click', () => {
    const onOpenChange = vi.fn()
    render(<VoiceCompanion open={false} onOpenChange={onOpenChange} />)

    expect(screen.getByRole('button', { name: '打开语音辅导' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '按住说话' })).toBeNull()

    screen.getByRole('button', { name: '打开语音辅导' }).click()
    expect(onOpenChange).toHaveBeenCalledWith(true)
  })

  it('renders an idle push-to-talk button when open, disabled without SpeechRecognition', () => {
    render(<VoiceCompanion open onOpenChange={vi.fn()} />)

    expect(screen.getByRole('button', { name: '按住说话' })).toBeDisabled()
    expect(screen.getByText('待命')).toBeInTheDocument()
    expect(screen.getByText(/当前浏览器不支持语音识别/)).toBeInTheDocument()
  })

  it('enables the button when SpeechRecognition is available', () => {
    installSpeechFakes()
    render(<VoiceCompanion open onOpenChange={vi.fn()} />)

    expect(screen.getByRole('button', { name: '按住说话' })).toBeEnabled()
  })

  it('closes via the header close control', () => {
    const onOpenChange = vi.fn()
    render(<VoiceCompanion open onOpenChange={onOpenChange} />)

    screen.getByRole('button', { name: '关闭语音辅导抽屉' }).click()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

describe('useVoiceSession', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('runs the ask pipeline and dispatches a highlight after push-to-talk', async () => {
    installSpeechFakes()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => ({
          llmOutput: '讲解正文[HIGHLIGHT:selector="[data-evidence-id="demo-1"]"]'
        })
      })
    )
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

    const { result } = renderHook(() => useVoiceSession())
    expect(result.current.isSpeechRecognitionSupported).toBe(true)

    act(() => {
      result.current.startRecording()
    })
    expect(result.current.state).toBe('recording')

    await act(async () => {
      result.current.stopRecording()
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(result.current.state).toBe('idle')
    })

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'multimodal:highlight' })
    )
    expect(result.current.reply).toContain('讲解正文')
  })
})
