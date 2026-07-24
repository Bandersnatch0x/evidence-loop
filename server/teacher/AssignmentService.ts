import { randomUUID } from 'node:crypto'
import type {
  Attempt,
  CreateAssignmentInput,
  CreateAssignmentResult,
  EvaluationResult,
  SessionMode
} from '../../shared/contracts'
import type { Paper, QuestionBankService } from '../questionbank/QuestionBankService'
import type { AssignByWeaknessService } from '../adaptive/AssignByWeaknessService'
import type { OrgReader } from '../adaptive/OrgReader'
import type { AttemptStore } from '../store/AttemptStore'

/**
 * T08 assignment service. Three shapes (T08):
 * - handpick:        teacher selects explicit question ids
 * - assemble_by_kp:  KP filter → QuestionBankService.assembleByKnowledgePoints
 * - by_weakness:     T06 AssignByWeaknessService (aggregate class weak KPs)
 *
 * Each shape produces a Paper (paperId) + batched placeholder Attempts
 * (student × question). Placeholders are not-completed so they never feed
 * mastery/FSRS until the learner submits (D1). Paper grouping uses the
 * explicit top-level Attempt.paperId field (not an assignmentId prefix).
 */
export interface AssignmentServiceOptions {
  questionBank: QuestionBankService
  weakness?: AssignByWeaknessService
  attempts: AttemptStore
  /** Required for ownership check on handpick/assemble (unit.teacherId). */
  org: OrgReader
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
  private readonly org: OrgReader
  private readonly now: () => Date

  public constructor(options: AssignmentServiceOptions) {
    this.questionBank = options.questionBank
    this.weakness = options.weakness
    this.attempts = options.attempts
    this.org = options.org
    this.now = options.now ?? (() => new Date())
  }

  public async create(
    input: CreateAssignmentInput,
    teacherId: string
  ): Promise<CreateAssignmentResult> {
    const createdAt = this.now().toISOString()

    // Ownership gate for ALL shapes — only the unit's teacher may assign.
    // by_weakness re-checks inside AssignByWeaknessService; handpick/assemble
    // previously skipped this and allowed cross-teacher pollution.
    const unit = this.org.getTeachingUnit(input.teachingUnitId)
    if (!unit) {
      throw new AssignmentError(
        `Teaching unit not found: ${input.teachingUnitId}`
      )
    }
    if (unit.teacherId !== teacherId) {
      throw new AssignmentError(
        'Forbidden: only the teaching-unit teacher may assign from this unit'
      )
    }

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
    const studentIds = this.resolveStudents(input, unit)
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
          teachingUnitId: unit.id,
          termId: unit.termId,
          mode: input.mode,
          paperId: paper.id,
          createdAt
        })
        await this.attempts.saveAttempt(attempt)
        attemptIds.push(attemptId)
      }
    }

    return {
      teachingUnitId: unit.id,
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
    input: CreateAssignmentInput,
    unit: { classId: string; termId: string }
  ): string[] {
    if (input.studentIds && input.studentIds.length > 0) {
      return [...new Set(input.studentIds.filter((id) => id.trim() !== ''))]
    }
    // Whole-class default for handpick/assemble (mirrors by_weakness).
    return this.org.listEnrolledStudentIds(unit.classId, unit.termId)
  }
}

/**
 * Placeholder attempt bound to a paper. status=rejected so it never feeds
 * mastery until submitted. Top-level paperId drives T07 session grouping.
 */
function makePlaceholderForAssignment(input: {
  id: string
  studentId: string
  questionId: string
  teachingUnitId: string
  termId: string
  mode: SessionMode
  paperId: string
  createdAt: string
}): Attempt {
  const result: EvaluationResult = {
    id: input.id,
    assignmentId: input.questionId,
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
    termId: input.termId,
    mode: input.mode,
    createdAt: input.createdAt,
    paperId: input.paperId,
    result
  }
}
