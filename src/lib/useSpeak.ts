import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * On-demand TTS for any text (ADR-0005 §4-5).
 *
 * Extracted from VoiceCompanion's private `speak()` so the tutoring panels
 * can read diagnostic feedback on demand. Voice only ever READS text the
 * caller passes in - it never reads scores autonomously and never writes to
 * the scoring loop. Opt-in by design: nothing speaks until the caller invokes
 * `speak()`, so it never doubles up with a screen reader's own narration.
 *
 * Browser-native speechSynthesis only - no cloud TTS (minor audio privacy,
 * ADR-0005; lab-network resilience). Unsupported environments (jsdom, old
 * browsers) report `isSupported: false` and `speak` is a silent no-op.
 */

export interface UseSpeakResult {
  /** Currently speaking. */
  isSpeaking: boolean
  /** Browser exposes a usable speechSynthesis + utterance ctor. */
  isSupported: boolean
  /** Speak `text` (zh-CN). Cancels any in-flight utterance first. Empty = no-op. */
  speak: (text: string) => void
  /** Stop current utterance. */
  stop: () => void
}

interface WindowWithSpeechSynthesis extends Window {
  SpeechSynthesisUtterance?: new (text: string) => SpeechSynthesisUtterance
}

function isSpeechSupported(): boolean {
  if (typeof window === 'undefined') return false
  const speechWindow = window as WindowWithSpeechSynthesis
  return Boolean(
    window.speechSynthesis &&
      typeof window.speechSynthesis.speak === 'function' &&
      speechWindow.SpeechSynthesisUtterance !== undefined
  )
}

export function useSpeak(): UseSpeakResult {
  const [isSpeaking, setIsSpeaking] = useState(false)
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null)

  const finish = useCallback((): void => {
    utteranceRef.current = null
    setIsSpeaking(false)
  }, [])

  const stop = useCallback((): void => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel()
    }
    finish()
  }, [finish])

  const speak = useCallback(
    (text: string): void => {
      if (text.length === 0) return
      if (typeof window === 'undefined') return
      const synth = window.speechSynthesis
      const speechWindow = window as WindowWithSpeechSynthesis
      const Utterance = speechWindow.SpeechSynthesisUtterance
      // Unsupported environment: silent no-op (TTS is an enhancement).
      if (!synth || typeof synth.speak !== 'function' || Utterance === undefined) {
        return
      }
      // Replace any in-flight utterance before starting the new one.
      synth.cancel()
      const utterance = new Utterance(text)
      utterance.lang = 'zh-CN'
      utterance.onend = finish
      utterance.onerror = finish
      utteranceRef.current = utterance
      synth.speak(utterance)
      setIsSpeaking(true)
    },
    [finish]
  )

  // Cancel any pending speech on unmount so it does not bleed past the hook.
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel()
      }
    }
  }, [])

  return {
    isSpeaking,
    isSupported: isSpeechSupported(),
    speak,
    stop
  }
}
