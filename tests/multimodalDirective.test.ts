import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SELECTOR_WHITELIST,
  parseDirectives
} from '../shared/protocol/multimodalDirective'

describe('parseDirectives', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('extracts a highlight directive and returns the leading text as spokenText', () => {
    // Arrange
    const raw = '你在这里错了。[HIGHLIGHT:selector="#problem-1"]'

    // Act
    const result = parseDirectives(raw)

    // Assert
    expect(result.spokenText).toBe('你在这里错了。')
    expect(result.directives).toEqual([
      { kind: 'highlight', selector: '#problem-1' }
    ])
  })

  it('captures an explicit NONE directive', () => {
    // Arrange
    const raw = '讲解正文。[NONE]'

    // Act
    const result = parseDirectives(raw)

    // Assert
    expect(result.spokenText).toBe('讲解正文。')
    expect(result.directives).toEqual([{ kind: 'none' }])
  })

  it('silently drops non-whitelisted selectors and logs a warning', () => {
    // Arrange
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const raw = '危险指令。[HIGHLIGHT:selector="javascript:alert(1)"]'

    // Act
    const result = parseDirectives(raw)

    // Assert
    expect(result.spokenText).toBe('危险指令。')
    expect(result.directives).toEqual([])
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]?.[0]).toContain('javascript:alert(1)')
  })

  it('parses SPEAK and DISPLAY dual channels for math content', () => {
    // Arrange
    const raw = '公式讲解 [SPEAK:x 的平方加 3][DISPLAY:x²+3]'

    // Act
    const result = parseDirectives(raw)

    // Assert
    expect(result.spokenText).toBe('公式讲解')
    expect(result.directives).toEqual([
      { kind: 'speak', text: 'x 的平方加 3' },
      { kind: 'display', text: 'x²+3' }
    ])
  })

  it('falls back to plain spokenText when no tags are present', () => {
    // Arrange
    const raw = 'just plain text no tags'

    // Act
    const result = parseDirectives(raw)

    // Assert
    expect(result.spokenText).toBe('just plain text no tags')
    expect(result.directives).toEqual([])
  })

  it('keeps every HIGHLIGHT directive when the LLM emits multiple pointers', () => {
    // Arrange
    const raw =
      '看这两处。[HIGHLIGHT:selector="#problem-2"][HIGHLIGHT:selector=".step-check"]'

    // Act
    const result = parseDirectives(raw)

    // Assert
    expect(result.spokenText).toBe('看这两处。')
    expect(result.directives).toEqual([
      { kind: 'highlight', selector: '#problem-2' },
      { kind: 'highlight', selector: '.step-check' }
    ])
  })

  it('returns empty spokenText and no directives for an empty string', () => {
    // Arrange
    const raw = ''

    // Act
    const result = parseDirectives(raw)

    // Assert
    expect(result.spokenText).toBe('')
    expect(result.directives).toEqual([])
  })

  it('accepts every whitelisted selector prefix', () => {
    // Arrange
    const raw =
      '三处指点。'
      + '[HIGHLIGHT:selector="#problem-alpha"]'
      + '[HIGHLIGHT:selector=".step-beta_1"]'
      + '[HIGHLIGHT:selector="[data-evidence-id="ev-42"]"]'

    // Act
    const result = parseDirectives(raw)

    // Assert
    expect(result.spokenText).toBe('三处指点。')
    expect(result.directives).toEqual([
      { kind: 'highlight', selector: '#problem-alpha' },
      { kind: 'highlight', selector: '.step-beta_1' },
      { kind: 'highlight', selector: '[data-evidence-id="ev-42"]' }
    ])
  })

  it('exposes the whitelist so downstream consumers can inspect it', () => {
    // Arrange / Act / Assert
    expect(SELECTOR_WHITELIST).toHaveLength(4)
    expect(SELECTOR_WHITELIST[0]?.test('#problem-1')).toBe(true)
    expect(SELECTOR_WHITELIST[1]?.test('.step-1')).toBe(true)
    expect(SELECTOR_WHITELIST[2]?.test('[data-evidence-id="ev-1"]')).toBe(true)
    expect(SELECTOR_WHITELIST[3]?.test('[data-katex-id="math-1-step-2"]')).toBe(
      true
    )
  })

  it('accepts data-katex-id HIGHLIGHT selectors for math dual-channel', () => {
    const raw =
      '看平方项。[HIGHLIGHT:selector="[data-katex-id="math-1-step-2"]"]'
    const result = parseDirectives(raw)
    expect(result.directives).toEqual([
      { kind: 'highlight', selector: '[data-katex-id="math-1-step-2"]' }
    ])
  })
})
