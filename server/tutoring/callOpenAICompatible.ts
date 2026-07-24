import type { z } from 'zod'

/**
 * Shared OpenAI-compatible chat-completions client (T05 / TR2).
 *
 * Extracted from OpenAICompatibleFeedbackGenerator so feedback + three tutoring
 * layers share one fetch → JSON extract → zod validate skeleton. Callers supply
 * messages + schema; failures throw so each layer can fall back to templates.
 *
 * Does NOT touch scores, evidence, or evaluation paths — pure I/O utility.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface CallOpenAICompatibleOptions {
  apiKey: string
  baseUrl: string
  model: string
  /** Default 0.2 (TR2: keep 0–0.3 for factual tutoring). */
  temperature?: number
  /** Default 8_000 ms. */
  timeoutMs?: number
  maxTokens?: number
}

/**
 * Call an OpenAI-compatible `/chat/completions` endpoint and parse the first
 * choice through `schema`. Throws on HTTP / empty / non-JSON / schema errors.
 */
export async function callOpenAICompatible<T>(
  messages: ChatMessage[],
  schema: z.ZodType<T>,
  options: CallOpenAICompatibleOptions
): Promise<T> {
  const temperature = options.temperature ?? 0.2
  const timeoutMs = options.timeoutMs ?? 8_000
  const base = options.baseUrl.replace(/\/$/, '')

  const body: Record<string, unknown> = {
    model: options.model,
    temperature,
    messages
  }
  if (options.maxTokens !== undefined) {
    body.max_tokens = options.maxTokens
  }

  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${options.apiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  })

  if (!response.ok) {
    throw new Error(`LLM request failed with HTTP ${String(response.status)}`)
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = payload.choices?.[0]?.message?.content
  if (!content) {
    throw new Error('LLM response did not include content')
  }

  const jsonMatch = content.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error('LLM response was not JSON')
  }

  return schema.parse(JSON.parse(jsonMatch[0]))
}

/**
 * Resolve LLM provider config from environment (D5 / TR2).
 *
 * Prefer `LLM_*` (existing feedback path). Optional `LLM_PROVIDER` is recorded
 * in provenance only — DeepSeek / Qwen / Doubao / GLM all speak OpenAI-compat
 * via BASE_URL + MODEL + KEY. Missing config returns null → template fallback.
 */
export interface LlmProviderConfig {
  apiKey: string
  baseUrl: string
  model: string
  /** Provider label for provenance (e.g. deepseek, qwen, openai-compatible). */
  provider: string
}

export function resolveLlmProvider(
  env: NodeJS.ProcessEnv = process.env
): LlmProviderConfig | null {
  const apiKey = env.LLM_API_KEY?.trim()
  const baseUrl = env.LLM_BASE_URL?.trim()
  const model = env.LLM_MODEL?.trim()
  if (!apiKey || !baseUrl || !model) return null

  const rawProvider = env.LLM_PROVIDER?.trim().toLowerCase()
  const provider =
    rawProvider && rawProvider.length > 0 ? rawProvider : 'openai-compatible'

  return { apiKey, baseUrl, model, provider }
}
