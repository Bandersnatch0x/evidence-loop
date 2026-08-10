import { useCallback, useEffect, useRef, useState } from 'react'
import { Bot, MessageCircleQuestion, Send, X } from 'lucide-react'
import type {
  DialogueSessionView,
  DialogueTurn,
  PersonaCatalogEntry
} from '../../../shared/personaDialogue'
import {
  closeDialogue,
  listPersonas,
  openDialogue,
  sendDialogueTurn
} from './personaDialogueApi'
import './dialogue.css'

interface PersonaDialoguePanelProps {
  /** 知识点挂载（可选）。 */
  kpId?: string
  /** 题目挂载（可选）。 */
  questionId?: string
  /** 顶部常驻标识（对齐 PRD）。 */
  notice?: string
  /** 关闭面板（父组件控制显隐）。 */
  onClose?: () => void
}

/**
 * T21 — 人物对话探究面板（练习态，不入分）。
 *
 * 顶栏常驻「练习探究 · 不计入测评」标识；角色来自固定目录；每一条角色回复
 * 都带 `llm_inference` 徽章（AI 推断）；轮次上限到达后展示「结束探究 →
 * 去做论述题」引导。对话不产生任何 Attempt / 分数。
 */
export function PersonaDialoguePanel({
  kpId,
  questionId,
  notice = '练习探究 · 不计入测评',
  onClose
}: PersonaDialoguePanelProps) {
  const [personas, setPersonas] = useState<PersonaCatalogEntry[]>([])
  const [selectedPersona, setSelectedPersona] = useState<PersonaCatalogEntry>()
  const [session, setSession] = useState<DialogueSessionView>()
  const [input, setInput] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [roundLimitReached, setRoundLimitReached] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    listPersonas()
      .then((body) => setPersonas(body.personas))
      .catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : '人物列表加载失败')
      })
  }, [])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [session])

  const start = useCallback(
    async (persona: PersonaCatalogEntry) => {
      setBusy(true)
      setError(undefined)
      try {
        const opened = await openDialogue({
          personaId: persona.id,
          mode: 'practice',
          ...(kpId ? { kpId } : {}),
          ...(questionId ? { questionId } : {})
        })
        setSelectedPersona(persona)
        setSession(opened.session)
      } catch (startError: unknown) {
        setError(startError instanceof Error ? startError.message : '会话开启失败')
      } finally {
        setBusy(false)
      }
    },
    [kpId, questionId]
  )

  const send = useCallback(async () => {
    const text = input.trim()
    if (!session || text === '' || busy) return
    setBusy(true)
    setError(undefined)
    setInput('')
    try {
      const result = await sendDialogueTurn(session.id, text)
      setSession(result.session)
      setRoundLimitReached(result.roundLimitReached)
    } catch (sendError: unknown) {
      const message = sendError instanceof Error ? sendError.message : '回复失败'
      if (message.includes('round limit') || message.includes('上限')) {
        setRoundLimitReached(true)
      } else {
        setError(message)
      }
    } finally {
      setBusy(false)
    }
  }, [input, session, busy])

  const finish = useCallback(async () => {
    if (!session) return
    setBusy(true)
    setError(undefined)
    try {
      const closed = await closeDialogue(session.id)
      setSession(closed.session)
    } catch (closeError: unknown) {
      setError(closeError instanceof Error ? closeError.message : '关闭失败')
    } finally {
      setBusy(false)
    }
  }, [session])

  const personaName = selectedPersona?.name ?? '探究人物'

  return (
    <div className="persona-dialogue-panel" data-testid="persona-dialogue-panel">
      {/* 顶栏常驻标识：练习探究 · 不计入测评 */}
      <div className="persona-dialogue-banner" role="status">
        <Bot size={14} aria-hidden="true" />
        <span>{notice}</span>
        {onClose ? (
          <button
            type="button"
            className="persona-dialogue-close"
            onClick={onClose}
            aria-label="关闭探究对话"
          >
            <X size={16} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {error ? <p className="persona-dialogue-error">{error}</p> : null}

      {!session ? (
        <div className="persona-dialogue-picker">
          <p className="persona-dialogue-picker-title">
            <MessageCircleQuestion size={14} aria-hidden="true" /> 选择一位人物开始探究
          </p>
          {personas.map((persona) => (
            <button
              key={persona.id}
              type="button"
              className="persona-card"
              onClick={() => void start(persona)}
              disabled={busy}
            >
              <span className="persona-card-name">{persona.name}</span>
              <span className="persona-card-era">{persona.eraOrContext}</span>
              <span className="persona-card-excerpt">{persona.sourceExcerpts[0]}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="persona-dialogue-chat">
          <div className="persona-dialogue-turns" ref={listRef}>
            {session.turns.map((turn) => (
              <TurnBubble key={turn.id} turn={turn} personaName={personaName} />
            ))}
            {busy && !roundLimitReached ? (
              <div className="persona-turn assistant is-typing" aria-live="polite">
                <div className="persona-turn-meta">
                  <strong>{personaName}</strong>
                  <span className="persona-turn-badge">正在思考...</span>
                </div>
                <p>正在输入回复…</p>
              </div>
            ) : null}
            {roundLimitReached ? (
              <p className="persona-dialogue-limit">
                已到达 {String(session.roundLimit)} 轮探究上限。建议结束探究，去做一道论述题检验理解。
              </p>
            ) : null}
          </div>

          {roundLimitReached ? (
            <button
              type="button"
              className="persona-dialogue-essay-cta"
              onClick={() => void finish()}
              disabled={busy}
            >
              结束探究 → 去做论述题
            </button>
          ) : (
            <form
              className="persona-dialogue-input-row"
              onSubmit={(event) => {
                event.preventDefault()
                void send()
              }}
            >
              <input
                className="persona-dialogue-input"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={`向${personaName}提问…`}
                maxLength={2000}
                disabled={busy}
              />
              <button
                type="submit"
                className="persona-dialogue-send"
                disabled={busy || input.trim() === ''}
                aria-label="发送提问"
              >
                <Send size={16} aria-hidden="true" />
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  )
}

/** 单条消息气泡：assistant 轮次挂「AI 推断」徽章（ADR-0006 三色系统）。 */
function TurnBubble({
  turn,
  personaName
}: {
  turn: DialogueTurn
  personaName: string
}) {
  const isAssistant = turn.role === 'assistant'
  return (
    <div className={`persona-turn ${isAssistant ? 'assistant' : 'user'}`}>
      <div className="persona-turn-meta">
        <strong>{isAssistant ? personaName : '我'}</strong>
        {isAssistant ? (
          <span className="persona-turn-badge" title="AI 推断：未经证据验证">
            AI 推断
          </span>
        ) : null}
      </div>
      <p>{turn.content}</p>
    </div>
  )
}
