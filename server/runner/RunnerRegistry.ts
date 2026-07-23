import type { QuestionType } from '../../shared/contracts'
import { ChemEquationValidator } from './ChemEquationValidator'
import { EssayRunner } from './EssayRunner'
import { ExpressionValidator } from './ExpressionValidator'
import { ObjectiveValidator } from './ObjectiveValidator'
import type { CodeRunner, RunnerRequest, RunnerResult } from './types'

export class UnknownQuestionTypeError extends Error {
  public readonly questionType: string

  public constructor(questionType: string) {
    super(`No runner registered for question type: ${questionType}`)
    this.name = 'UnknownQuestionTypeError'
    this.questionType = questionType
  }
}

/**
 * Routes evaluation work to the CodeRunner registered for a QuestionType.
 * Ticket 032 wires every supported type: objective validators, CAS checkers,
 * essay structural runner, and the existing code (Docker/subprocess) path.
 */
export class RunnerRegistry implements CodeRunner {
  private readonly runners = new Map<QuestionType, CodeRunner>()

  public readonly name = 'runner-registry'

  public register(questionType: QuestionType, runner: CodeRunner): this {
    this.runners.set(questionType, runner)
    return this
  }

  public has(questionType: QuestionType): boolean {
    return this.runners.has(questionType)
  }

  public get(questionType: QuestionType): CodeRunner {
    const runner = this.runners.get(questionType)
    if (!runner) {
      throw new UnknownQuestionTypeError(questionType)
    }
    return runner
  }

  /** Primary display name for health checks (prefers the code runner). */
  public displayName(): string {
    const codeRunner = this.runners.get('code')
    return codeRunner?.name ?? this.name
  }

  public async run(request: RunnerRequest): Promise<RunnerResult> {
    const questionType = request.assignment.questionType
    const runner = this.get(questionType)
    return runner.run(request)
  }

  public async warm(): Promise<void> {
    for (const runner of this.runners.values()) {
      await runner.warm?.()
    }
  }

  public async dispose(): Promise<void> {
    for (const runner of this.runners.values()) {
      await runner.dispose?.()
    }
  }
}

/**
 * Build a production registry: code runner plus every multi-discipline
 * validator (choice/fill_blank/numeric share one ObjectiveValidator instance).
 */
export function createRunnerRegistry(codeRunner: CodeRunner): RunnerRegistry {
  const objective = new ObjectiveValidator()
  return new RunnerRegistry()
    .register('code', codeRunner)
    .register('choice', objective)
    .register('fill_blank', objective)
    .register('numeric', objective)
    .register('expression', new ExpressionValidator())
    .register('chem_equation', new ChemEquationValidator())
    .register('essay', new EssayRunner())
}
