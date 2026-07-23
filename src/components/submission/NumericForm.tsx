interface NumericFormProps {
  value: string
  disabled: boolean
  onChange: (value: string) => void
  /** Unit hint shown next to the field (display only, not submitted). */
  unit?: string
}

/**
 * Numeric-answer input (工单 030). A single numeric field; the server
 * NumericValidator parses the value and compares against the expected value
 * within the configured tolerance. Only the number is submitted, no unit.
 */
export function NumericForm({ value, disabled, onChange, unit }: NumericFormProps) {
  return (
    <div className="numeric-form">
      <p className="submission-hint">只填写数值，不要带单位。</p>
      <div className="numeric-input-row">
        <input
          type="text"
          inputMode="decimal"
          className="submission-input"
          aria-label="数值答案"
          value={value}
          disabled={disabled}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => onChange(event.target.value)}
        />
        {unit !== undefined && <span className="numeric-unit">{unit}</span>}
      </div>
    </div>
  )
}
