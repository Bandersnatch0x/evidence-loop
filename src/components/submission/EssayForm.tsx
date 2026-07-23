interface EssayFormProps {
  value: string
  disabled: boolean
  onChange: (value: string) => void
  /** Minimum word count hint shown to the learner (display only). */
  minWords?: number
}

/**
 * Essay input (工单 030). A multi-paragraph textarea; blank lines separate
 * paragraphs, which the server EssayRunner counts for the structure dimension.
 * Objective dimensions (字数/段落/句长/标点/结构/关键词) enter the formal score;
 * subjective advice comes back separately via the AdvisoryLayer (ADR-0008).
 */
export function EssayForm({ value, disabled, onChange, minWords }: EssayFormProps) {
  return (
    <div className="essay-form">
      <p className="submission-hint">
        分段书写，段落之间用空行分隔
        {minWords !== undefined ? `，建议不少于 ${minWords} 字` : ''}。
      </p>
      <textarea
        className="submission-textarea essay-textarea"
        aria-label="作文正文"
        value={value}
        disabled={disabled}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}
