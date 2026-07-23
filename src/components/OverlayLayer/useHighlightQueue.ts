import { useEffect, useState } from 'react'

/**
 * Subscribes to window `multimodal:highlight` events published by
 * <VoiceCompanion> and keeps a queue of highlight boxes. Each entry resolves
 * the target element's rect at publish time and auto-evicts after `fadeMs`,
 * driving the 3-second CSS fade in <OverlayLayer>. The two components stay
 * decoupled — this hook only knows the event shape, not who emits it.
 */

const HIGHLIGHT_EVENT = 'multimodal:highlight'
export const DEFAULT_FADE_MS = 3000

export interface HighlightItem {
  id: number
  selector: string
  rect: DOMRect
}

interface HighlightEventDetail {
  selector: string
}

export interface UseHighlightQueueOptions {
  /** Override the auto-evict duration (ms); defaults to 3000. For tests. */
  fadeMs?: number
}

function isHighlightDetail(detail: unknown): detail is HighlightEventDetail {
  return (
    typeof detail === 'object' &&
    detail !== null &&
    typeof (detail as HighlightEventDetail).selector === 'string'
  )
}

function resolveRect(selector: string): DOMRect | undefined {
  const target = document.querySelector(selector)
  return target?.getBoundingClientRect() ?? undefined
}

export function useHighlightQueue(
  options: UseHighlightQueueOptions = {}
): { items: HighlightItem[] } {
  const [items, setItems] = useState<HighlightItem[]>([])
  const fadeMs = options.fadeMs ?? DEFAULT_FADE_MS

  useEffect(() => {
    let nextId = 0
    const handle = (event: Event): void => {
      const detail = (event as CustomEvent<unknown>).detail
      if (!isHighlightDetail(detail)) return
      const rect = resolveRect(detail.selector)
      if (!rect) return
      const id = (nextId += 1)
      setItems((current) => [...current, { id, selector: detail.selector, rect }])
      window.setTimeout(() => {
        setItems((current) => current.filter((item) => item.id !== id))
      }, fadeMs)
    }
    window.addEventListener(HIGHLIGHT_EVENT, handle)
    return () => window.removeEventListener(HIGHLIGHT_EVENT, handle)
  }, [fadeMs])

  return { items }
}
