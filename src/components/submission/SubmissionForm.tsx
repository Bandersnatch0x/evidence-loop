import type { QuestionType } from '../../../shared/contracts'
import { ChemEquationForm } from './ChemEquationForm'
import { ChoiceForm } from './ChoiceForm'
import { CodeForm } from './CodeForm'
import { EssayForm } from './EssayForm'
import { ExpressionForm } from './ExpressionForm'
import { FillBlankForm } from './FillBlankForm'
import { NumericForm } from './NumericForm'

interface SubmissionFormProps {
  questionType: QuestionType
  value: string
  disabled: boolean
  onChange: (value: string) => void
}

function assertNever(value: never): never {
  throw new Error(`Unhandled question type: ${JSON.stringify(value)}`)
}

/**
 * Dispatch component (工单 030): renders the input surface for a question type.
 *
 * Scoring is split by question type, not subject (ADR-0008), so the form is
 * chosen from `questionType` alone. Every branch serialises its state into a
 * single submission string that the server runner for that type parses — the
 * shared `EvaluateRequest.code` field carries code, LaTeX, option ids, numbers,
 * equations, or essay text without any per-type request contract.
 */
export function SubmissionForm({
  questionType,
  value,
  disabled,
  onChange
}: SubmissionFormProps) {
  switch (questionType) {
    case 'choice':
      return <ChoiceForm value={value} disabled={disabled} onChange={onChange} />
    case 'fill_blank':
      return <FillBlankForm value={value} disabled={disabled} onChange={onChange} />
    case 'numeric':
      return <NumericForm value={value} disabled={disabled} onChange={onChange} />
    case 'expression':
      return <ExpressionForm value={value} disabled={disabled} onChange={onChange} />
    case 'chem_equation':
      return (
        <ChemEquationForm value={value} disabled={disabled} onChange={onChange} />
      )
    case 'essay':
      return <EssayForm value={value} disabled={disabled} onChange={onChange} />
    case 'code':
      return <CodeForm value={value} disabled={disabled} onChange={onChange} />
    case 'geometry':
      // Geometry submission = comma-separated vertex ids (e.g. "A,C,F,H").
      // Reuse FillBlankForm's free-text input until a dedicated form is warranted.
      return <FillBlankForm value={value} disabled={disabled} onChange={onChange} />
    default:
      return assertNever(questionType)
  }
}
