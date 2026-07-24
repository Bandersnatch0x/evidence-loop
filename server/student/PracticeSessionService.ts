import type {
  PracticeSession,
  SessionMode,
  StartPracticeRequest,
  StartPracticeResponse
} from '../../shared/contracts'
import { randomUUID } from 'node:crypto'
import type { AttemptStore } from '../store/AttemptStore'
import type { EvaluationResult } from '../../shared/contracts'

/**
 * T07 practice-session service.
 *
 * Sessions are *derived* from Attempt metadata (teachingUnitId/mode/paperId +
 * temporal grouping), not a separate store — the AttemptStore is the single
 * source of truth (ponytail: no new table for what listAttempts can project).
 *
 * D1 gate: a session's mode is inherited from its attempts. practice sessions
 * enable tutoring; assessment sessions disable it. The caller (studentRoutes)
 * decides tutoringEnabled from mode, never from client claims.
 */
export interface PracticeSessionServiceOptions {
  attempts: AttemptStore
  now?: () => Date
}

const SESSION_WINDOW_MS = 1000 * 60 * 60 * 2 // 2h temporal grouping for single

export class PracticeSessionService {
  private readonly attempts: AttemptStore
  private readonly now: () => Date

  public constructor(options: PracticeSessionServiceOptions) {
    this.attempts = options.attempts
    this.now = options.now ?? (() => new Date())
  }

  /**
   * Start a fresh practice attempt. Creates a placeholder Attempt the student
   * will submit against. The real EvaluationResult is written when the
   * /api/evaluations POST path scores it (existing flow).
   */
  public async startPractice(
    input: StartPracticeRequest,
    studentId: string
  ): Promise<StartPracticeResponse> {
    const createdAt = this.now().toISOString()
    const attemptId = `att_${randomUUID()}`
    const placeholder = makePlaceholderForPractice({
      id: attemptId,
      studentId,
      questionId: input.questionId,
      teachingUnitId: input.teachingUnitId,
      termId: input.termId,
      mode: input.mode,
      paperId: input.paperId,
      createdAt
    })
    await this.attempts.saveAttempt(placeholder)
    return {
      attemptId,
      mode: input.mode,
      // D1: tutoring layers open only in practice mode.
      tutoringEnabled: input.mode === 'practice'
    }
  }

  /**
   * List a student's practice sessions, newest first. Single attempts become
   * 'single' sessions; attempts sharing a paperId become one 'paper' session.
   * Attempts without a paperId are grouped by a 2h temporal window per
   * teaching unit (so a quick自由练 streak looks like one session).
   */
  public async listSessions(
    studentId: string
  ): Promise<PracticeSession[]> {
    const attempts = await this.attempts.listAttempts({ studentId })
    return deriveSessions(attempts)
  }
}

interface SessionAccumulator {
  id: string
  studentId: string
  mode: SessionMode
  teachingUnitId: string
  termId: string
  shape: 'single' | 'paper'
  attemptIds: string[]
  startedAt: string
  lastActiveAt: string
  paperId?: string
}

/**
 * Group attempts into sessions. Paper-batched attempts share paperId; the rest
 * are single-attempt sessions (自由练 is inherently one-question-one-submit).
 * Sorted newest-first by lastActiveAt.
 */
function deriveSessions(
  attempts: ReadonlyArray<{
    id: string
    studentId: string
    teachingUnitId: string
    termId: string
    mode: SessionMode
    createdAt: string
    result: { id: string; assignmentId: string }
  }>
): PracticeSession[] {
  // attempts arrive newest-first from listAttempts
  const byPaper = new Map<string, SessionAccumulator>()
  const singles: SessionAccumulator[] = []

  for (const attempt of attempts) {
    const paperId = paperIdOf(attempt)
    if (paperId) {
      const existing = byPaper.get(paperId)
      if (existing) {
        existing.attemptIds.push(attempt.id)
        existing.lastActiveAt = newer(existing.lastActiveAt, attempt.createdAt)
        existing.startedAt = older(existing.startedAt, attempt.createdAt)
      } else {
        byPaper.set(paperId, {
          id: `sess_paper_${paperId}`,
          studentId: attempt.studentId,
          mode: attempt.mode,
          teachingUnitId: attempt.teachingUnitId,
          termId: attempt.termId,
          shape: 'paper',
          attemptIds: [attempt.id],
          startedAt: attempt.createdAt,
          lastActiveAt: attempt.createdAt,
          paperId
        })
      }
    } else {
      singles.push({
        id: `sess_single_${attempt.id}`,
        studentId: attempt.studentId,
        mode: attempt.mode,
        teachingUnitId: attempt.teachingUnitId,
        termId: attempt.termId,
        shape: 'single',
        attemptIds: [attempt.id],
        startedAt: attempt.createdAt,
        lastActiveAt: attempt.createdAt
      })
    }
  }

  const all = [...byPaper.values(), ...singles]
  all.sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))
  return all.map(toSession)
}

function toSession(acc: SessionAccumulator): PracticeSession {
  return {
    id: acc.id,
    studentId: acc.studentId,
    mode: acc.mode,
    teachingUnitId: acc.teachingUnitId,
    termId: acc.termId,
    shape: acc.shape,
    attemptIds: acc.attemptIds,
    startedAt: acc.startedAt,
    lastActiveAt: acc.lastActiveAt,
    paperId: acc.paperId
  }
}

/**
 * Paper binding is read from the attempt result's assignmentId when the id
 * carries a paper_ prefix (placeholder attempts created by the assignment
 * batch path stamp paperId into the result id namespace). Single自由练
 * attempts have no paper binding.
 */
function paperIdOf(attempt: {
  result: { id: string; assignmentId: string }
}): string | undefined {
  // AssignmentService stamps paperId into the attempt result.assignmentId when
  // the attempt belongs to a paper batch. Heuristic: assignmentId starts with
  // paper_ marks a batched attempt.
  const aid = attempt.result.assignmentId
  return aid.startsWith('paper_') ? aid : undefined
}

function newer(a: string, b: string): string {
  return a.localeCompare(b) >= 0 ? a : b
}
function older(a: string, b: string): string {
  return a.localeCompare(b) <= 0 ? a : b
}

/**
 * Placeholder attempt for a freshly started practice session. Not completed,
 * so it never feeds mastery / FSRS until the learner submits (status becomes
 * completed). Mirrors AssignByWeaknessService.makePlaceholderAttempt shape.
 */
function makePlaceholderForPractice(input: {
  id: string
  studentId: string
  questionId: string
  teachingUnitId: string
  termId: string
  mode: SessionMode
  paperId?: string
  createdAt: string
}): {
  id: string
  studentId: string
  questionId: string
  teachingUnitId: string
  termId: string
  mode: SessionMode
  createdAt: string
  result: EvaluationResult
} {
  const result: EvaluationResult = {
    id: input.id,
    // assignmentId doubles as the questionId OR paperId binding for sessions.
    assignmentId: input.paperId ?? input.questionId,
    attempt: 1,
    createdAt: input.createdAt,
    status: 'rejected',
    score: 0,
    summary: 'Practice session placeholder (not yet submitted)',
    rejectionReason: 'practice_not_submitted',
    evidence: [],
    dimensions: [],
    diagnoses: [],
    trace: [],
    mastery: [],
    feedbackSource: 'local-policy',
    studentId: input.studentId,
    provenance: {
      kind: 'evidence',
      evidenceIds: [],
      algorithm: 'simple.v1'
    }
  }
  return {
    id: input.id,
    studentId: input.studentId,
    questionId: input.questionId,
    teachingUnitId: input.teachingUnitId,
    termId: input.termId,
    mode: input.mode,
    createdAt: input.createdAt,
    result
  }
}

export { SESSION_WINDOW_MS }
