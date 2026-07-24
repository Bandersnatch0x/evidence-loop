import type {
  AdoptSolutionInput,
  AdoptSolutionResult,
  ApiError,
  Assignment,
  AssignmentSummary,
  AuditLogItem,
  CohortSnapshot,
  CreateAssignmentInput,
  CreateAssignmentResult,
  CreateQuestionInput,
  CreateTeacherTipInput,
  CreateTeacherTipResult,
  CreateTeachingUnitInput,
  DemoRole,
  EvaluateRequest,
  EvaluationHistoryItem,
  EvaluationResult,
  GradeSubjectiveInput,
  GradeSubjectiveResult,
  GradingQueueItem,
  ImportRosterResult,
  InterventionSuggestion,
  KnowledgeGraph,
  MasteryProfileMap,
  MasteryTimelineEntry,
  MistakeBookView,
  NextPracticePlan,
  PracticeSession,
  Question,
  QuestionSummary,
  ReviewCard,
  StartPracticeRequest,
  StartPracticeResponse,
  StudentTipItem,
  TeachingUnit,
  TeacherTipSummary,
  TeachingUnitView,
  TutoringDialogueRequest,
  TutoringExplainRequest,
  TutoringResponse,
  TutoringSocraticRequest,
  UpdateQuestionInput
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

/** T05 — one-shot explain (practice always; assessment after submit). */
export function requestTutoringExplain(
  body: TutoringExplainRequest
): Promise<TutoringResponse> {
  return requestJson('/api/tutoring/explain', {
    method: 'POST',
    body: JSON.stringify(body)
  })
}

/** T05 — Socratic hints (practice only). */
export function requestTutoringSocratic(
  body: TutoringSocraticRequest
): Promise<TutoringResponse> {
  return requestJson('/api/tutoring/socratic', {
    method: 'POST',
    body: JSON.stringify(body)
  })
}

/** T05 — multi-turn dialogue (practice only). */
export function requestTutoringDialogue(
  body: TutoringDialogueRequest
): Promise<TutoringResponse> {
  return requestJson('/api/tutoring/dialogue', {
    method: 'POST',
    body: JSON.stringify(body)
  })
}

// ---------------------------------------------------------------------------
// T07 — student practice sessions + mistake book
// ---------------------------------------------------------------------------

export function listPracticeSessions(): Promise<PracticeSession[]> {
  return requestJson('/api/student/sessions')
}

export function getMistakeBook(): Promise<MistakeBookView> {
  return requestJson('/api/student/mistakes')
}

export function startPractice(
  body: StartPracticeRequest
): Promise<StartPracticeResponse> {
  return requestJson('/api/student/practice', {
    method: 'POST',
    body: JSON.stringify(body)
  })
}

/** T06/T07 — student's "today" queue (FSRS due ∩ dependency gaps ∩ D4 taught). */
export function getNextPracticePlan(
  studentId: string,
  teachingUnitId: string
): Promise<NextPracticePlan> {
  const params = new URLSearchParams({
    studentId,
    unitId: teachingUnitId
  })
  return requestJson(`/api/adaptive/next?${params.toString()}`)
}

/**
 * Map a product Question id back to a workspace Assignment id.
 * Seed bank rows use `seed:<assignmentId>` (T03 expand-contract).
 */
export function questionIdToAssignmentId(questionId: string): string {
  return questionId.startsWith('seed:') ? questionId.slice('seed:'.length) : questionId
}

/**
 * Inverse of questionIdToAssignmentId: demo assignments enter the bank as
 * `seed:<assignmentId>`, so Attempts started from the workspace must use the
 * bank id — otherwise the mistake book splits one question into two rows
 * (bare vs seed:) and cannot resolve subject/kpIds for the bare form.
 */
export function assignmentIdToQuestionId(assignmentId: string): string {
  return assignmentId.startsWith('seed:') ? assignmentId : `seed:${assignmentId}`
}

// ---------------------------------------------------------------------------
// T03 — teacher-private question bank
// ---------------------------------------------------------------------------

export function listQuestions(filters?: {
  subject?: string
  questionType?: string
  kpIds?: string[]
}): Promise<QuestionSummary[]> {
  const params = new URLSearchParams()
  if (filters?.subject) params.set('subject', filters.subject)
  if (filters?.questionType) params.set('questionType', filters.questionType)
  if (filters?.kpIds && filters.kpIds.length > 0) {
    params.set('kpIds', filters.kpIds.join(','))
  }
  const qs = params.toString()
  return requestJson(`/api/questions${qs ? `?${qs}` : ''}`)
}

export function createQuestion(body: CreateQuestionInput): Promise<Question> {
  return requestJson('/api/questions', {
    method: 'POST',
    body: JSON.stringify(body)
  })
}

export function getQuestion(id: string): Promise<Question> {
  return requestJson(`/api/questions/${encodeURIComponent(id)}`)
}

export function updateQuestion(
  id: string,
  body: UpdateQuestionInput
): Promise<Question> {
  return requestJson(`/api/questions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body)
  })
}

export function deleteQuestion(id: string): Promise<{ id: string; deleted: boolean }> {
  return requestJson(`/api/questions/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  })
}

/** T09 — promote AI/free-text draft into teacher-authored standard solution. */
export function adoptSolution(
  questionId: string,
  body: AdoptSolutionInput
): Promise<AdoptSolutionResult> {
  return requestJson(
    `/api/questions/${encodeURIComponent(questionId)}/adopt-solution`,
    {
      method: 'POST',
      body: JSON.stringify(body)
    }
  )
}

// ---------------------------------------------------------------------------
// T08 — teacher workflow
// ---------------------------------------------------------------------------

export function createTeachingUnit(
  body: CreateTeachingUnitInput
): Promise<TeachingUnit> {
  return requestJson('/api/teacher/teaching-units', {
    method: 'POST',
    body: JSON.stringify(body)
  })
}

export function listTeachingUnits(): Promise<TeachingUnitView[]> {
  return requestJson('/api/teacher/teaching-units')
}

export function getTeachingUnit(id: string): Promise<TeachingUnitView> {
  return requestJson(`/api/teacher/teaching-units/${encodeURIComponent(id)}`)
}

export function importRoster(
  teachingUnitId: string,
  rows: Array<{ studentNumber: string; displayName: string }>
): Promise<ImportRosterResult> {
  return requestJson('/api/teacher/roster/import', {
    method: 'POST',
    body: JSON.stringify({ teachingUnitId, rows })
  })
}

export function createAssignment(
  body: CreateAssignmentInput
): Promise<CreateAssignmentResult> {
  return requestJson('/api/teacher/assignments', {
    method: 'POST',
    body: JSON.stringify(body)
  })
}

export function getGradingQueue(
  teachingUnitId: string
): Promise<GradingQueueItem[]> {
  return requestJson(`/api/teacher/grading/${encodeURIComponent(teachingUnitId)}`)
}

export function gradeSubjective(
  attemptId: string,
  body: Omit<GradeSubjectiveInput, 'attemptId'>
): Promise<GradeSubjectiveResult> {
  return requestJson(`/api/teacher/grading/${encodeURIComponent(attemptId)}`, {
    method: 'POST',
    body: JSON.stringify(body)
  })
}

// ---------------------------------------------------------------------------
// T14 — teacher batch tips (in-app messages; never scores)
// ---------------------------------------------------------------------------

export function createTeacherTip(
  body: CreateTeacherTipInput
): Promise<CreateTeacherTipResult> {
  return requestJson('/api/teacher/tips', {
    method: 'POST',
    body: JSON.stringify(body)
  })
}

export function listTeacherTips(
  teachingUnitId: string
): Promise<TeacherTipSummary[]> {
  return requestJson(
    `/api/teacher/tips?teachingUnitId=${encodeURIComponent(teachingUnitId)}`
  )
}

export function listStudentTips(): Promise<StudentTipItem[]> {
  return requestJson('/api/student/tips')
}

export function markStudentTipRead(tipId: string): Promise<StudentTipItem> {
  return requestJson(`/api/student/tips/${encodeURIComponent(tipId)}/read`, {
    method: 'POST'
  })
}
