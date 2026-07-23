import { useId, useState } from 'react'
import { ShieldCheck } from 'lucide-react'

interface EvidenceShieldBadgeProps {
  /** Evidence ids backing the fact (ADR-0006 evidence provenance). */
  evidenceIds: string[]
  /** Deterministic algorithm that produced the score, shown for auditability. */
  algorithm?: string
  /** Optional compact rendering for inline use next to a score. */
  size?: number
}

/**
 * Blue shield marking an evidence-backed fact (ADR-0006 §3).
 *
 * Only the evidence provenance kind is represented here — the grey/green/orange
 * provenance badges are explicitly out of scope for this milestone. Clicking the
 * shield expands the concrete evidence ids so any score stays traceable.
 */
export function EvidenceShieldBadge({
  evidenceIds,
  algorithm,
  size = 15
}: EvidenceShieldBadgeProps) {
  const [isOpen, setIsOpen] = useState(false)
  const panelId = useId()
  const count = evidenceIds.length
  const tooltip = `基于 ${count} 条证据`

  return (
    <span className="evidence-shield">
      <button
        type="button"
        className="evidence-shield-trigger"
        aria-label={tooltip}
        title={tooltip}
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={() => setIsOpen((open) => !open)}
      >
        <ShieldCheck size={size} />
        <span className="evidence-shield-count">{count}</span>
      </button>
      {isOpen && (
        <div className="evidence-shield-popover" id={panelId} role="dialog">
          <div className="evidence-shield-popover-head">
            <ShieldCheck size={14} />
            <strong>{tooltip}</strong>
          </div>
          {algorithm && (
            <p className="evidence-shield-algorithm">算法 · {algorithm}</p>
          )}
          {count > 0 ? (
            <ul className="evidence-shield-list">
              {evidenceIds.map((id) => (
                <li key={id}>
                  <code>{id}</code>
                </li>
              ))}
            </ul>
          ) : (
            <p className="evidence-shield-empty">暂无绑定证据。</p>
          )}
        </div>
      )}
    </span>
  )
}
