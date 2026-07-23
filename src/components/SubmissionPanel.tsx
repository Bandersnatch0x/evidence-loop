import { ChevronDown, LoaderCircle, Play, RotateCcw } from 'lucide-react'
import type { Assignment } from '../../shared/contracts'
import { questionTypeLabel } from '../lib/labels'
import { SubmissionForm } from './submission/SubmissionForm'

interface SubmissionPanelProps {
  assignment: Assignment
  value: string
  selectedVariantId: string
  isEvaluating: boolean
  onChange: (value: string) => void
  onVariantChange: (variantId: string) => void
  onEvaluate: () => void
}

/**
 * Generalized submission surface (工单 030). Replaces the code-only EditorPanel:
 * it keeps the same header/context/actions layout but dispatches the input body
 * to the per-questionType form via {@link SubmissionForm}. Scoring is chosen by
 * question type, not subject (ADR-0008), so this panel only needs the type to
 * pick the right form.
 *
 * The demo-variant selector is retained for every type — each assignment ships
 * sample answers (correct / wrong) so the learner can load and inspect a
 * starting point regardless of subject.
 */
export function SubmissionPanel({
  assignment,
  value,
  selectedVariantId,
  isEvaluating,
  onChange,
  onVariantChange,
  onEvaluate
}: SubmissionPanelProps) {
  const isCode = assignment.questionType === 'code'
  const isEmpty = value.trim().length === 0
  const selectedVariant = assignment.demoVariants.find(
    (variant) => variant.id === selectedVariantId
  )

  return (
    <section className="editor-panel submission-panel" aria-labelledby="submission-title">
      <header className="panel-header editor-header">
        <div>
          <h2 id="submission-title">我的作答</h2>
          <p className="panel-subtitle">
            {questionTypeLabel(assignment.questionType)} · 当前提交
          </p>
        </div>
        {assignment.demoVariants.length > 0 && (
          <label className="variant-select">
            <span className="sr-only">示例版本</span>
            <select
              value={selectedVariantId}
              disabled={isEvaluating}
              onChange={(event) => onVariantChange(event.target.value)}
            >
              {assignment.demoVariants.map((variant) => (
                <option key={variant.id} value={variant.id}>
                  {variant.label}
                </option>
              ))}
            </select>
            <ChevronDown size={15} aria-hidden="true" />
          </label>
        )}
      </header>

      <div className="editor-context">
        <code>{assignment.functionSignature}</code>
        {selectedVariant && <span>{selectedVariant.description}</span>}
      </div>

      <div className={`submission-body ${isCode ? 'is-code' : ''}`}>
        <SubmissionForm
          questionType={assignment.questionType}
          value={value}
          disabled={isEvaluating}
          onChange={onChange}
        />
      </div>

      <footer className="editor-actions">
        <button
          className="secondary-button"
          type="button"
          disabled={isEvaluating || !selectedVariant}
          onClick={() => selectedVariant && onChange(selectedVariant.code)}
        >
          <RotateCcw size={16} />
          重置当前版本
        </button>
        <button
          className="primary-button"
          type="button"
          disabled={isEvaluating || isEmpty}
          onClick={onEvaluate}
        >
          {isEvaluating ? (
            <LoaderCircle className="spinner" size={17} />
          ) : (
            <Play size={17} fill="currentColor" />
          )}
          {isEvaluating ? '正在生成证据' : '运行循证评估'}
        </button>
      </footer>
    </section>
  )
}
