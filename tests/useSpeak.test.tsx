import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSpeak } from '../src/lib/useSpeak'

/**
 * Minimal speechSynthesis stub for jsdom (which ships no Web Speech API).
 * Mirrors the installSpeechFakes pattern from VoiceCompanion.test.tsx but
 * only stubs the TTS surface (useSpeak has no STT). onend is NOT auto-fired
 * so tests can assert the mid-speak `isSpeaking` state, then end it manually.
 */
interface FakeUtterance {
  text: string
  lang: string
  onend: (() => void) | null
  onerror: (() => void) | null
}

function installSynthFakes(): {
  speakSpy: ReturnType<typeof vi.fn>
  cancelSpy: ReturnType<typeof vi.fn>
  lastUtterance: () => FakeUtterance | undefined
} {
  const created: FakeUtterance[] = []

  class FakeUtteranceImpl {
    public lang = ''
    public onend: (() => void) | null = null
    public onerror: (() => void) | null = null
    public constructor(public text: string) {
      created.push(this)
    }
  }

  const speakSpy = vi.fn()
  const cancelSpy = vi.fn()
  const synth = { speak: speakSpy, cancel: cancelSpy }

  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtteranceImpl)
  vi.stubGlobal('speechSynthesis', synth)

  return {
    speakSpy,
    cancelSpy,
    lastUtterance: () => created[created.length - 1]
  }
}

describe('useSpeak', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('reports unsupported and is a no-op without speechSynthesis', () => {
    const { result } = renderHook(() => useSpeak())

    expect(result.current.isSupported).toBe(false)
    expect(() => {
      act(() => {
        result.current.speak('hello')
      })
    }).not.toThrow()
    expect(result.current.isSpeaking).toBe(false)
  })

  it('speaks text with zh-CN and flips isSpeaking true', () => {
    const { speakSpy, lastUtterance } = installSynthFakes()
    const { result } = renderHook(() => useSpeak())

    act(() => {
      result.current.speak('空列表边界未处理')
    })

    expect(speakSpy).toHaveBeenCalledTimes(1)
    expect(lastUtterance()?.text).toBe('空列表边界未处理')
    expect(lastUtterance()?.lang).toBe('zh-CN')
    expect(result.current.isSpeaking).toBe(true)
  })

  it('returns to idle after the utterance ends', () => {
    const { lastUtterance } = installSynthFakes()
    const { result } = renderHook(() => useSpeak())

    act(() => {
      result.current.speak('讲解正文')
    })
    expect(result.current.isSpeaking).toBe(true)

    act(() => {
      lastUtterance()?.onend?.()
    })
    expect(result.current.isSpeaking).toBe(false)
  })

  it('stop() cancels synthesis and clears isSpeaking', () => {
    const { cancelSpy } = installSynthFakes()
    const { result } = renderHook(() => useSpeak())

    act(() => {
      result.current.speak('讲解正文')
    })
    expect(result.current.isSpeaking).toBe(true)

    act(() => {
      result.current.stop()
    })
    expect(cancelSpy).toHaveBeenCalled()
    expect(result.current.isSpeaking).toBe(false)
  })

  it('treats empty text as a no-op', () => {
    const { speakSpy } = installSynthFakes()
    const { result } = renderHook(() => useSpeak())

    act(() => {
      result.current.speak('')
    })
    expect(speakSpy).not.toHaveBeenCalled()
    expect(result.current.isSpeaking).toBe(false)
  })

  it('cancels ongoing synthesis on unmount', () => {
    const { cancelSpy } = installSynthFakes()
    const { result, unmount } = renderHook(() => useSpeak())

    act(() => {
      result.current.speak('讲解正文')
    })
    unmount()

    expect(cancelSpy).toHaveBeenCalled()
  })
})
