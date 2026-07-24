import type { Attempt, ReviewCard } from '../../shared/contracts'
import type { MasteryService } from '../mastery/MasteryService'
import type { ReviewScheduler } from '../review/ReviewScheduler'

/**
 * D1 dual-mode projection for completed Attempts (T06).
 *
 * - **Every completed attempt** feeds FSRS via `ReviewScheduler.applyFromEvaluation`
 *   (practice is still a review signal).
 * - **Only `mode === 'assessment'`** may recompute formal MasteryProfile.
 *   Practice is excluded byte-for-byte (T01 projector already filters, and
 *   this gate keeps the evaluate→project path honest even when callers pass
 *   practice attempts into the same helper).
 */
export interface EvidenceProjectorOptions {
  mastery: MasteryService
  review: ReviewScheduler
}

export interface ProjectionResult {
  /** Knowledge points whose formal mastery was recomputed (assessment only). */
  masteryKpIds: string[]
  /** Review cards updated by FSRS (both modes). */
  reviewCards: ReviewCard[]
}

export class EvidenceProjector {
  private readonly mastery: MasteryService
  private readonly review: ReviewScheduler

  public constructor(options: EvidenceProjectorOptions) {
    this.mastery = options.mastery
    this.review = options.review
  }

  public async projectAttempt(attempt: Attempt): Promise<ProjectionResult> {
    if (attempt.result.status !== 'completed') {
      return { masteryKpIds: [], reviewCards: [] }
    }

    // Align EvaluationResult.studentId with the Attempt root so FSRS / mastery
    // attribute the signal to the same learner.
    const evaluation = {
      ...attempt.result,
      studentId: attempt.result.studentId ?? attempt.studentId
    }

    const reviewCards = this.review.applyFromEvaluation(evaluation)

    if (attempt.mode !== 'assessment') {
      return { masteryKpIds: [], reviewCards }
    }

    const masteryKpIds = await this.mastery.recomputeFromEvaluation(evaluation)
    return { masteryKpIds, reviewCards }
  }
}
