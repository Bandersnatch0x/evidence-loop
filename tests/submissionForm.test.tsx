import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { QuestionType } from '../shared/contracts'
import { SubmissionForm } from '../src/components/submission/SubmissionForm'

/**
 * Controlled harness: SubmissionForm is fully controlled, so the test tracks
 * the serialised submission string the dispatched form pushes back on change.
 */
function renderForm(questionType: QuestionType, initial = '') {
  const onChange = vi.fn()
  let value = initial
  const rerenderWith = (next: string) => {
    value = next
  }
  const utils = render(
    <SubmissionForm
      questionType={questionType}
      value={value}
      disabled={false}
      onChange={(next) => {
        rerenderWith(next)
        onChange(next)
      }}
    />
  )
  return { onChange, ...utils }
}

describe('SubmissionForm dispatch', () => {
  it('renders the choice options and serialises the selected id set', async () => {
    const user = userEvent.setup()
    const { onChange } = renderForm('choice')

    const optionB = screen.getByRole('button', { name: 'B' })
    await user.click(optionB)

    expect(onChange).toHaveBeenLastCalledWith('B')
  })

  it('renders a fill-blank text field and forwards the typed answer', async () => {
    const user = userEvent.setup()
    const { onChange } = renderForm('fill_blank')

    await user.type(screen.getByLabelText('填空答案'), 'H')

    expect(onChange).toHaveBeenLastCalledWith('H')
  })

  it('renders a numeric field that only submits the number', async () => {
    const user = userEvent.setup()
    const { onChange } = renderForm('numeric')

    await user.type(screen.getByLabelText('数值答案'), '2')

    expect(onChange).toHaveBeenLastCalledWith('2')
  })

  it('renders the expression final-answer field', async () => {
    const user = userEvent.setup()
    const { onChange } = renderForm('expression')

    await user.type(screen.getByLabelText('最终表达式答案'), 'x')

    // Final answer is the last line; with no steps the value is just the answer.
    expect(onChange).toHaveBeenLastCalledWith('x')
  })

  it('adds an optional derivation step to the expression form', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <SubmissionForm
        questionType="expression"
        value="x^2+2*x+1"
        disabled={false}
        onChange={onChange}
      />
    )

    await user.click(
      screen.getByRole('button', { name: /添加推导步骤/ })
    )

    // A blank step line is prepended before the final answer.
    expect(onChange).toHaveBeenLastCalledWith('\nx^2+2*x+1')
  })

  it('renders a chem-equation field', async () => {
    const user = userEvent.setup()
    const { onChange } = renderForm('chem_equation')

    await user.type(screen.getByLabelText('化学方程式'), '2')

    expect(onChange).toHaveBeenLastCalledWith('2')
  })

  it('renders a multi-paragraph essay textarea', async () => {
    const user = userEvent.setup()
    const { onChange } = renderForm('essay')

    await user.type(screen.getByLabelText('作文正文'), '坚')

    expect(onChange).toHaveBeenLastCalledWith('坚')
  })

  it('renders the code editor for code questions', () => {
    render(
      <SubmissionForm
        questionType="code"
        value="def f(): pass"
        disabled={false}
        onChange={vi.fn()}
      />
    )

    expect(screen.getByLabelText('代码编辑器')).toHaveValue('def f(): pass')
  })

  it('disables inputs while evaluating', () => {
    render(
      <SubmissionForm
        questionType="fill_blank"
        value=""
        disabled
        onChange={vi.fn()}
      />
    )

    expect(screen.getByLabelText('填空答案')).toBeDisabled()
  })
})
