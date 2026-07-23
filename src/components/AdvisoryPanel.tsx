import { MessageCircle, UserCheck } from 'lucide-react'
import type { AdvisorySuggestion } from '../../shared/contracts'

interface AdvisoryPanelProps {
  suggestions: AdvisorySuggestion[]
}

/**
 * Subjective advisory区 (工单 030, ADR-0008 §2 / ADR-0006 §3).
 *
 * Renders essay coaching notes that are deliberately NOT scores. Every item is
 * `llm_inference`-provenanced, so it uses the grey bubble treatment from
 * ADR-0006's three-colour system (灰色 + 气泡图标 + "AI 推断"), and is visually
 * separated from the evidence-backed formal score. The teacher-confirmation gate
 * is stated explicitly: nothing here enters scoring without a human.
 */
export function AdvisoryPanel({ suggestions }: AdvisoryPanelProps) {
  if (suggestions.length === 0) return null

  return (
    <section className="advisory-panel" aria-labelledby="advisory-title">
      <header className="advisory-header">
        <div className="advisory-badge">
          <MessageCircle size={13} aria-hidden="true" />
          AI 建议 · 需教师确认 · 不计入分数
        </div>
        <h3 id="advisory-title">主观维度建议</h3>
        <p className="advisory-caption">
          以下建议由模型推断产出（llm_inference），未经证据验证，仅供参考。教师确认前不影响任何正式分数或班级指标。
        </p>
      </header>

      <ul className="advisory-list">
        {suggestions.map((item) => (
          <li className="advisory-item" key={item.id}>
            <div className="advisory-bubble-icon" aria-hidden="true">
              <MessageCircle size={15} />
            </div>
            <div className="advisory-body">
              <div className="advisory-item-head">
                <strong>{item.dimensionLabel}</strong>
                <span className="advisory-provenance-tag">
                  AI 推断 · {item.provenance.model}
                </span>
              </div>
              <p className="advisory-suggestion">{item.suggestion}</p>
              <p className="advisory-gate">
                <UserCheck size={12} aria-hidden="true" />
                需教师确认后才可采纳
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
