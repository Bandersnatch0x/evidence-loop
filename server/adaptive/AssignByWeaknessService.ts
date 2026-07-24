import { randomUUID } from 'node:crypto'
import type {
  AssignWeaknessResult,
  Attempt,
  EvaluationResult,
  MasteryProfileMap,
  SessionMode,
  TeachingUnit
} from '../../shared/contracts'
import { MASTERY_THRESHOLD } from '../config/mastery'
import type { MasteryProfileReader } from '../mastery/InterventionService'
import {
  QuestionNotFoundError,
  type QuestionBankService
} from '../questionbank/QuestionBankService'
import type { AttemptStore } from '../store/AttemptStore'
import {
  TeachingUnitNotFoundError,
  type OrgReader
} from './OrgReader'

export interface AssignByWeaknessServiceOptions {
  org: OrgReader
  mastery: MasteryProfileReader
  questionBank: QuestionBankService
  attempts: AttemptStore
  now?: () => Date
}

export interface AssignByWeaknessInput {
  teachingUnitId: string
  /** Teacher who owns the bank and performs the assign (session principal). */
  teacherId: string
  /** Explicit weak KPs; when omitted, aggregate class-common weak taught KPs. */
  kpIds?: string[]
  /** Target students; when omitted, every enrollment on the unit's class×term. */
  studentIds?: string[]
  limit?: number
  /** Default practice (巩固). Assessment when the teacher wants formal作业. */
  mode?: SessionMode
  /** T12/P1 optional deadline (ISO-8601). */
  dueAt?: string
}

export class AssignByWeaknessError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'AssignByWeaknessError'
  }
}

/**
 * Teacher one-click "assign consolidation by class weakness" (T06).
 *
 * 1. Resolve TeachingUnit + D4 taught set
 * 2. Aggregate weak KPs across the class (or use explicit kpIds), ∩ taught
 * 3. Assemble a paper from the teacher's private bank (T03)
 * 4. Batch-create Attempt placeholders for each student × question
 */
export class AssignByWeaknessService {
  private readonly org: OrgReader
  private readonly mastery: MasteryProfileReader
  private readonly questionBank: QuestionBankService
  private readonly attempts: AttemptStore
  private readonly now: () => Date

  public constructor(options: AssignByWeaknessServiceOptions) {
    this.org = options.org
    this.mastery = options.mastery
    this.questionBank = options.questionBank
    this.attempts = options.attempts
    this.now = options.now ?? (() => new Date())
  }

  public async assign(
    input: AssignByWeaknessInput
  ): Promise<AssignWeaknessResult> {
    const unit = this.org.getTeachingUnit(input.teachingUnitId)
    if (!unit) {
      throw new TeachingUnitNotFoundError(input.teachingUnitId)
    }

    // Only the unit's teacher may pull from their private bank via this path.
    if (unit.teacherId !== input.teacherId) {
      throw new AssignByWeaknessError(
        'Forbidden: only the teaching-unit teacher may assign from this unit'
      )
    }

    const taughtSet = new Set(unit.taughtKpIds)
    if (taughtSet.size === 0) {
      throw new AssignByWeaknessError(
        'Teaching unit has no taughtKpIds — nothing to assign (D4)'
      )
    }

    const studentIds = this.resolveStudents(unit, input.studentIds)
    if (studentIds.length === 0) {
      throw new AssignByWeaknessError(
        'No enrolled students for this teaching unit'
      )
    }

    const kpIds = this.resolveWeakKpIds(unit, studentIds, input.kpIds)
    if (kpIds.length === 0) {
      throw new AssignByWeaknessError(
        'No weak taught knowledge points to assign'
      )
    }

    const limit = Math.min(Math.max(input.limit ?? 10, 1), 50)
    const mode: SessionMode =
      input.mode === 'assessment' ? 'assessment' : 'practice'
    const createdAt = this.now().toISOString()

    let paper
    try {
      paper = this.questionBank.assembleByKnowledgePoints({
        authorId: input.teacherId,
        kpIds,
        limit,
        title: `薄弱点巩固 · ${unit.id}`
      })
    } catch (error) {
      if (error instanceof QuestionNotFoundError) {
        throw new AssignByWeaknessError(error.message)
      }
      throw error
    }

    const attemptIds: string[] = []
    for (const studentId of studentIds) {
      for (const questionId of paper.questionIds) {
        const attemptId = `att_${randomUUID()}`
        const attempt = makePlaceholderAttempt({
          id: attemptId,
          studentId,
          questionId,
          teachingUnitId: unit.id,
          termId: unit.termId,
          mode,
          paperId: paper.id,
          createdAt,
          dueAt: input.dueAt
        })
        await this.attempts.saveAttempt(attempt)
        attemptIds.push(attemptId)
      }
    }

    return {
      teachingUnitId: unit.id,
      kpIds,
      studentIds,
      questionIds: [...paper.questionIds],
      attemptIds,
      paperId: paper.id,
      mode,
      createdAt,
      ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {})
    }
  }

  private resolveStudents(
    unit: TeachingUnit,
    explicit: string[] | undefined
  ): string[] {
    const enrolled = new Set(
      this.org.listEnrolledStudentIds(unit.classId, unit.termId)
    )
    if (explicit && explicit.length > 0) {
      // T11/S2: same enrollment gate as AssignmentService.
      const ids = [...new Set(explicit.filter((id) => id.trim() !== ''))]
      const foreign = ids.filter((id) => !enrolled.has(id))
      if (foreign.length > 0) {
        throw new AssignByWeaknessError(
          `Students not enrolled in this teaching unit: ${foreign.join(', ')}`
        )
      }
      return ids
    }
    return [...enrolled]
  }

  /**
   * Prefer explicit kpIds (intersect taught). Otherwise rank taught KPs by
   * how many enrolled students are below MASTERY_THRESHOLD.
   */
  private resolveWeakKpIds(
    unit: TeachingUnit,
    studentIds: string[],
    explicit: string[] | undefined
  ): string[] {
    const taughtSet = new Set(unit.taughtKpIds)

    if (explicit && explicit.length > 0) {
      return [...new Set(explicit.filter((kp) => taughtSet.has(kp)))]
    }

    const weakCount = new Map<string, number>()
    for (const kpId of unit.taughtKpIds) {
      weakCount.set(kpId, 0)
    }

    for (const studentId of studentIds) {
      const profile = this.mastery.getProfile(studentId)
      for (const kpId of unit.taughtKpIds) {
        if (scoreOf(profile, kpId) < MASTERY_THRESHOLD) {
          weakCount.set(kpId, (weakCount.get(kpId) ?? 0) + 1)
        }
      }
    }

    return [...weakCount.entries()]
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([kpId]) => kpId)
  }
}

function scoreOf(profile: MasteryProfileMap, kpId: string): number {
  const snapshot = profile[kpId]
  return snapshot ? snapshot.score : 0
}

/**
 * Assignment placeholder: not completed, so it never feeds mastery / FSRS
 * until the learner actually submits (status becomes completed).
 */
function makePlaceholderAttempt(input: {
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
