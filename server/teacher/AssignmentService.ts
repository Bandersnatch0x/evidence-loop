import { randomUUID } from 'node:crypto'
import type {
  AssignmentKind,
  Attempt,
  CreateAssignmentInput,
  CreateAssignmentResult,
  EvaluationResult,
  SessionMode
} from '../../shared/contracts'
import type { Paper, QuestionBankService } from '../questionbank/QuestionBankService'
import type { AssignByWeaknessService } from '../adaptive/AssignByWeaknessService'
import type { AttemptStore } from '../store/AttemptStore'

/**
 * T08 assignment service. Three shapes (T08):
 * - handpick:        teacher selects explicit question ids
 * - assemble_by_kp:  KP filter → QuestionBankService.assembleByKnowledgePoints
 * - by_weakness:     T06 AssignByWeaknessService (aggregate class weak KPs)
 *
 * Each shape produces a Paper (paperId) + batched placeholder Attempts
 * (student × question). Placeholders are not-completed so they never feed
 * mastery/FSRS until the learner submits (D1). The attempt result.assignmentId
 * is stamped with the paperId so the T07 session derivation can group them.
 */
export interface AssignmentServiceOptions {
  questionBank: QuestionBankService
  weakness?: AssignByWeaknessService
  attempts: AttemptStore
  now?: () => Date
}

export class AssignmentError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'AssignmentError'
  }
}

export class AssignmentService {
  private readonly questionBank: QuestionBankService
  private readonly weakness: AssignByWeaknessService | undefined
  private readonly attempts: AttemptStore
  private readonly now: () => Date

  public constructor(options: AssignmentServiceOptions) {
    this.questionBank = options.questionBank
    this.weakness = options.weakness
    this.attempts = options.attempts
    this.now = options.now ?? (() => new Date())
  }

  public async create(
    input: CreateAssignmentInput,
    teacherId: string
  ): Promise<CreateAssignmentResult> {
    const createdAt = this.now().toISOString()

    if (input.kind === 'by_weakness') {
      if (!this.weakness) {
        throw new AssignmentError(
          'by_weakness requires the AssignByWeakness service (T06) to be wired'
        )
      }
      const result = await this.weakness.assign({
        teachingUnitId: input.teachingUnitId,
        teacherId,
        kpIds: input.kpIds,
        studentIds: input.studentIds,
        limit: input.limit,
        mode: input.mode
      })
      return {
        teachingUnitId: result.teachingUnitId,
        kind: 'by_weakness',
        paperId: result.paperId,
        attemptIds: result.attemptIds,
        studentIds: result.studentIds,
        questionIds: result.questionIds,
        mode: result.mode,
        createdAt
      }
    }

    // handpick / assemble_by_kp both resolve a paper first, then fan out
    // placeholder attempts per student × question (no mastery write yet).
    const paper = this.resolvePaper(input, teacherId)
    const studentIds = this.resolveStudents(input)
    if (studentIds.length === 0) {
      throw new AssignmentError('No target students for this assignment')
    }
    if (paper.questionIds.length === 0) {
      throw new AssignmentError('Assignment has no questions')
    }

    const attemptIds: string[] = []
    for (const studentId of studentIds) {
      for (const questionId of paper.questionIds) {
        const attemptId = `att_${randomUUID()}`
        const attempt = makePlaceholderForAssignment({
          id: attemptId,
          studentId,
          questionId,
          teachingUnitId: input.teachingUnitId,
          mode: input.mode,
          paperId: paper.id,
          createdAt
        })
        await this.attempts.saveAttempt(attempt)
        attemptIds.push(attemptId)
      }
    }

    return {
      teachingUnitId: input.teachingUnitId,
      kind: input.kind,
      paperId: paper.id,
      attemptIds,
      studentIds,
      questionIds: [...paper.questionIds],
      mode: input.mode,
      createdAt
    }
  }

  private resolvePaper(
    input: CreateAssignmentInput,
    teacherId: string
  ): Paper {
    if (input.kind === 'handpick') {
      if (!input.questionIds || input.questionIds.length === 0) {
        throw new AssignmentError('handpick requires questionIds')
      }
      // Validate each id is owned by the teacher (teacher-private bank).
      const ids = [...new Set(input.questionIds)]
      for (const id of ids) {
        // Throws QuestionNotFoundError / QuestionOwnershipError on miss.
        this.questionBank.get(id, teacherId)
      }
      return {
        id: `paper_${randomUUID()}`,
        title: input.title ?? '手选布置',
        authorId: teacherId,
        questionIds: ids,
        createdAt: this.now().toISOString()
      }
    }

    // assemble_by_kp
    if (!input.kpIds || input.kpIds.length === 0) {
      throw new AssignmentError('assemble_by_kp requires kpIds')
    }
    return this.questionBank.assembleByKnowledgePoints({
      authorId: teacherId,
      kpIds: input.kpIds,
      limit: input.limit,
      title: input.title ?? '按知识点组卷'
    })
  }

  private resolveStudents(
    input: CreateAssignmentInput
  ): string[] {
    if (input.studentIds && input.studentIds.length > 0) {
      return [...new Set(input.studentIds.filter((id) => id.trim() !== ''))]
    }
    // Without explicit students the caller must supply them — the T06
    // by_weakness path resolves the whole class itself; handpick/assemble
    // require explicit studentIds (no org access here to avoid coupling).
    throw new AssignmentError(
      `${input.kind} requires explicit studentIds (use by_weakness for whole-class)`
    )
  }
}

/**
 * Placeholder attempt bound to a paper. result.assignmentId stamps the paperId
 * (paper_ prefix) so T07 deriveSessions groups batched attempts into one
 * 'paper' session. status=rejected so it never feeds mastery until submitted.
 */
function makePlaceholderForAssignment(input: {
  id: string
  studentId: string
  questionId: string
  teachingUnitId: string
  mode: SessionMode
  paperId: string
  createdAt: string
}): Attempt {
  const result: EvaluationResult = {
    id: input.id,
    // assignmentId carries the paperId so session derivation groups the batch.
    assignmentId: input.paperId,
    attempt: 1,
    createdAt: input.createdAt,
    status: 'rejected',
    score: 0,
    summary: 'Assignment placeholder (not yet attempted)',
    rejectionReason: 'assigned_not_started',
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
    termId: 'assigned-term',
    mode: input.mode,
    createdAt: input.createdAt,
    result
  }
}

export type { AssignmentKind }
