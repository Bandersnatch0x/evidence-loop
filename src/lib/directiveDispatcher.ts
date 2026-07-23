import type { Directive, ParseResult } from '../../shared/protocol/multimodalDirective'

/**
 * Client-side dispatcher for multimodal tail directives (ADR-0005 §2).
 *
 * - SPEAK → preferred TTS text (math-friendly reading)
 * - DISPLAY → locate KaTeX step via data-katex-id and highlight
 * - HIGHLIGHT → existing DOM selector highlight
 * - NONE → no-op
 *
 * Overlay is driven solely through the `multimodal:highlight` window event so
 * VoiceCompanion and OverlayLayer stay decoupled (ticket 019).
 */

export const HIGHLIGHT_EVENT = 'multimodal:highlight'

export interface DispatchResult {
  /** Text that should be fed to TTS (SPEAK overrides spokenText when present). */
  ttsText: string
  /** Selectors that were published as highlight events. */
  highlightSelectors: string[]
}

export interface DispatchOptions {
  /**
   * Map DISPLAY formula text → data-katex-id. Defaults to treating the DISPLAY
   * payload itself as the katex id (seed problems use stable ids like
   * `math-1-step-2`, and DISPLAY may carry either the formula or the id).
   */
  resolveKatexId?: (displayText: string) => string | undefined
  /** Override event target (defaults to window). Useful in tests. */
  eventTarget?: EventTarget
}

function defaultResolveKatexId(displayText: string): string | undefined {
  const trimmed = displayText.trim()
  if (trimmed.length === 0) return undefined

  // Prefer an exact data-katex-id match on the formula text or id.
  if (typeof document !== 'undefined') {
    const byId = document.querySelector(`[data-katex-id="${cssEscape(trimmed)}"]`)
    if (byId) return trimmed

    // Fall back: find a step whose data-katex-formula equals DISPLAY text.
    const byFormula = document.querySelector(
      `[data-katex-formula="${cssEscape(trimmed)}"]`
    )
    const formulaId = byFormula?.getAttribute('data-katex-id')
    if (formulaId !== null && formulaId !== undefined && formulaId !== '') {
      return formulaId
    }
  }

  // Last resort: use the text as the id (works when LLM emits the katex id).
  return trimmed
}

/**
 * Minimal CSS.escape polyfill for attribute selectors (jsdom may lack it).
 */
function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value)
  }
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function dispatchHighlight(
  selector: string,
  eventTarget: EventTarget
): void {
  eventTarget.dispatchEvent(
    new CustomEvent<{ selector: string }>(HIGHLIGHT_EVENT, {
      detail: { selector }
    })
  )
}

/**
 * Apply a parsed multimodal result: pick TTS text and publish highlights.
 */
export function dispatchDirectives(
  parsed: ParseResult,
  options: DispatchOptions = {}
): DispatchResult {
  const eventTarget = options.eventTarget ?? window
  const resolveKatexId = options.resolveKatexId ?? defaultResolveKatexId
  const highlightSelectors: string[] = []

  let speakText: string | undefined

  for (const directive of parsed.directives) {
    applyDirective(directive, {
      eventTarget,
      resolveKatexId,
      highlightSelectors,
      setSpeak: (text) => {
        speakText = text
      }
    })
  }

  return {
    ttsText: speakText !== undefined && speakText.length > 0
      ? speakText
      : parsed.spokenText,
    highlightSelectors
  }
}

interface ApplyContext {
  eventTarget: EventTarget
  resolveKatexId: (displayText: string) => string | undefined
  highlightSelectors: string[]
  setSpeak: (text: string) => void
}

function applyDirective(directive: Directive, context: ApplyContext): void {
  switch (directive.kind) {
    case 'speak':
      context.setSpeak(directive.text)
      return
    case 'display': {
      const katexId = context.resolveKatexId(directive.text)
      if (katexId === undefined || katexId.length === 0) return
      const selector = `[data-katex-id="${katexId}"]`
      dispatchHighlight(selector, context.eventTarget)
      context.highlightSelectors.push(selector)
      return
    }
    case 'highlight':
      dispatchHighlight(directive.selector, context.eventTarget)
      context.highlightSelectors.push(directive.selector)
      return
    case 'none':
      return
    default: {
      const _exhaustive: never = directive
      return _exhaustive
    }
  }
}
