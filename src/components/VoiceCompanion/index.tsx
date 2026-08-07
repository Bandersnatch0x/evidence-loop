import { useEffect } from 'react'
import { ChevronRight, Mic, MicOff, X } from 'lucide-react'
import type { VoiceSessionState } from './useVoiceSession'
import { useVoiceSession } from './useVoiceSession'

const STATE_LABELS: Record<VoiceSessionState, string> = {
  idle: '待命',
  recording: '录音中…',
  transcribing: '转写中…',
  'llm-thinking': '思考中…',
  speaking: '讲解中…'
}

export interface VoiceCompanionProps {
  /** Controlled open state for the right-hand drawer. */
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Right-hand voice drawer (ADR-0005 §4). Collapsed by default as a FAB so it
 * does not block workspace navigation. Owns STT/TTS + the local state machine
 * via useVoiceSession. Publishes highlight directives on the window bus; it
 * never imports <OverlayLayer> and is never imported by it.
 */
export function VoiceCompanion({ open, onOpenChange }: VoiceCompanionProps) {
  const {
    state,
    transcript,
    reply,
    error,
    isSpeechRecognitionSupported,
    startRecording,
    stopRecording
  } = useVoiceSession()

  const isRecording = state === 'recording'
  const isBusy = state !== 'idle'

  // P1-3 待机/唤醒：Alt+V 快捷键切换抽屉，不打断键盘做题流。
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.altKey && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault()
        onOpenChange(!open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  if (!open) {
    return (
      <button
        type="button"
        className={`voice-fab${isBusy ? '' : ' voice-fab-idle'}`}
        aria-label="打开语音辅导（Alt+V）"
        onClick={() => onOpenChange(true)}
      >
        <Mic size={20} aria-hidden="true" />
        <span>语音辅导</span>
        {isBusy && <span className="voice-fab-dot" aria-hidden="true" />}
      </button>
    )
  }

  return (
    <>
      <button
        type="button"
        className="voice-drawer-backdrop"
        aria-label="关闭语音辅导"
        onClick={() => onOpenChange(false)}
      />
      <aside className="voice-companion is-open" aria-label="语音辅导">
        <header className="voice-header">
          <div className="voice-header-text">
            <strong>语音辅导</strong>
            <span
              className={`voice-state voice-state-${state}`}
              aria-live="polite"
            >
              {STATE_LABELS[state]}
            </span>
          </div>
          <button
            type="button"
            className="voice-close"
            aria-label="关闭语音辅导抽屉"
            onClick={() => onOpenChange(false)}
          >
            <X size={18} />
          </button>
        </header>

        <p className="voice-intro">
          只讲解、只指点，不改分。原始音频不落盘；对话本地 24 小时清空。
        </p>

        <button
          type="button"
          className="voice-talk-button"
          aria-label={isRecording ? '松开结束说话' : '按住说话'}
          aria-pressed={isRecording}
          disabled={!isSpeechRecognitionSupported}
          onPointerDown={startRecording}
          onPointerUp={stopRecording}
          onPointerLeave={stopRecording}
        >
          {isRecording ? <MicOff size={22} /> : <Mic size={22} />}
          <span>{isRecording ? '松开结束' : '按住说话'}</span>
        </button>

        {!isSpeechRecognitionSupported && (
          <p className="voice-hint">
            当前浏览器不支持语音识别，请在 Chrome 中演示。
          </p>
        )}

        <div className="voice-log" aria-live="polite">
          {transcript.length > 0 && (
            <p className="voice-transcript">
              <span>你</span>
              {transcript}
            </p>
          )}
          {reply.length > 0 && (
            <p className="voice-reply">
              <span>辅导</span>
              {reply}
            </p>
          )}
          {transcript.length === 0 && reply.length === 0 && !error && (
            <p className="voice-empty">按住说话，询问「哪里错了？」等讲解问题。</p>
          )}
          {error && (
            <p className="voice-error" role="alert">
              {error}
            </p>
          )}
        </div>

        <button
          type="button"
          className="voice-collapse"
          onClick={() => onOpenChange(false)}
        >
          <ChevronRight size={16} aria-hidden="true" />
          收起抽屉
        </button>
      </aside>
    </>
  )
}
