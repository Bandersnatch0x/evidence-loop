import type {
  ApiError,
  Assignment,
  AssignmentSummary,
  AuditLogItem,
  CohortSnapshot,
  DemoRole,
  EvaluateRequest,
  EvaluationHistoryItem,
  EvaluationResult,
  InterventionSuggestion,
  KnowledgeGraph,
  MasteryProfileMap,
  MasteryTimelineEntry,
  ReviewCard
} from '../../shared/contracts'
import { DEMO_ROLE_HEADER, readStoredDemoRole } from './demoRole'

let activeDemoRole: DemoRole = readStoredDemoRole()

export function getActiveDemoRole(): DemoRole {
  return activeDemoRole
}

export function setActiveDemoRole(role: DemoRole): void {
  activeDemoRole = role
}

async function requestJson<T>(
  input: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      accept: 'application/json',
      [DEMO_ROLE_HEADER]: activeDemoRole,
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

/** Teacher panel row: voice tutoring counts only (no transcript content). */
export interface MultimodalUsageRow {
  studentId: string
  voiceCount: number
  lastVoiceAt: string
}

export function getMultimodalUsage(
  classId: string
): Promise<MultimodalUsageRow[]> {
  return requestJson(
    `/api/cohort/multimodal-usage?classId=${encodeURIComponent(classId)}`
  )
}

export function listAuditLogs(params?: {
  studentId?: string
  from?: string
  to?: string
}): Promise<AuditLogItem[]> {
  const search = new URLSearchParams()
  if (params?.studentId) search.set('studentId', params.studentId)
  if (params?.from) search.set('from', params.from)
  if (params?.to) search.set('to', params.to)
  const query = search.toString()
  return requestJson(`/api/audit${query ? `?${query}` : ''}`)
}

export function getKnowledgeGraph(): Promise<KnowledgeGraph> {
  return requestJson('/api/knowledge-points')
}

export function getMasteryProfile(
  studentId: string
): Promise<MasteryProfileMap> {
  return requestJson(`/api/mastery/${encodeURIComponent(studentId)}`)
}

export function getMasteryTimeline(
  studentId: string,
  kpId: string
): Promise<MasteryTimelineEntry[]> {
  return requestJson(
    `/api/mastery/${encodeURIComponent(studentId)}/${encodeURIComponent(
      kpId
    )}/timeline`
  )
}

export function getNextIntervention(
  studentId: string,
  kpId: string
): Promise<InterventionSuggestion> {
  const search = new URLSearchParams({ studentId, kpId })
  return requestJson(`/api/interventions/next?${search.toString()}`)
}

export function listDueReviews(studentId: string): Promise<ReviewCard[]> {
  const search = new URLSearchParams({ studentId })
  return requestJson(`/api/review/next?${search.toString()}`)
}

export function completeReview(
  cardId: string,
  rating: 1 | 2 | 3 | 4
): Promise<ReviewCard> {
  return requestJson(`/api/review/${encodeURIComponent(cardId)}/complete`, {
    method: 'POST',
    body: JSON.stringify({ rating })
  })
}
