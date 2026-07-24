import { MessageCircle } from 'lucide-react'

interface AiInferenceBadgeProps {
  /** Provenance model id (e.g. deepseek:deepseek-chat or tutoring-template.v1). */
  model?: string
  /** Compact inline variant next to a message. */
  compact?: boolean
}

/**
 * Grey "AI 推断" provenance badge (ADR-0006 three-colour system).
 * Tutoring outputs are always llm_inference — never evidence-blue.
 */
export function AiInferenceBadge({
  model,
  compact = false
}: AiInferenceBadgeProps) {
  return (
    <span
      className={
        compact
          ? 'tutoring-ai-badge tutoring-ai-badge-compact'
          : 'tutoring-ai-badge'
      }
      title={model ? `模型 · ${model}` : 'AI 推断 · 不计入分数'}
    >
      <MessageCircle size={compact ? 11 : 13} aria-hidden="true" />
      {compact ? 'AI 推断' : model ? `AI 推断 · ${model}` : 'AI 推断 · 不计入分数'}
    </span>
  )
}
