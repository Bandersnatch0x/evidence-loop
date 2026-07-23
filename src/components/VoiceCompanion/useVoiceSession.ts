import { useCallback, useEffect, useRef, useState } from 'react'
import { parseDirectives } from '../../../shared/protocol/multimodalDirective'
import { dispatchDirectives } from '../../lib/directiveDispatcher'
import {
  purgeExpiredVoiceHistory,
  saveVoiceHistoryEntry
} from '../../lib/voiceHistoryStore'

/**
 * Local state machine for the multimodal voice loop (ADR-0005 §4):
 *   idle → recording → transcribing → llm-thinking → speaking → idle
 *
 * Push-to-talk: `startRecording` opens the mic, `stopRecording` closes it and,
 * once a final transcript lands, runs the ask → parse → TTS → highlight
 * pipeline. Voice only ever READS context and points at the DOM; it never
 * writes to the scoring loop (ADR-0005 §5). Highlight directives are published
 * as window `multimodal:highlight` events so <OverlayLayer> can render them
 * without either component importing the other.
 *
 * SPEAK/DISPLAY dual-channel math is handled by `dispatchDirectives`
 * (ticket 020): SPEAK feeds TTS; DISPLAY resolves `data-katex-id` anchors.
 *
 * Conversation history lives in IndexedDB with a 24h TTL (ADR-0005 §7).
 * Raw audio is never written — only transcript/reply text with expiresAt.
 */

export type VoiceSessionState =
  | 'idle'
  | 'recording'
  | 'transcribing'
  | 'llm-thinking'
  | 'speaking'

export interface UseVoiceSessionResult {
  state: VoiceSessionState
  transcript: string
  reply: string
  error: string | undefined
  isSpeechRecognitionSupported: boolean
  startRecording: () => void
  stopRecording: () => void
}

// Web Speech API is non-standard and has no lib.dom types; declare the minimal
// surface we use so the rest of the hook stays fully typed (no `any`).
interface SpeechRecognitionResultLike {
  readonly transcript: string
}
interface SpeechRecognitionEventLike {
  readonly resultIndex: number
  readonly results: ReadonlyArray<ReadonlyArray<SpeechRecognitionResultLike>>
}
interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike
interface WindowWithSpeechRecognition extends Window {
  SpeechRecognition?: SpeechRecognitionCtor
  webkitSpeechRecognition?: SpeechRecognitionCtor
  SpeechSynthesisUtterance?: new (text: string) => SpeechSynthesisUtterance
}

function resolveSpeechRecognition(): SpeechRecognitionCtor | undefined {
  if (typeof window === 'undefined') return undefined
  const speechWindow = window as WindowWithSpeechRecognition
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition
}

async function fetchMultimodalAsk(
  text: string,
  durationMs: number | undefined
): Promise<string> {
  const response = await fetch('/api/multimodal/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      text,
      ...(durationMs !== undefined ? { durationMs } : {})
    })
  })
  if (!response.ok) {
    throw new Error(`语音辅导请求失败（HTTP ${String(response.status)}）`)
  }
  const payload = (await response.json()) as { llmOutput: string }
  return payload.llmOutput
}

function speak(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (text.length === 0) {
      resolve()
      return
    }
    const synth = window.speechSynthesis
    const speechWindow = window as WindowWithSpeechRecognition
    const Utterance = speechWindow.SpeechSynthesisUtterance
    // jsdom and unsupported browsers expose no real synth; resolve immediately
    // so the loop still completes (TTS is a demo enhancement, not required).
    if (!synth || typeof synth.speak !== 'function' || Utterance === undefined) {
      resolve()
      return
    }
    const utterance = new Utterance(text)
    utterance.lang = 'zh-CN'
    utterance.onend = () => resolve()
    utterance.onerror = () => resolve()
    synth.speak(utterance)
  })
}

export function useVoiceSession(): UseVoiceSessionResult {
  const [state, setState] = useState<VoiceSessionState>('idle')
  const [transcript, setTranscript] = useState('')
  const [reply, setReply] = useState('')
  const [error, setError] = useState<string | undefined>()
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const finalTranscriptRef = useRef('')
  const recordingStartedAtRef = useRef<number | undefined>(undefined)

  // Startup + beforeunload: purge conversation rows past the 24h TTL.
  useEffect(() => {
    void purgeExpiredVoiceHistory().catch(() => {
      // IndexedDB may be unavailable (private mode / jsdom); ignore.
    })

    const onUnload = (): void => {
      void purgeExpiredVoiceHistory().catch(() => {
        // Best-effort cleanup on tab close.
      })
    }
    window.addEventListener('beforeunload', onUnload)

    return () => {
      window.removeEventListener('beforeunload', onUnload)
      recognitionRef.current?.stop()
      if (window.speechSynthesis) window.speechSynthesis.cancel()
    }
  }, [])

  const runPipeline = useCallback(async (text: string): Promise<void> => {
    setState('transcribing')
    setTranscript(text)
    setState('llm-thinking')
    const startedAt = recordingStartedAtRef.current
    const durationMs =
      startedAt !== undefined
        ? Math.max(0, Date.now() - startedAt)
        : undefined
    recordingStartedAtRef.current = undefined
    try {
      const llmOutput = await fetchMultimodalAsk(text, durationMs)
      const parsed = parseDirectives(llmOutput)
      const dispatched = dispatchDirectives(parsed)
      setReply(dispatched.ttsText)
      setState('speaking')
      // Local 24h TTL history — text only, never raw audio.
      void saveVoiceHistoryEntry({
        transcript: text,
        reply: dispatched.ttsText
      }).catch(() => {
        // History is best-effort; do not fail the tutoring loop.
      })
      await speak(dispatched.ttsText)
    } catch (pipelineError) {
      setError(
        pipelineError instanceof Error
          ? pipelineError.message
          : '语音辅导出错，请重试'
      )
    } finally {
      setState('idle')
    }
  }, [])

  const startRecording = useCallback((): void => {
    setError(undefined)
    const Ctor = resolveSpeechRecognition()
    if (!Ctor) {
      setError('当前浏览器不支持语音识别，请在 Chrome 中演示。')
      return
    }
    const recognition = new Ctor()
    recognition.lang = 'zh-CN'
    recognition.continuous = false
    recognition.interimResults = false
    finalTranscriptRef.current = ''
    recognition.onresult = (event) => {
      let text = ''
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        text += event.results[index]?.[0]?.transcript ?? ''
      }
      finalTranscriptRef.current = text.trim()
    }
    recognition.onerror = (event) => {
      setError(`语音识别出错：${event.error}`)
    }
    recognition.onend = () => {
      const finalText = finalTranscriptRef.current
      if (finalText.length > 0) {
        void runPipeline(finalText)
      } else {
        setState('idle')
      }
    }
    recognitionRef.current = recognition
    try {
      recordingStartedAtRef.current = Date.now()
      recognition.start()
      setState('recording')
    } catch (startError) {
      recordingStartedAtRef.current = undefined
      setError(startError instanceof Error ? startError.message : '无法启动录音')
    }
  }, [runPipeline])

  const stopRecording = useCallback((): void => {
    recognitionRef.current?.stop()
  }, [])

  return {
    state,
    transcript,
    reply,
    error,
    isSpeechRecognitionSupported: resolveSpeechRecognition() !== undefined,
    startRecording,
    stopRecording
  }
}
