/**
 * Multimodal LLM output protocol parser.
 *
 * See ADR-0005 Section 2 for the frozen LLM output protocol:
 *
 *   [讲解正文，自然语言，交给 TTS]
 *   [HIGHLIGHT:selector="#step-3"]   // 指点目标（必需）
 *   [SPEAK:x 的平方加 3]              // 朗读友好文本（数学专用）
 *   [DISPLAY:x²+3]                   // 视觉展示（数学专用）
 *   [NONE]                           // 无需指点时的显式标记
 *
 * Design constraints (ADR-0005):
 * - No JSON — LLMs frequently drop quotes. Use regex-parseable tail tags.
 * - selector must hit the whitelist prefixes, otherwise silently drop + warn.
 * - Parse failures degrade to "TTS only, no pointing".
 */

export type Directive =
  | { kind: 'highlight'; selector: string }
  | { kind: 'speak'; text: string }
  | { kind: 'display'; text: string }
  | { kind: 'none' }

export const SELECTOR_WHITELIST: readonly RegExp[] = [
  /^#problem-[\w-]+$/,
  /^\.step-[\w-]+$/,
  /^\[data-evidence-id="[^"]+"\]$/,
  // KaTeX step anchors (ticket 020 dual-channel DISPLAY → overlay).
  /^\[data-katex-id="[^"]+"\]$/
]

export interface ParseResult {
  spokenText: string
  directives: Directive[]
}

const HIGHLIGHT_OPENER = '[HIGHLIGHT:selector="'
const HIGHLIGHT_CLOSER = '"]'
const SPEAK_OPENER = '[SPEAK:'
const DISPLAY_OPENER = '[DISPLAY:'
const NONE_TAG = '[NONE]'

function isSelectorAllowed(selector: string): boolean {
  return SELECTOR_WHITELIST.some((pattern) => pattern.test(selector))
}

function buildHighlight(selector: string): Directive | null {
  if (!isSelectorAllowed(selector)) {
    console.warn(
      `[multimodalDirective] HIGHLIGHT selector "${selector}" is not in the whitelist; dropped.`
    )
    return null
  }
  return { kind: 'highlight', selector }
}

interface Peeled {
  readonly directive: Directive | null
  readonly consumed: number
}

/**
 * Try to strip a single tail tag from `input`. `input` must already have
 * trailing whitespace trimmed. Returns `null` when no known tag is present
 * at the tail. `directive` may be `null` when a tag was recognised but
 * discarded (e.g. non-whitelisted selector).
 */
function peelTailTag(input: string): Peeled | null {
  if (input.endsWith(NONE_TAG)) {
    return { directive: { kind: 'none' }, consumed: NONE_TAG.length }
  }

  if (input.endsWith(HIGHLIGHT_CLOSER)) {
    const openerAt = input.lastIndexOf(HIGHLIGHT_OPENER)
    if (openerAt !== -1
        && openerAt + HIGHLIGHT_OPENER.length <= input.length - HIGHLIGHT_CLOSER.length) {
      const selector = input.slice(
        openerAt + HIGHLIGHT_OPENER.length,
        input.length - HIGHLIGHT_CLOSER.length
      )
      return {
        directive: buildHighlight(selector),
        consumed: input.length - openerAt
      }
    }
  }

  if (input.endsWith(']')) {
    // SPEAK / DISPLAY content: free text, but must not span another tag or line.
    const displayAt = input.lastIndexOf(DISPLAY_OPENER)
    if (displayAt !== -1) {
      const content = input.slice(
        displayAt + DISPLAY_OPENER.length,
        input.length - 1
      )
      if (!content.includes(']') && !content.includes('\n')) {
        return {
          directive: { kind: 'display', text: content.trim() },
          consumed: input.length - displayAt
        }
      }
    }
    const speakAt = input.lastIndexOf(SPEAK_OPENER)
    if (speakAt !== -1) {
      const content = input.slice(
        speakAt + SPEAK_OPENER.length,
        input.length - 1
      )
      if (!content.includes(']') && !content.includes('\n')) {
        return {
          directive: { kind: 'speak', text: content.trim() },
          consumed: input.length - speakAt
        }
      }
    }
  }

  return null
}

export function parseDirectives(llmOutput: string): ParseResult {
  const directivesReversed: Directive[] = []
  let remaining = llmOutput.replace(/\s+$/, '')

  while (remaining.length > 0) {
    const peeled = peelTailTag(remaining)
    if (!peeled) break
    if (peeled.directive) directivesReversed.push(peeled.directive)
    remaining = remaining.slice(0, remaining.length - peeled.consumed).replace(/\s+$/, '')
  }

  return {
    spokenText: remaining.trim(),
    directives: directivesReversed.reverse()
  }
}
