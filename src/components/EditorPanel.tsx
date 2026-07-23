import { ChevronDown, LoaderCircle, Play, RotateCcw } from 'lucide-react'
import type { Assignment } from '../../shared/contracts'

interface EditorPanelProps {
  assignment: Assignment
  code: string
  selectedVariantId: string
  isEvaluating: boolean
  onCodeChange: (code: string) => void
  onVariantChange: (variantId: string) => void
  onEvaluate: () => void
}

export function EditorPanel({
  assignment,
  code,
  selectedVariantId,
  isEvaluating,
  onCodeChange,
  onVariantChange,
  onEvaluate
}: EditorPanelProps) {
  const selectedVariant = assignment.demoVariants.find(
    (variant) => variant.id === selectedVariantId
  )

  return (
    <section className="editor-panel" aria-labelledby="submission-title">
      <header className="panel-header editor-header">
        <div>
          <h2 id="submission-title">Python 解答</h2>
          <p className="panel-subtitle">当前提交</p>
        </div>
        <label className="variant-select">
          <span className="sr-only">演示版本</span>
          <select
            value={selectedVariantId}
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
      </header>

      <div className="editor-context">
        <code>{assignment.functionSignature}</code>
        <span>{selectedVariant?.description}</span>
      </div>

      <div className="code-editor-shell">
        <div className="code-toolbar" aria-hidden="true">
          <span>solution.py</span>
          <span>UTF-8</span>
        </div>
        <textarea
          aria-label="Python 代码编辑器"
          value={code}
          spellCheck={false}
          onChange={(event) => onCodeChange(event.target.value)}
        />
      </div>

      <footer className="editor-actions">
        <button
          className="secondary-button"
          type="button"
          disabled={isEvaluating || !selectedVariant}
          onClick={() => selectedVariant && onCodeChange(selectedVariant.code)}
        >
          <RotateCcw size={16} />
          重置当前版本
        </button>
        <button
          className="primary-button"
          type="button"
          disabled={isEvaluating || code.trim().length === 0}
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
