import type {
  Attempt,
  MistakeBookView,
  MistakeEntry,
  SubjectLanguage
} from '../../shared/contracts'
import type { AttemptStore } from '../store/AttemptStore'
import type { QuestionStore } from '../questionbank/QuestionStore'

/**
 * T07 mistake book.
 *
 * Auto-collects incorrectly-answered questions (any attempt whose result has a
 * failed evidence atom or score below max), grouped by subject / KP. Re-attempt
 * creates a NEW practice-mode Attempt (旧错题记录保留 — progress is traceable).
 *
 * Mastery rule (T07): a question leaves the active book after N consecutive
 * ASSESSMENT-mode passes (default 2). Practice-mode passes do NOT clear it
 * (D1: practice does not feed formal mastery). This keeps the铁律 honest —
 * only assessment evidence promotes a mistake to "mastered".
 */
export interface MistakeBookServiceOptions {
  attempts: AttemptStore
  questions: QuestionStore
  /** Consecutive assessment passes to mark mastered. */
  masteryThreshold?: number
}

const DEFAULT_MASTERY_THRESHOLD = 2

export class MistakeBookService {
  private readonly attempts: AttemptStore
  private readonly questions: QuestionStore
  private readonly masteryThreshold: number

  public constructor(options: MistakeBookServiceOptions) {
    this.attempts = options.attempts
    this.questions = options.questions
    this.masteryThreshold =
      options.masteryThreshold ?? DEFAULT_MASTERY_THRESHOLD
  }

  public async view(studentId: string): Promise<MistakeBookView> {
    const all = await this.attempts.listAttempts({ studentId })
    const byQuestion = groupByQuestion(all)

    const entries: MistakeEntry[] = []
    for (const [questionId, attemptsForQuestion] of byQuestion.entries()) {
      const question = this.questions.get(questionId)
      const subject: SubjectLanguage = question?.subject ?? 'math'
      const kpIds = question?.kpIds ?? []
      const teachingUnitId = attemptsForQuestion[0]?.teachingUnitId ?? ''

      const failedAttempt = lastFailed(attemptsForQuestion)
      if (!failedAttempt) {
        // Never failed → not a mistake (or already cleared). Skip.
        continue
      }

      const consecutivePasses = countTrailingAssessmentPasses(
        attemptsForQuestion,
        this.masteryThreshold
      )
      const mastered = consecutivePasses >= this.masteryThreshold

      entries.push({
        questionId,
        teachingUnitId,
        subject,
        kpIds,
        attemptId: failedAttempt.id,
        lastScore: failedAttempt.result.score,
        lastActiveAt: failedAttempt.createdAt,
        consecutiveAssessmentPasses: consecutivePasses,
        mastered
      })
    }

    // Active first (mastered tail), newest activity first within each group.
    entries.sort((a, b) => {
      if (a.mastered !== b.mastered) return a.mastered ? 1 : -1
      return b.lastActiveAt.localeCompare(a.lastActiveAt)
    })

    const masteredCount = entries.filter((e) => e.mastered).length
    return {
      studentId,
      entries,
      activeCount: entries.length - masteredCount,
      masteredCount
    }
  }
}

function groupByQuestion(
  attempts: ReadonlyArray<Attempt>
): Map<string, Attempt[]> {
  const map = new Map<string, Attempt[]>()
  for (const attempt of attempts) {
    const list = map.get(attempt.questionId)
    if (list) {
      list.push(attempt)
    } else {
      map.set(attempt.questionId, [attempt])
    }
  }
  // Oldest-first within each question so trailing-pass counting walks time.
  for (const list of map.values()) {
    list.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }
  return map
}

/**
 * The most recent attempt that has a failed evidence atom or sub-max score.
 * Returns undefined if the student never got this question wrong.
 */
function lastFailed(
  attempts: ReadonlyArray<Attempt>
): Attempt | undefined {
  const failed = attempts.filter(
    (a) =>
      a.result.status !== 'completed' ||
      a.result.evidence.some((e) => e.state === 'failed') ||
      a.result.score < maxOf(a.result.dimensions)
  )
  if (failed.length === 0) return undefined
  return failed[failed.length - 1]
}

function maxOf(
  dimensions: ReadonlyArray<{ maxScore: number }>
): number {
  return dimensions.reduce((sum, d) => sum + d.maxScore, 0)
}

/**
 * Count trailing assessment-mode attempts that fully passed (no failed
 * evidence + completed). Practice attempts are skipped (do not count toward
 * mastery, per D1). Stops at the first non-passing attempt.
 */
function countTrailingAssessmentPasses(
  attempts: ReadonlyArray<Attempt>,
  cap: number
): number {
  let count = 0
  for (let i = attempts.length - 1; i >= 0; i--) {
    const a = attempts[i]
    if (a === undefined) continue
    if (a.mode !== 'assessment') continue
    const passed =
      a.result.status === 'completed' &&
      !a.result.evidence.some((e) => e.state === 'failed')
    if (passed) {
      count++
      if (count >= cap) return count
    } else {
      break
    }
  }
  return count
}

export { DEFAULT_MASTERY_THRESHOLD }
