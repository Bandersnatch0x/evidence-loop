interface ChemEquationFormProps {
  value: string
  disabled: boolean
  onChange: (value: string) => void
}

/**
 * Chemical-equation input (工单 030). The server ChemEquationValidator accepts
 * `=`, `->`, or `→` as the reaction arrow and checks atom conservation plus a
 * reduced stoichiometric ratio, so a single text field carries the whole
 * balanced equation (e.g. `2H2+O2=2H2O`).
 */
export function ChemEquationForm({
  value,
  disabled,
  onChange
}: ChemEquationFormProps) {
  return (
    <div className="chem-equation-form">
      <p className="submission-hint">
        输入配平后的化学方程式，支持 <code>=</code>、<code>-&gt;</code> 或{' '}
        <code>→</code> 作为箭头（如 <code>2H2+O2=2H2O</code>）。
      </p>
      <input
        type="text"
        className="submission-input chem-equation-input"
        aria-label="化学方程式"
        value={value}
        disabled={disabled}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}
