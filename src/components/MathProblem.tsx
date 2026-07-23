import { useMemo } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import seedProblems from '../../data/math-problems.seed.json'

/**
 * KaTeX math problem renderer (ticket 020 / ADR-0005 Phase 1).
 *
 * Each step is stamped with `data-katex-id` (and `data-katex-formula`) so the
 * directive dispatcher can HIGHLIGHT / DISPLAY-target the corresponding DOM
 * node without pixel-coordinate guessing.
 */

export interface MathProblemStep {
  id: string
  label: string
  latex: string
  formula: string
  speak: string
}

export interface MathProblemData {
  id: string
  title: string
  prompt: string
  steps: MathProblemStep[]
}

export interface MathProblemProps {
  /** Problem id from the seed set; defaults to the first problem. */
  problemId?: string
  /** Optional override list (tests inject a tiny fixture). */
  problems?: MathProblemData[]
}

function isMathProblemData(value: unknown): value is MathProblemData {
  if (typeof value !== 'object' || value === null) return false
  const record = value as {
    id?: unknown
    title?: unknown
    prompt?: unknown
    steps?: unknown
  }
  return (
    typeof record.id === 'string'
    && typeof record.title === 'string'
    && typeof record.prompt === 'string'
    && Array.isArray(record.steps)
  )
}

function loadSeedProblems(raw: unknown): MathProblemData[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(isMathProblemData)
}

const DEFAULT_PROBLEMS = loadSeedProblems(seedProblems)

function renderLatex(latex: string): string {
  try {
    return katex.renderToString(latex, {
      throwOnError: false,
      displayMode: true,
      strict: 'ignore'
    })
  } catch {
    return latex
  }
}

export function MathProblem({
  problemId,
  problems = DEFAULT_PROBLEMS
}: MathProblemProps) {
  const problem = useMemo(() => {
    if (problems.length === 0) return undefined
    if (problemId !== undefined) {
      return problems.find((item) => item.id === problemId) ?? problems[0]
    }
    return problems[0]
  }, [problemId, problems])

  if (problem === undefined) {
    return (
      <section className="math-problem" aria-label="数学题">
        <p className="math-problem-empty">暂无预设数学题</p>
      </section>
    )
  }

  return (
    <section
      className="math-problem"
      id={`problem-${problem.id}`}
      aria-label={problem.title}
    >
      <header className="math-problem-header">
        <h3>{problem.title}</h3>
        <p>{problem.prompt}</p>
      </header>
      <ol className="math-problem-steps">
        {problem.steps.map((step, index) => (
          <li
            key={step.id}
            className={`math-problem-step step-${String(index + 1)}`}
            data-katex-id={step.id}
            data-katex-formula={step.formula}
            data-speak={step.speak}
          >
            <span className="math-problem-step-label">{step.label}</span>
            <div
              className="math-problem-katex"
              // KaTeX output is trusted (seed/static latex only).
              dangerouslySetInnerHTML={{ __html: renderLatex(step.latex) }}
            />
          </li>
        ))}
      </ol>
    </section>
  )
}

