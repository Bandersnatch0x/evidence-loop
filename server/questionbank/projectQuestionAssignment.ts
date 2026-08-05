/**
 * Project a bank Question into student-facing Assignment / ExecutableAssignment
 * shells (ADR-0015 Phase 5–6).
 *
 * - `projectQuestionToAssignment` — presentation shell (stem + visualization).
 * - `projectQuestionToExecutable` — scoring shell (payload → runner + criteria).
 * - `createQuestionBackedRegistry` — registry with question-bank fallback so
 *   EvaluationAgent can score private / seed:… ids.
 */
import type {
  Assignment,
  Question,
  QuestionType,
  RubricDimension
} from '../../shared/contracts'
import type {
  AssignmentRegistry,
  EvidenceCriterion,
  ExecutableAssignment,
  PythonRunnerSpec,
  RunnerSpec
} from '../data/assignments'
import { isPythonRunnerSpec } from '../data/assignments'

const CORRECTNESS_RUBRIC: RubricDimension = {
  id: 'correctness',
  label: '答案正确性',
  description: '题库 payload 驱动的可重复评分',
  maxScore: 100
}

export function projectQuestionToAssignment(question: Question): Assignment {
  const title =
    question.stem.length > 80
      ? `${question.stem.slice(0, 77)}…`
      : question.stem

  return {
    id: question.id,
    title,
    module: `题库 · ${question.subject}`,
    language: question.subject,
    questionType: question.questionType,
    estimatedMinutes: 10,
    status: 'ready',
    objective: question.stem,
    scenario: question.stem,
    requirements: [],
    constraints: ['教师题库题 · 3D 演示为展示层，不参与评分'],
    functionSignature: '',
    rubric: [CORRECTNESS_RUBRIC],
    demoVariants: [
      {
        id: 'blank',
        label: '空白作答',
        description: '从空白开始作答',
        code: ''
      }
    ]
  }
}

/**
 * Build a full ExecutableAssignment from a bank Question so runners can score
 * private / seed questions. Returns undefined when payload is not a usable
 * RunnerSpec for the question type.
 */
export function projectQuestionToExecutable(
  question: Question
): ExecutableAssignment | undefined {
  const runner = coerceRunnerSpec(question)
  if (!runner) return undefined

  const base = projectQuestionToAssignment(question)
  const criteria = buildCriteria(question, runner)
  if (criteria.length === 0) return undefined

  return {
    ...base,
    rubric: [CORRECTNESS_RUBRIC],
    criteria,
    runner
  }
}

/**
 * Prefer demo registry; fall back to projecting a bank Question by id.
 * EvaluationAgent and any consumer of AssignmentRegistry.get share this path.
 */
export function createQuestionBackedRegistry(
  registry: AssignmentRegistry,
  peek: (id: string) => Question | undefined
): AssignmentRegistry {
  return {
    list: () => registry.list(),
    get: (id: string) => {
      const fromRegistry = registry.get(id)
      if (fromRegistry) return fromRegistry
      const question = peek(id)
      if (!question) return undefined
      return projectQuestionToExecutable(question)
    }
  }
}

// ---------------------------------------------------------------------------
// RunnerSpec + criteria synthesis from Question.payload
// ---------------------------------------------------------------------------

function coerceRunnerSpec(question: Question): RunnerSpec | undefined {
  const payload = question.payload
  if (payload === null || typeof payload !== 'object') return undefined

  if (question.questionType === 'code') {
    return isPythonRunnerSpec(payload) ? payload : undefined
  }

  if (!('kind' in payload)) return undefined
  const record = payload as Record<string, unknown>
  const kind = record.kind
  if (typeof kind !== 'string') return undefined

  // Payload kind should match questionType for non-code types.
  if (kind !== question.questionType) return undefined
  return payload as RunnerSpec
}

function buildCriteria(
  question: Question,
  runner: RunnerSpec
): EvidenceCriterion[] {
  const conceptId =
    question.kpIds[0] !== undefined && question.kpIds[0].trim() !== ''
      ? question.kpIds[0]
      : `kp.${question.subject}.general`
  const type = question.questionType

  if (type === 'choice' || type === 'fill_blank' || type === 'numeric') {
    return [
      criterion({
        id: 'answer-match',
        kind: 'answer_match',
        label: type === 'choice' ? '选项匹配' : '答案匹配',
        conceptId,
        expected: expectedFromObjectiveRunner(runner)
      })
    ]
  }

  if (type === 'expression') {
    if (
      'answers' in runner &&
      runner.answers &&
      typeof runner.answers === 'object'
    ) {
      const labels = Object.keys(runner.answers)
      if (labels.length === 0) return []
      const weight = Math.floor(100 / labels.length)
      const rem = 100 - weight * labels.length
      return labels.map((label, index) =>
        criterion({
          id: `cas-${label}`,
          kind: 'cas_check',
          label: `表达式 ${label}`,
          conceptId,
          weight: weight + (index === 0 ? rem : 0),
          expected: runner.answers?.[label]
        })
      )
    }
    return [
      criterion({
        id: 'cas-final',
        kind: 'cas_check',
        label: '表达式等价',
        conceptId,
        expected:
          'expectedLatex' in runner && typeof runner.expectedLatex === 'string'
            ? runner.expectedLatex
            : undefined
      })
    ]
  }

  if (type === 'chem_equation') {
    return [
      criterion({
        id: 'cas_check',
        kind: 'cas_check',
        label: '方程式配平与比对',
        conceptId,
        expected:
          'expectedEquation' in runner &&
          typeof runner.expectedEquation === 'string'
            ? runner.expectedEquation
            : undefined
      })
    ]
  }

  if (type === 'essay') {
    const ids = [
      'word-count',
      'paragraph-count',
      'sentence-length',
      'spelling-punctuation',
      'structure-completeness',
      'keyword-coverage'
    ] as const
    const weight = Math.floor(100 / ids.length)
    const rem = 100 - weight * ids.length
    return ids.map((id, index) =>
      criterion({
        id,
        kind: id === 'spelling-punctuation' ? 'lint_result' : 'structural_metric',
        label: id,
        conceptId,
        weight: weight + (index === 0 ? rem : 0)
      })
    )
  }

  if (type === 'geometry') {
    return [
      criterion({
        id: 'shape-vertices',
        kind: 'answer_match',
        label: '截面顶点数',
        conceptId,
        weight: 50
      }),
      criterion({
        id: 'shape-convex',
        kind: 'answer_match',
        label: '凸多边形',
        conceptId,
        weight: 50
      }),
      criterion({
        id: 'render-artifact',
        kind: 'render_artifact',
        label: '渲染参数快照',
        conceptId,
        weight: 0
      })
    ]
  }

  if (type === 'code' && isPythonRunnerSpec(runner)) {
    return criteriaFromPythonTests(runner, conceptId)
  }

  return []
}

function criteriaFromPythonTests(
  runner: PythonRunnerSpec,
  conceptId: string
): EvidenceCriterion[] {
  const tests = runner.testCases
  if (tests.length === 0) return []
  const weight = Math.floor(100 / tests.length)
  const rem = 100 - weight * tests.length
  return tests.map((test, index) =>
    criterion({
      id: test.id,
      kind: 'test',
      label: test.id,
      conceptId,
      weight: weight + (index === 0 ? rem : 0),
      expected:
        test.expected !== undefined ? JSON.stringify(test.expected) : undefined
    })
  )
}

function expectedFromObjectiveRunner(runner: RunnerSpec): string | undefined {
  if (!('kind' in runner)) return undefined
  if (runner.kind === 'choice') {
    return runner.correctOptionIds.join(', ')
  }
  if (runner.kind === 'fill_blank') {
    return runner.acceptedAnswers[0]
  }
  if (runner.kind === 'numeric') {
    return String(runner.expected)
  }
  return undefined
}

function criterion(input: {
  id: string
  kind: EvidenceCriterion['kind']
  label: string
  conceptId: string
  weight?: number
  expected?: string
}): EvidenceCriterion {
  return {
    id: input.id,
    kind: input.kind,
    label: input.label,
    dimensionId: 'correctness',
    visibility: 'public',
    weight: input.weight ?? 100,
    conceptId: input.conceptId,
    passedMessage: `${input.label}通过`,
    failedMessage: `${input.label}未通过`,
    ...(input.expected !== undefined ? { expected: input.expected } : {})
  }
}

/** Exported for tests that assert questionType → criteria shape. */
export function criteriaForQuestionType(
  questionType: QuestionType,
  question: Question,
  runner: RunnerSpec
): EvidenceCriterion[] {
  return buildCriteria({ ...question, questionType }, runner)
}
