import { Plus, Trash2 } from 'lucide-react'

interface ExpressionFormProps {
  value: string
  disabled: boolean
  onChange: (value: string) => void
}

/**
 * Expression input (工单 030) for math/physics CAS questions.
 *
 * The server ExpressionValidator accepts a multi-line submission where each
 * non-empty line is a derivation step and the last line is the final answer.
 * The learner always fills the final answer; optional step lines let them show
 * a derivation chain that the validator checks pairwise for CAS equivalence.
 *
 * The value is serialised as `step1\nstep2\n...\nfinalAnswer` so it round-trips
 * through the existing multi-line submission parser without any new field.
 */
export function ExpressionForm({ value, disabled, onChange }: ExpressionFormProps) {
  const lines = value.split('\n')
  const answer = lines.length > 0 ? (lines[lines.length - 1] ?? '') : ''
  const steps = lines.slice(0, -1)

  const serialise = (nextSteps: string[], nextAnswer: string): string =>
    [...nextSteps, nextAnswer].join('\n')

  const updateAnswer = (next: string) => {
    onChange(serialise(steps, next))
  }

  const updateStep = (index: number, next: string) => {
    const nextSteps = steps.map((step, position) =>
      position === index ? next : step
    )
    onChange(serialise(nextSteps, answer))
  }

  const addStep = () => {
    onChange(serialise([...steps, ''], answer))
  }

  const removeStep = (index: number) => {
    const nextSteps = steps.filter((_, position) => position !== index)
    onChange(serialise(nextSteps, answer))
  }

  return (
    <div className="expression-form">
      <p className="submission-hint">
        输入表达式（mathjs 友好形式，如 <code>x^2+2*x+1</code>）。CAS 等价即判对，
        书写形式不同也没关系。
      </p>

      {steps.length > 0 && (
        <div className="expression-steps" aria-label="推导步骤">
          {steps.map((step, index) => (
            <div className="expression-step-row" key={`step-${String(index)}`}>
              <span className="expression-step-index">{index + 1}</span>
              <input
                type="text"
                className="submission-input"
                aria-label={`推导步骤 ${index + 1}`}
                value={step}
                disabled={disabled}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => updateStep(index, event.target.value)}
              />
              <button
                type="button"
                className="expression-step-remove"
                aria-label={`删除步骤 ${index + 1}`}
                disabled={disabled}
                onClick={() => removeStep(index)}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}

      <label className="expression-answer">
        <span className="submission-field-label">最终答案</span>
        <input
          type="text"
          className="submission-input"
          aria-label="最终表达式答案"
          value={answer}
          disabled={disabled}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => updateAnswer(event.target.value)}
        />
      </label>

      <button
        type="button"
        className="expression-add-step"
        disabled={disabled}
        onClick={addStep}
      >
        <Plus size={15} /> 添加推导步骤（可选）
      </button>
    </div>
  )
}
