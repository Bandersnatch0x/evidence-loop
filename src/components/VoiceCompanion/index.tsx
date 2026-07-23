import { Mic, MicOff } from 'lucide-react'
import type { VoiceSessionState } from './useVoiceSession'
import { useVoiceSession } from './useVoiceSession'

const STATE_LABELS: Record<VoiceSessionState, string> = {
  idle: '待命',
  recording: '录音中…',
  transcribing: '转写中…',
  'llm-thinking': '思考中…',
  speaking: '讲解中…'
}

/**
 * Right-hand voice drawer (ADR-0005 §4). Owns STT/TTS + the local state
 * machine via useVoiceSession. Publishes highlight directives on the window
 * bus; it never imports <OverlayLayer> and is never imported by it.
 */
export function VoiceCompanion() {
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

  return (
    <aside className="voice-companion" aria-label="语音辅导">
      <header className="voice-header">
        <strong>语音辅导</strong>
        <span
          className={`voice-state voice-state-${state}`}
          aria-live="polite"
        >
          {STATE_LABELS[state]}
        </span>
      </header>

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
        <p className="voice-hint">当前浏览器不支持语音识别，请在 Chrome 中演示。</p>
      )}

      {transcript.length > 0 && (
        <p className="voice-transcript">
          <span>你：</span>
          {transcript}
        </p>
      )}
      {reply.length > 0 && (
        <p className="voice-reply">
          <span>辅导：</span>
          {reply}
        </p>
      )}
      {error && (
        <p className="voice-error" role="alert">{error}</p>
      )}
    </aside>
  )
}
