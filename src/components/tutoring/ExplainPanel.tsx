import { BookOpen, Square, Volume2 } from 'lucide-react'
import type { TutoringMessage } from '../../../shared/contracts'
import { useSpeak } from '../../lib/useSpeak'
import { AiInferenceBadge } from './AiInferenceBadge'

interface ExplainPanelProps {
  message?: TutoringMessage
  loading?: boolean
  error?: string
  onRequest: () => void
  /** Assessment mid-attempt: explain closed until submit. */
  disabledReason?: string
}

/**
 * Layer A - one-shot explain. Student reads; zero extra chat turns.
 *
 * On-demand TTS (P0 from 3dlearn roundtable): an opt-in "朗读讲解" button
 * reads the explain text via useSpeak. Voice never reads scores - only the
 * text the caller already renders here - and is off by default so it never
 * clashes with a screen reader. Unsupported browsers hide the button.
 */
export function ExplainPanel({
  message,
  loading = false,
  error,
  onRequest,
  disabledReason
}: ExplainPanelProps) {
  const { isSpeaking, isSupported, speak, stop } = useSpeak()

  return (
    <section className="tutoring-layer" aria-labelledby="tutoring-explain-title">
      <header className="tutoring-layer-head">
        <div className="tutoring-layer-title">
          <BookOpen size={15} aria-hidden="true" />
          <h4 id="tutoring-explain-title">单向讲解</h4>
        </div>
        <AiInferenceBadge model={message?.provenance.model} compact />
      </header>
      <p className="tutoring-layer-caption">
        基于证据与（若有）标准解析讲清思路；不改分、不写证据。
      </p>

      {disabledReason ? (
        <p className="tutoring-disabled">{disabledReason}</p>
      ) : (
        <button
          type="button"
          className="tutoring-action"
          onClick={onRequest}
          disabled={loading}
        >
          {loading ? '生成讲解中…' : message ? '重新讲解' : '生成讲解'}
        </button>
      )}

      {error && <p className="tutoring-error" role="alert">{error}</p>}

      {message && (
        <article className="tutoring-message">
          <div className="tutoring-message-meta">
            <AiInferenceBadge model={message.provenance.model} />
            <span className="tutoring-source">
              {message.source === 'llm' ? 'LLM' : '模板兜底'}
            </span>
            {isSupported && (
              <button
                type="button"
                className="tutoring-speak"
                onClick={() => (isSpeaking ? stop() : speak(message.content))}
                aria-label={isSpeaking ? '停止朗读讲解' : '朗读讲解'}
                aria-pressed={isSpeaking}
              >
                {isSpeaking ? (
                  <Square size={13} aria-hidden="true" />
                ) : (
                  <Volume2 size={13} aria-hidden="true" />
                )}
                {isSpeaking ? '停止朗读' : '朗读讲解'}
              </button>
            )}
          </div>
          <p>{message.content}</p>
          {message.disclaimer && (
            <p className="tutoring-disclaimer">{message.disclaimer}</p>
          )}
        </article>
      )}
    </section>
  )
}
