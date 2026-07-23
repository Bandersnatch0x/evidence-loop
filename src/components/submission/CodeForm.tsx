interface CodeFormProps {
  value: string
  disabled: boolean
  onChange: (value: string) => void
  /** Source file label shown in the toolbar (display only). */
  fileName?: string
}

/**
 * Code input (工单 030). Preserves the existing dark code editor look from
 * EditorPanel so the code question type keeps its familiar workspace while all
 * other types dispatch to their own forms through SubmissionForm.
 */
export function CodeForm({
  value,
  disabled,
  onChange,
  fileName = 'solution.py'
}: CodeFormProps) {
  return (
    <div className="code-editor-shell">
      <div className="code-toolbar" aria-hidden="true">
        <span>{fileName}</span>
        <span>UTF-8</span>
      </div>
      <textarea
        aria-label="代码编辑器"
        value={value}
        spellCheck={false}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}
