import type { ServerResponse } from 'node:http'
import {
  SECURITY_WARNING_HEADER,
  SECURITY_WARNING_VALUE
} from '../auth/MockSessionProvider'

/**
 * Multimodal voice ask route — Phase 1 mock with dual-channel few-shot shape.
 *
 * See ADR-0005 §2 / §7 / §8:
 * - Every `/api/multimodal/*` route must respond 503 (with X-Feature-Disabled)
 *   when MULTIMODAL_ENABLED is off.
 * - Successful voice responses set `X-Modality-Mode: voice`.
 * - LLM output uses SPEAK/DISPLAY dual channel for math + HIGHLIGHT for DOM
 *   pointing. Temperature target for a real LLM is 0.2–0.3 (see
 *   MULTIMODAL_LLM_TEMPERATURE). Real LLM + Aliyun STT streaming arrive later;
 *   this canned reply exercises the full client pipeline.
 * - Audit for this path is written by the HTTP layer with modality metadata
 *   only (duration / char count / PII hits) — never the transcript body.
 */

export const FEATURE_DISABLED_HEADER = 'x-feature-disabled'

/** Response header advertising the active interaction modality (ADR-0005 §7). */
export const MODALITY_MODE_HEADER = 'x-modality-mode'
export const MODALITY_MODE_VOICE = 'voice'

/** Target sampling temperature for a real multimodal LLM (ADR-0005 §2). */
export const MULTIMODAL_LLM_TEMPERATURE = 0.25

/**
 * Few-shot system prompt fragment — kept exportable so a future real LLM
 * client can reuse the same dual-channel contract.
 */
export const MULTIMODAL_SYSTEM_PROMPT = `你是 EvidenceLoop 的语音辅导助手。只讲解、只指点，绝不改分。

输出协议（严格尾标签，不要 JSON）：
1. 先写自然语言讲解正文（交给 TTS 朗读）。
2. 需要指点 DOM 时追加 [HIGHLIGHT:selector="..."]，selector 必须以白名单前缀开头：
   #problem- / .step- / [data-evidence-id="..."] / [data-katex-id="..."]
3. 数学公式必须双通道：
   [SPEAK:朗读友好文本][DISPLAY:公式原文]
   TTS 读 SPEAK；前端用 DISPLAY 定位 data-katex-id 高亮。
4. 无需指点时追加 [NONE]。

示例 1（代码证据）：
问题出在空列表边界——分母变成了零。[HIGHLIGHT:selector="[data-evidence-id="demo-1"]"]

示例 2（数学双通道）：
看平方项，x 的平方加 3 就是把 x 平方后再加常数。[SPEAK:x 的平方加 3][DISPLAY:x^2+3][HIGHLIGHT:selector="[data-katex-id="math-1-step-2"]"]

温度保持 0.2–0.3 以保证标签格式稳定。`

/**
 * Canned dual-channel reply used when MULTIMODAL_ENABLED=true.
 * Includes SPEAK + DISPLAY + HIGHLIGHT so VoiceCompanion / OverlayLayer /
 * MathProblem can be demoed end-to-end without a live LLM key.
 */
export const MOCK_LLM_OUTPUT =
  '看这一步：把 x 平方后再加 3，得到二次式。'
  + '[SPEAK:x 的平方加 3]'
  + '[DISPLAY:x^2+3]'
  + '[HIGHLIGHT:selector="[data-katex-id="math-1-step-2"]"]'

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  [SECURITY_WARNING_HEADER]: SECURITY_WARNING_VALUE
} as const

/**
 * Write the multimodal ask response. When `featureEnabled` is false, responds
 * 503 with X-Feature-Disabled: multimodal so clients can fall back silently.
 * When enabled, sets X-Modality-Mode: voice (ADR-0005 §7).
 */
export function respondMultimodalAsk(
  response: ServerResponse,
  featureEnabled: boolean
): void {
  if (!featureEnabled) {
    response.writeHead(503, {
      ...JSON_HEADERS,
      [FEATURE_DISABLED_HEADER]: 'multimodal'
    })
    response.end(
      JSON.stringify({ error: 'Multimodal feature is disabled' })
    )
    return
  }

  response.writeHead(200, {
    ...JSON_HEADERS,
    [MODALITY_MODE_HEADER]: MODALITY_MODE_VOICE
  })
  response.end(
    JSON.stringify({
      llmOutput: MOCK_LLM_OUTPUT,
      temperature: MULTIMODAL_LLM_TEMPERATURE,
      systemPromptVersion: 'dual-channel-v1'
    })
  )
}
