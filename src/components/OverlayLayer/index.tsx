import { useHighlightQueue } from './useHighlightQueue'

/**
 * Global highlight overlay (ADR-0005 §1, §4). An absolutely-positioned layer
 * covering the document (z-index 9999, pointer-events none) that renders one
 * fading box per queued highlight. Position is computed from the target
 * element's getBoundingClientRect plus the current scroll offset, so the box
 * tracks the element within the document. This component never imports
 * <VoiceCompanion> — it only listens for `multimodal:highlight` events.
 */
export function OverlayLayer() {
  const { items } = useHighlightQueue()

  return (
    <div className="overlay-layer" aria-hidden="true">
      {items.map((item) => (
        <div
          key={item.id}
          className="overlay-highlight"
          style={{
            left: `${item.rect.left + window.scrollX}px`,
            top: `${item.rect.top + window.scrollY}px`,
            width: `${item.rect.width}px`,
            height: `${item.rect.height}px`
          }}
        />
      ))}
    </div>
  )
}
