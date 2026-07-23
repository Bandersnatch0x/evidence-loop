// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseDirectives } from '../shared/protocol/multimodalDirective'
import {
  dispatchDirectives,
  HIGHLIGHT_EVENT
} from '../src/lib/directiveDispatcher'

describe('dispatchDirectives', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('prefers SPEAK text for TTS over spokenText', () => {
    const parsed = parseDirectives(
      '看平方项。[SPEAK:x 的平方加 3][DISPLAY:x^2+3]'
    )
    const result = dispatchDirectives(parsed, {
      resolveKatexId: () => 'math-1-step-2'
    })
    expect(result.ttsText).toBe('x 的平方加 3')
  })

  it('maps DISPLAY to a data-katex-id highlight event', () => {
    const step = document.createElement('div')
    step.setAttribute('data-katex-id', 'math-1-step-2')
    step.setAttribute('data-katex-formula', 'x^2+3')
    document.body.appendChild(step)

    const selectors: string[] = []
    const target = new EventTarget()
    target.addEventListener(HIGHLIGHT_EVENT, (event) => {
      const detail = (event as CustomEvent<{ selector: string }>).detail
      selectors.push(detail.selector)
    })

    const parsed = parseDirectives(
      '讲解。[SPEAK:x 的平方加 3][DISPLAY:x^2+3]'
    )
    const result = dispatchDirectives(parsed, { eventTarget: target })

    expect(result.ttsText).toBe('x 的平方加 3')
    expect(result.highlightSelectors).toEqual([
      '[data-katex-id="math-1-step-2"]'
    ])
    expect(selectors).toEqual(['[data-katex-id="math-1-step-2"]'])
  })

  it('forwards HIGHLIGHT selectors unchanged', () => {
    const selectors: string[] = []
    const target = new EventTarget()
    target.addEventListener(HIGHLIGHT_EVENT, (event) => {
      const detail = (event as CustomEvent<{ selector: string }>).detail
      selectors.push(detail.selector)
    })

    const parsed = parseDirectives(
      '看这里。[HIGHLIGHT:selector="[data-evidence-id="demo-1"]"]'
    )
    const result = dispatchDirectives(parsed, { eventTarget: target })
    expect(result.ttsText).toBe('看这里。')
    expect(result.highlightSelectors).toEqual([
      '[data-evidence-id="demo-1"]'
    ])
    expect(selectors).toEqual(['[data-evidence-id="demo-1"]'])
  })

  it('falls back to spokenText when no SPEAK directive is present', () => {
    const parsed = parseDirectives('纯讲解无标签')
    const result = dispatchDirectives(parsed)
    expect(result.ttsText).toBe('纯讲解无标签')
    expect(result.highlightSelectors).toEqual([])
  })
})
