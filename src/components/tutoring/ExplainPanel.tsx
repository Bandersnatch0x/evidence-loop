import { BookOpen } from 'lucide-react'
import type { TutoringMessage } from '../../../shared/contracts'
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
 * Layer A — one-shot explain. Student reads; zero extra chat turns.
 */
export function ExplainPanel({
  message,
  loading = false,
  error,
  onRequest,
  disabledReason
}: ExplainPanelProps) {
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
