interface FillBlankFormProps {
  value: string
  disabled: boolean
  onChange: (value: string) => void
}

/**
 * Fill-in-the-blank input (工单 030). A single short text field; the server
 * ObjectiveValidator normalises whitespace/case per spec before matching.
 */
export function FillBlankForm({ value, disabled, onChange }: FillBlankFormProps) {
  return (
    <div className="fill-blank-form">
      <p className="submission-hint">在空格处填入答案。</p>
      <input
        type="text"
        className="submission-input"
        aria-label="填空答案"
        value={value}
        disabled={disabled}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}
