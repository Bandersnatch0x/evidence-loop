import { useState } from 'react'
import { MessagesSquare } from 'lucide-react'
import type { TutoringMessage, TutoringTurn } from '../../../shared/contracts'
import { AiInferenceBadge } from './AiInferenceBadge'

interface DialoguePanelProps {
  messages: TutoringMessage[]
  loading?: boolean
  error?: string
  disabled?: boolean
  disabledReason?: string
  onAsk: (message: string, history: TutoringTurn[]) => void
}

/**
 * Layer B — multi-turn dialogue on the current problem.
 */
export function DialoguePanel({
  messages,
  loading = false,
  error,
  disabled = false,
  disabledReason,
  onAsk
}: DialoguePanelProps) {
  const [draft, setDraft] = useState('')

  const history: TutoringTurn[] = messages.map((m) => ({
    role: m.role,
    content: m.content
  }))

  return (
    <section className="tutoring-layer" aria-labelledby="tutoring-dialogue-title">
      <header className="tutoring-layer-head">
        <div className="tutoring-layer-title">
          <MessagesSquare size={15} aria-hidden="true" />
          <h4 id="tutoring-dialogue-title">追问对话</h4>
        </div>
        <AiInferenceBadge compact />
      </header>
      <p className="tutoring-layer-caption">
        就当前题多轮追问。上下文保留最近数轮；分数仍以证据为准。
      </p>

      {disabled ? (
        <p className="tutoring-disabled">
          {disabledReason ?? '测评态关闭追问对话（D1）。'}
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
              aria-label="追问内容"
              placeholder="例如：这步为什么？有没有另一种方法？"
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
              {loading ? '回复中…' : '发送'}
            </button>
          </div>
        </>
      )}

      {error && <p className="tutoring-error" role="alert">{error}</p>}
    </section>
  )
}
