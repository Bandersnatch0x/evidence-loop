import { useState } from 'react'
import { HelpCircle } from 'lucide-react'
import type { TutoringMessage, TutoringTurn } from '../../../shared/contracts'
import { AiInferenceBadge } from './AiInferenceBadge'

interface SocraticPanelProps {
  messages: TutoringMessage[]
  loading?: boolean
  error?: string
  disabled?: boolean
  disabledReason?: string
  onAsk: (message: string, history: TutoringTurn[]) => void
}

/**
 * Layer C — Socratic hints. One question at a time; never dumps the answer.
 */
export function SocraticPanel({
  messages,
  loading = false,
  error,
  disabled = false,
  disabledReason,
  onAsk
}: SocraticPanelProps) {
  const [draft, setDraft] = useState('提示')

  const history: TutoringTurn[] = messages.map((m) => ({
    role: m.role,
    content: m.content
  }))

  return (
    <section className="tutoring-layer" aria-labelledby="tutoring-socratic-title">
      <header className="tutoring-layer-head">
        <div className="tutoring-layer-title">
          <HelpCircle size={15} aria-hidden="true" />
          <h4 id="tutoring-socratic-title">苏格拉底引导</h4>
        </div>
        <AiInferenceBadge compact />
      </header>
      <p className="tutoring-layer-caption">
        一次一问，给提示链不给原题答案。连续低努力索取会被拒绝继续提示。
      </p>

      {disabled ? (
        <p className="tutoring-disabled">
          {disabledReason ?? '测评态关闭苏格拉底辅导（D1）。'}
        </p>
      ) : (
        <>
          <ul className="tutoring-thread">
            {messages.map((m) => (
              <li key={m.id} className={`tutoring-bubble is-${m.role}`}>
                {m.role === 'assistant' && (
                  <AiInferenceBadge model={m.provenance.model} compact />
                )}
                <p>{m.content}</p>
              </li>
            ))}
          </ul>
          <div className="tutoring-compose">
            <input
              type="text"
              value={draft}
              maxLength={500}
              aria-label="苏格拉底提问"
              placeholder="描述你的卡点，或点提示"
              onChange={(event) => setDraft(event.target.value)}
              disabled={loading}
            />
            <button
              type="button"
              className="tutoring-action"
              disabled={loading || draft.trim() === ''}
              onClick={() => {
                const text = draft.trim()
                if (text === '') return
                onAsk(text, history)
                setDraft('')
              }}
            >
              {loading ? '思考中…' : '提问'}
            </button>
          </div>
        </>
      )}

      {error && <p className="tutoring-error" role="alert">{error}</p>}
    </section>
  )
}
