import { useCallback, useState } from 'react'
import { Sparkles } from 'lucide-react'
import type {
  SessionMode,
  StandardSolution,
  TutoringMessage,
  TutoringTurn
} from '../../../shared/contracts'
import {
  requestTutoringDialogue,
  requestTutoringExplain,
  requestTutoringSocratic
} from '../../lib/api'
import { AiInferenceBadge } from './AiInferenceBadge'
import { DialoguePanel } from './DialoguePanel'
import { ExplainPanel } from './ExplainPanel'
import { SocraticPanel } from './SocraticPanel'

interface TutoringPanelProps {
  /** Attempt id for API mode gate. When absent, panel is read-only demo shell. */
  attemptId?: string
  mode: SessionMode
  /** Evaluation completed — required for assessment-mode explain. */
  evaluationCompleted?: boolean
  solution?: StandardSolution
}

/**
 * Three-layer AI tutoring shell (T05).
 *
 * D1: socratic/dialogue practice-only; explain open in practice, and after
 * completed assessment submits. All messages show grey AI 推断 provenance.
 */
export function TutoringPanel({
  attemptId,
  mode,
  evaluationCompleted = false,
  solution
}: TutoringPanelProps) {
  const [explain, setExplain] = useState<TutoringMessage | undefined>()
  const [socratic, setSocratic] = useState<TutoringMessage[]>([])
  const [dialogue, setDialogue] = useState<TutoringMessage[]>([])
  const [loadingLayer, setLoadingLayer] = useState<
    'explain' | 'socratic' | 'dialogue' | null
  >(null)
  const [error, setError] = useState<string | undefined>()

  const practiceOnlyClosed = mode === 'assessment'
  const explainDisabled =
    mode === 'assessment' && !evaluationCompleted
      ? '测评态交卷后可查看讲解。'
      : attemptId
        ? undefined
        : '提交作答后可生成讲解。'

  const run = useCallback(
    async (layer: 'explain' | 'socratic' | 'dialogue', work: () => Promise<void>) => {
      if (!attemptId) {
        setError('缺少 attemptId，无法请求辅导')
        return
      }
      setLoadingLayer(layer)
      setError(undefined)
      try {
        await work()
      } catch (err) {
        setError(err instanceof Error ? err.message : '辅导请求失败')
      } finally {
        setLoadingLayer(null)
      }
    },
    [attemptId]
  )

  return (
    <section className="tutoring-panel" aria-labelledby="tutoring-panel-title">
      <header className="tutoring-panel-header">
        <div className="tutoring-panel-title-row">
          <Sparkles size={15} aria-hidden="true" />
          <h3 id="tutoring-panel-title">AI 辅导</h3>
          <AiInferenceBadge />
        </div>
        <p className="tutoring-panel-caption">
          三层辅导（讲解 / 苏格拉底 / 追问）与打分物理隔离，输出均为 AI 推断，不计入正式分数。
          当前模式：<strong>{mode === 'practice' ? '练习' : '测评'}</strong>
        </p>
      </header>

      <ExplainPanel
        message={explain}
        loading={loadingLayer === 'explain'}
        error={loadingLayer === null ? error : undefined}
        disabledReason={explainDisabled}
        onRequest={() => {
          void run('explain', async () => {
            const response = await requestTutoringExplain({
              attemptId: attemptId as string,
              mode,
              solution
            })
            setExplain(response.message)
          })
        }}
      />

      <SocraticPanel
        messages={socratic}
        loading={loadingLayer === 'socratic'}
        error={loadingLayer === 'socratic' ? error : undefined}
        disabled={practiceOnlyClosed || !attemptId}
        disabledReason={
          practiceOnlyClosed
            ? '测评态关闭苏格拉底辅导，保证裸做证据纯净（D1）。'
            : undefined
        }
        onAsk={(message, history) => {
          void run('socratic', async () => {
            const userMsg = localUserMessage('socratic', message)
            setSocratic((prev) => [...prev, userMsg])
            const response = await requestTutoringSocratic({
              attemptId: attemptId as string,
              mode,
              message,
              history,
              solution
            })
            setSocratic((prev) => [...prev, response.message])
          })
        }}
      />

      <DialoguePanel
        messages={dialogue}
        loading={loadingLayer === 'dialogue'}
        error={loadingLayer === 'dialogue' ? error : undefined}
        disabled={practiceOnlyClosed || !attemptId}
        disabledReason={
          practiceOnlyClosed
            ? '测评态关闭追问对话（D1）。'
            : undefined
        }
        onAsk={(message, history: TutoringTurn[]) => {
          void run('dialogue', async () => {
            const userMsg = localUserMessage('dialogue', message)
            setDialogue((prev) => [...prev, userMsg])
            const response = await requestTutoringDialogue({
              attemptId: attemptId as string,
              mode,
              message,
              history,
              solution
            })
            setDialogue((prev) => [...prev, response.message])
          })
        }}
      />
    </section>
  )
}

function localUserMessage(
  layer: 'socratic' | 'dialogue',
  content: string
): TutoringMessage {
  const extractedAt = new Date().toISOString()
  return {
    id: `local-user-${layer}-${extractedAt}`,
    layer,
    role: 'user',
    content,
    provenance: {
      kind: 'llm_inference',
      sourceMessages: [content],
      model: 'learner-input',
      extractedAt
    },
    source: 'local-policy',
    createdAt: extractedAt
  }
}
