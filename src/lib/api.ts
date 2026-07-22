import type {
  ApiError,
  Assignment,
  AssignmentSummary,
  CohortSnapshot,
  EvaluateRequest,
  EvaluationHistoryItem,
  EvaluationResult
} from '../../shared/contracts'

async function requestJson<T>(
  input: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers
    }
  })

  const payload = (await response.json()) as T | ApiError
  if (!response.ok) {
    const apiError = payload as ApiError
    throw new Error(apiError.details?.join('；') ?? apiError.error)
  }

  return payload as T
}

export function listAssignments(): Promise<AssignmentSummary[]> {
  return requestJson('/api/assignments')
}

export function getAssignment(id: string): Promise<Assignment> {
  return requestJson(`/api/assignments/${encodeURIComponent(id)}`)
}

export function listEvaluations(
  assignmentId?: string
): Promise<EvaluationHistoryItem[]> {
  const query = assignmentId
    ? `?assignmentId=${encodeURIComponent(assignmentId)}`
    : ''
  return requestJson(`/api/evaluations${query}`)
}

export function evaluateCode(
  request: EvaluateRequest
): Promise<EvaluationResult> {
  return requestJson('/api/evaluations', {
    method: 'POST',
    body: JSON.stringify(request)
  })
}

export function getCohort(): Promise<CohortSnapshot> {
  return requestJson('/api/cohort')
}
