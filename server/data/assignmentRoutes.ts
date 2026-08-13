/**
 * assignmentRoutes — presentation surface for assignments.
 *
 * Extracted from server/index.ts (architecture deepening C2). Serves list +
 * detail for the student/teacher workspace. Demonstration references are
 * presentation-only — never reach AssignmentRegistry / scoring.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { DemonstrationReferenceView } from '../../shared/contracts'
import type { AssignmentRegistry } from './assignments'
import type { QuestionBankService } from '../questionbank/QuestionBankService'
import { projectQuestionToAssignment } from '../questionbank/projectQuestionAssignment'
import { respondJson } from '../http/httpUtils'

export interface AssignmentRouteContext {
  assignments: AssignmentRegistry
  questionBank: Pick<QuestionBankService, 'peek'>
  /** Presentation-only: student-facing demonstration references for an assignment. */
  listStudentReferencesForAssignment: (
    assignmentId: string
  ) => readonly DemonstrationReferenceView[]
}

/**
 * Handle GET /api/assignments and GET /api/assignments/:id.
 * Returns false when the path is not an assignment route.
 */
export function handleAssignmentApi(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  context: AssignmentRouteContext
): boolean {
  const { pathname } = requestUrl

  if (request.method === 'GET' && pathname === '/api/assignments') {
    respondJson(response, 200, context.assignments.list())
    return true
  }

  const assignmentMatch = pathname.match(/^\/api\/assignments\/([^/]+)$/)
  if (request.method === 'GET' && assignmentMatch?.[1]) {
    const requestedId = decodeURIComponent(assignmentMatch[1])
    // Presentation-only reference lookup. Stays outside AssignmentRegistry so
    // EvaluationAgent/scoring never reads demonstration tables.
    const demonstrations =
      context.listStudentReferencesForAssignment(requestedId)
    const assignment = context.assignments.get(requestedId)
    if (!assignment) {
      // Scoring projection may fail on bad payload; still serve presentation shell.
      const bankQuestion = context.questionBank.peek(requestedId)
      if (!bankQuestion) {
        respondJson(response, 404, { error: 'Assignment not found' })
        return true
      }
      const projected = projectQuestionToAssignment(bankQuestion)
      if (demonstrations.length > 0) {
        projected.demonstrations = [...demonstrations]
      }
      respondJson(response, 200, projected)
      return true
    }

    const publicAssignment = {
      id: assignment.id,
      title: assignment.title,
      module: assignment.module,
      language: assignment.language,
      questionType: assignment.questionType,
      estimatedMinutes: assignment.estimatedMinutes,
      status: assignment.status,
      objective: assignment.objective,
      scenario: assignment.scenario,
      requirements: assignment.requirements,
      constraints: assignment.constraints,
      functionSignature: assignment.functionSignature,
      rubric: assignment.rubric,
      demoVariants: assignment.demoVariants,
      ...(demonstrations.length > 0
        ? { demonstrations: [...demonstrations] }
        : {})
    }
    respondJson(response, 200, publicAssignment)
    return true
  }

  return false
}
