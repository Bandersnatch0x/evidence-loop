import { createHash, randomUUID } from 'node:crypto'
import type {
  Attempt,
  CreateAssignmentInput,
  CreateAssignmentResult,
  EvaluationResult,
  SessionMode,
  TeachingUnit
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

    const dueAt = normalizeDueAt(input.dueAt)

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
        mode: input.mode,
        dueAt
      })
      return {
        teachingUnitId: result.teachingUnitId,
        kind: 'by_weakness',
        paperId: result.paperId,
        attemptIds: result.attemptIds,
        studentIds: result.studentIds,
        questionIds: result.questionIds,
        mode: result.mode,
        createdAt,
        ...(dueAt !== undefined ? { dueAt } : {})
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

    const unitsByQuestion = this.resolveQuestionUnits(
      input,
      unit,
      paper.questionIds,
      teacherId
    )
    const placeholders: Attempt[] = []
    for (const studentId of studentIds) {
      for (const questionId of paper.questionIds) {
        const questionUnit = unitsByQuestion.get(questionId) ?? unit
        const attemptId = assignmentAttemptId(paper.id, studentId, questionId)
        const attempt = makePlaceholderForAssignment({
          id: attemptId,
          studentId,
          questionId,
          teachingUnitId: questionUnit.id,
          termId: questionUnit.termId,
          mode: input.mode,
          paperId: paper.id,
          createdAt,
          dueAt
        })
        placeholders.push(attempt)
      }
    }
    const existingAttempts = await Promise.all(
      placeholders.map((attempt) => this.attempts.getAttempt(attempt.id))
    )
    const missingPlaceholders = placeholders.filter(
      (_attempt, index) => existingAttempts[index] === undefined
    )
    if (missingPlaceholders.length > 0) {
      await this.attempts.saveAttempts(missingPlaceholders)
    }
    const attemptIds = placeholders.map((attempt) => attempt.id)

    return {
      teachingUnitId: unit.id,
      kind: input.kind,
      paperId: paper.id,
      attemptIds,
      studentIds,
      questionIds: [...paper.questionIds],
      mode: input.mode,
      createdAt,
      ...(dueAt !== undefined ? { dueAt } : {})
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
      // Own private bank OR system seed bank (预置库) — not another teacher.
      const ids = [...new Set(input.questionIds)]
      for (const id of ids) {
        // Throws QuestionNotFoundError / QuestionOwnershipError on miss.
        this.questionBank.getAssignable(id, teacherId)
      }
      return {
        id: input.paperId?.trim() || `paper_${randomUUID()}`,
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
    const paper = this.questionBank.assembleByKnowledgePoints({
      authorId: teacherId,
      kpIds: input.kpIds,
      limit: input.limit,
      title: input.title ?? '按知识点组卷'
    })
    const paperId = input.paperId?.trim()
    return paperId ? { ...paper, id: paperId } : paper
  }

  private resolveQuestionUnits(
    input: CreateAssignmentInput,
    primaryUnit: TeachingUnit,
    questionIds: string[],
    teacherId: string
  ): Map<string, TeachingUnit> {
    const result = new Map<string, TeachingUnit>()
    for (const questionId of questionIds) {
      const mappedId = input.questionTeachingUnitIds?.[questionId]?.trim()
      const unitId = mappedId || primaryUnit.id
      const unit =
        unitId === primaryUnit.id
          ? primaryUnit
          : this.org.getTeachingUnit(unitId)
      if (!unit) {
        throw new AssignmentError(`Teaching unit not found: ${unitId}`)
      }
      if (unit.teacherId !== teacherId) {
        throw new AssignmentError(
          'Forbidden: only the teaching-unit teacher may assign from this unit'
        )
      }
      if (
        unit.classId !== primaryUnit.classId ||
        unit.termId !== primaryUnit.termId
      ) {
        throw new AssignmentError(
          `Teaching unit ${unit.id} must belong to the same class and term`
        )
      }
      result.set(questionId, unit)
    }
    return result
  }

  private resolveStudents(
    input: CreateAssignmentInput,
    unit: { classId: string; termId: string }
  ): string[] {
    const enrolled = new Set(
      this.org.listEnrolledStudentIds(unit.classId, unit.termId)
    )
    if (input.studentIds && input.studentIds.length > 0) {
      // T11/S2: explicit targets must already be enrolled on this unit's class×term.
      const ids = [...new Set(input.studentIds.filter((id) => id.trim() !== ''))]
      const foreign = ids.filter((id) => !enrolled.has(id))
      if (foreign.length > 0) {
        throw new AssignmentError(
          `Students not enrolled in this teaching unit: ${foreign.join(', ')}`
        )
      }
      return ids
    }
    // Whole-class default for handpick/assemble (mirrors by_weakness).
    return [...enrolled]
  }
}

function assignmentAttemptId(
  paperId: string,
  studentId: string,
  questionId: string
): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([paperId, studentId, questionId]))
    .digest('hex')
    .slice(0, 32)
  return `att_${digest}`
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
  dueAt?: string
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
    ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {}),
    result
  }
}

/** Empty / invalid → undefined; valid ISO date string kept as-is. */
function normalizeDueAt(raw: string | undefined): string | undefined {
  if (raw === undefined || raw.trim() === '') return undefined
  const ms = Date.parse(raw)
  if (Number.isNaN(ms)) {
    throw new AssignmentError(`Invalid dueAt: ${raw}`)
  }
  return new Date(ms).toISOString()
}
