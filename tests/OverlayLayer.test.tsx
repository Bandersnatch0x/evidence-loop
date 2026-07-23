import { act, render, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OverlayLayer } from '../src/components/OverlayLayer'
import { useHighlightQueue } from '../src/components/OverlayLayer/useHighlightQueue'

function emitHighlight(selector: string): void {
  window.dispatchEvent(
    new CustomEvent('multimodal:highlight', { detail: { selector } })
  )
}

function mountDemoTarget(): HTMLElement {
  const target = document.createElement('div')
  target.setAttribute('data-evidence-id', 'demo-1')
  document.body.appendChild(target)
  return target
}

describe('useHighlightQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('queues a highlight for a matching selector and evicts it after fadeMs', () => {
    mountDemoTarget()
    const { result } = renderHook(() => useHighlightQueue({ fadeMs: 1000 }))

    act(() => emitHighlight('[data-evidence-id="demo-1"]'))

    expect(result.current.items).toHaveLength(1)
    expect(result.current.items[0]?.selector).toBe('[data-evidence-id="demo-1"]')

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(result.current.items).toHaveLength(0)
  })

  it('ignores selectors that match no element', () => {
    const { result } = renderHook(() => useHighlightQueue({ fadeMs: 1000 }))

    act(() => emitHighlight('.does-not-exist'))

    expect(result.current.items).toHaveLength(0)
  })
})

describe('OverlayLayer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('renders a highlight box on the event and fades it out after 3 seconds', () => {
    mountDemoTarget()

    render(<OverlayLayer />)
    expect(document.querySelector('.overlay-highlight')).toBeNull()

    act(() => emitHighlight('[data-evidence-id="demo-1"]'))
    expect(document.querySelector('.overlay-highlight')).not.toBeNull()

    act(() => {
      vi.advanceTimersByTime(3000)
    })

    expect(document.querySelector('.overlay-highlight')).toBeNull()
  })
})
