interface ChoiceFormProps {
  value: string
  disabled: boolean
  onChange: (value: string) => void
  /** Option ids offered to the learner. Defaults to A–D single/multi choice. */
  options?: readonly string[]
}

const DEFAULT_OPTIONS = ['A', 'B', 'C', 'D'] as const
const OPTION_SEPARATORS = /[\s,;，、；]+/

/** Parse a submission string into the selected option set (order-insensitive). */
function parseSelected(value: string): Set<string> {
  return new Set(
    value
      .split(OPTION_SEPARATORS)
      .map((token) => token.trim())
      .filter((token) => token.length > 0)
  )
}

/**
 * Choice-question input (工单 030). Multi-select toggles cover both single and
 * multiple choice — the server ObjectiveValidator compares option sets, so the
 * submission is the selected ids joined by commas.
 */
export function ChoiceForm({
  value,
  disabled,
  onChange,
  options = DEFAULT_OPTIONS
}: ChoiceFormProps) {
  const selected = parseSelected(value)

  const toggle = (option: string) => {
    const next = new Set(selected)
    if (next.has(option)) {
      next.delete(option)
    } else {
      next.add(option)
    }
    onChange([...next].join(', '))
  }

  return (
    <div className="choice-form" role="group" aria-label="选项列表">
      <p className="submission-hint">从选项中选择（可多选）。</p>
      <div className="choice-options">
        {options.map((option) => {
          const isSelected = selected.has(option)
          return (
            <button
              key={option}
              type="button"
              className={`choice-option ${isSelected ? 'is-selected' : ''}`}
              aria-pressed={isSelected}
              disabled={disabled}
              onClick={() => toggle(option)}
            >
              <span className="choice-option-mark">{option}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
