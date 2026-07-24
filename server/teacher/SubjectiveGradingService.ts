import type {
  Attempt,
  GradeSubjectiveInput,
  GradeSubjectiveResult,
  GradingQueueItem,
  TeacherAnnotation
} from '../../shared/contracts'
import type { AttemptStore } from '../store/AttemptStore'
import type { QuestionStore } from '../questionbank/QuestionStore'
import type { OrgReader } from '../adaptive/OrgReader'
import { signTeacherAnnotation } from './teacherAnnotationSignature'

/**
 * T08 subjective grading service — the human final-adjudication ring the
 * AdvisoryLayer was missing (T08 补充刚需2 / 铁律闭环).
 *
 * Flow per essay item:
 *   1. EssayRunner already produced OBJECTIVE evidence (字数/结构/语法) that
 *      entered the automatic score (~40%, reproducible).
 *   2. AdvisoryService's LLM suggestions (立意/论证) are displayed in the
 *      grading UI with a grey "AI 推断" badge — advice, never a grade.
 *   3. The teacher reads both + the submission, then writes the subjective
 *      dimension final grade → result.teacherAnnotation (teacher_annotation
 *      provenance, requiresTeacherConfirmation gate).
 *
 * 铁律守护 (ADR-0001 / ADR-0006):
 *   - The teacher grade NEVER folds into result.score. It lives in its own
 *     teacherAnnotation field so Cohort can filter evidence vs teacher layers.
 *   - No batch grading API — grade() takes ONE attemptId (每份人工判断).
 */
export interface SubjectiveGradingServiceOptions {
  attempts: AttemptStore
  questions: QuestionStore
  org: OrgReader
  /** HMAC secret for T13/P5 teacherAnnotation.signature. */
  hmacSecret: string
  now?: () => Date
}

export class SubjectiveGradingError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'SubjectiveGradingError'
  }
}

export class SubjectiveGradingService {
  private readonly attempts: AttemptStore
  private readonly questions: QuestionStore
  private readonly org: OrgReader
  private readonly hmacSecret: string
  private readonly now: () => Date

  public constructor(options: SubjectiveGradingServiceOptions) {
    if (options.hmacSecret.trim() === '') {
      throw new SubjectiveGradingError('hmacSecret is required for teacher signatures')
    }
    this.attempts = options.attempts
    this.questions = options.questions
    this.org = options.org
    this.hmacSecret = options.hmacSecret
    this.now = options.now ?? (() => new Date())
  }

  /**
   * Build the grading queue for a teaching unit: every submitted essay
   * attempt (questionType=essay) bound to that unit. Placeholders (not yet
   * submitted) are excluded — only completed submissions need adjudication.
   */
  public async queue(
    teachingUnitId: string,
    teacherId: string
  ): Promise<GradingQueueItem[]> {
    const unit = this.org.getTeachingUnit(teachingUnitId)
    if (!unit) {
      throw new SubjectiveGradingError(
        `Teaching unit not found: ${teachingUnitId}`
      )
    }
    if (unit.teacherId !== teacherId) {
      throw new SubjectiveGradingError(
        'Forbidden: only the teaching-unit teacher may grade this queue'
      )
    }

    const attempts = await this.attempts.listAttempts({ teachingUnitId })
    const items: GradingQueueItem[] = []
    for (const attempt of attempts) {
      // Only submitted essays need adjudication; skip placeholders & non-essay.
      if (attempt.result.status !== 'completed') continue
      const question = this.questions.get(attempt.questionId)
      if (!question || question.questionType !== 'essay') continue

      items.push(toQueueItem(attempt, question.stem))
    }
    // Newest submissions first — teachers triage the freshest queue.
    items.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
    return items
  }

  /**
   * Teacher final adjudication for ONE essay attempt. Writes
   * result.teacherAnnotation (teacher_annotation provenance). Never touches
   * result.score. One attemptId per call — batch grading is structurally
   * impossible here (守铁律: 主观题不可批量给分).
   */
  public async grade(
    input: GradeSubjectiveInput,
    teacherId: string
  ): Promise<GradeSubjectiveResult> {
    if (input.subjectiveMaxScore <= 0) {
      throw new SubjectiveGradingError('subjectiveMaxScore must be positive')
    }
    if (
      input.subjectiveScore < 0 ||
      input.subjectiveScore > input.subjectiveMaxScore
    ) {
      throw new SubjectiveGradingError(
        'subjectiveScore must be within [0, subjectiveMaxScore]'
      )
    }

    const attempt = await this.attempts.getAttempt(input.attemptId)
    if (!attempt) {
      throw new SubjectiveGradingError(
        `Attempt not found: ${input.attemptId}`
      )
    }
    // Authorization: the attempt's teaching unit must belong to this teacher.
    const unit = this.org.getTeachingUnit(attempt.teachingUnitId)
    if (!unit || unit.teacherId !== teacherId) {
      throw new SubjectiveGradingError(
        'Forbidden: only the teaching-unit teacher may grade this attempt'
      )
    }
    const question = this.questions.get(attempt.questionId)
    if (!question || question.questionType !== 'essay') {
      throw new SubjectiveGradingError(
        'Only essay submissions are subjectively gradable'
      )
    }

    const adjudicatedAt = this.now().toISOString()
    const signature = signTeacherAnnotation(
      {
        attemptId: attempt.id,
        teacherId,
        subjectiveScore: input.subjectiveScore,
        subjectiveMaxScore: input.subjectiveMaxScore,
        note: input.note,
        adjudicatedAt
      },
      this.hmacSecret
    )
    const teacherAnnotation: TeacherAnnotation = {
      teacherId,
      subjectiveScore: input.subjectiveScore,
      subjectiveMaxScore: input.subjectiveMaxScore,
      note: input.note,
      adjudicatedAt,
      signature
    }
    // Immutable update — write the annotation WITHOUT touching result.score.
    const updatedResult = {
      ...attempt.result,
      // provenance stays 'evidence' for the objective score; the annotation is
      // a separate teacher_annotation layer, not a provenance flip.
      teacherAnnotation
    }
    await this.attempts.saveAttempt({
      ...attempt,
      result: updatedResult
    })

    return { attemptId: attempt.id, teacherAnnotation }
  }
}

function toQueueItem(attempt: Attempt, stem: string): GradingQueueItem {
  const result = attempt.result
  const objectiveMaxScore = result.dimensions.reduce(
    (sum, d) => sum + d.maxScore,
    0
  )
  // submissionText is derived from the evidence 'actual' values — the student's
  // recorded answer. ponytail: no new storage for what evidence.actual holds.
  const submissionText = result.evidence
    .map((e) => e.actual ?? '')
    .filter((t) => t !== '')
    .join('\n\n')
  return {
    attemptId: attempt.id,
    studentId: attempt.studentId,
    questionId: attempt.questionId,
    teachingUnitId: attempt.teachingUnitId,
    stem,
    submittedAt: attempt.createdAt,
    objectiveScore: result.score,
    objectiveMaxScore,
    advisory: result.advisory ?? [],
    submissionText,
    teacherAnnotation: result.teacherAnnotation
  }
}
