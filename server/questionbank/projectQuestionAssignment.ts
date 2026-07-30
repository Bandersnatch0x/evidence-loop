/**
 * Project a bank Question into a student-facing Assignment shell (ADR-0015
 * Phase 5). Used when GET /api/assignments/:id misses the demo registry but
 * matches a question id (private or seed:…).
 *
 * Presentation only: carries stem + visualization so Visualizer can render.
 * Does not invent a full ExecutableAssignment runner path — evaluate still
 * needs a registry assignment or a future payload-backed runner projection.
 */
import type { Assignment, Question } from '../../shared/contracts'

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
    rubric: [
      {
        id: 'presentation',
        label: '展示',
        description: '题库题工作台壳（量规以 Attempt 评分为准）',
        maxScore: 0
      }
    ],
    demoVariants: [
      {
        id: 'blank',
        label: '空白作答',
        description: '从空白开始作答',
        code: ''
      }
    ],
    ...(question.visualization
      ? { visualization: question.visualization }
      : {})
  }
}

/**
 * Resolve teacher-authored visualization for an assignment id.
 * Prefer seed:<id> (demo path), then bare id (private question as workspace id).
 */
export function resolveVisualizationForAssignmentId(
  peek: (id: string) => Question | undefined,
  assignmentId: string
): Question['visualization'] {
  return (
    peek(`seed:${assignmentId}`)?.visualization ??
    peek(assignmentId)?.visualization
  )
}
