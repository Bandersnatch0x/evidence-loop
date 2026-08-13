import type {
  MasteryProfileMap,
  NextPracticeItem,
  NextPracticePlan,
  PracticePrioritySource,
  Question,
  QuestionSummary
} from '../../shared/contracts'
import { MASTERY_THRESHOLD } from '../config/mastery'
import type { InterventionService } from '../mastery/InterventionService'
import type { MasteryProfileReader } from '../mastery/InterventionService'
import type { QuestionStore } from '../questionbank/QuestionStore'
import type { ReviewScheduler } from '../review/ReviewScheduler'
import type { AttemptStore } from '../store/AttemptStore'
import {
  TeachingUnitNotFoundError,
  type OrgReader
} from './OrgReader'

export interface NextPracticeServiceOptions {
  review: ReviewScheduler
  mastery: MasteryProfileReader
  interventions: InterventionService
  questions: QuestionStore
  org: OrgReader
  /** Optional: skip recently attempted questions when selecting from the bank. */
  attempts?: AttemptStore
  now?: () => Date
  /** Max KP slots in the returned plan. Default 10. */
  defaultLimit?: number
  /** Questions per KP. Default 2. */
  questionsPerKp?: number
}

export interface GenerateNextPracticeOptions {
  /** Cap on KP slots (after merge). */
  limit?: number
  /** Questions to attach per KP. */
  questionsPerKp?: number
  /**
   * Teacher bank author. Defaults to TeachingUnit.teacherId so the plan
   * draws from the unit owner's private bank (T03).
   */
  authorId?: string
  now?: Date
}

/**
 * Student "today's practice" engine (T06).
 *
 * Merge order (highest priority first):
 * 1. FSRS due cards (`ReviewScheduler.listDue`)
 * 2. Dependency-chain gaps (`InterventionService.suggestNextIntervention`)
 * 3. D4 taught-progress filter — only KPs in `TeachingUnit.taughtKpIds`
 *
 * Concrete questions are selected from the question bank (T03) by KP + difficulty;
 * this service never embeds stem/key content of its own.
 */
export class NextPracticeService {
  private readonly review: ReviewScheduler
  private readonly mastery: MasteryProfileReader
  private readonly interventions: InterventionService
  private readonly questions: QuestionStore
  private readonly org: OrgReader
  private readonly attempts: AttemptStore | undefined
  private readonly now: () => Date
  private readonly defaultLimit: number
  private readonly questionsPerKp: number

  public constructor(options: NextPracticeServiceOptions) {
    this.review = options.review
    this.mastery = options.mastery
    this.interventions = options.interventions
    this.questions = options.questions
    this.org = options.org
    this.attempts = options.attempts
    this.now = options.now ?? (() => new Date())
    this.defaultLimit = options.defaultLimit ?? 10
    this.questionsPerKp = options.questionsPerKp ?? 2
  }

  public async generate(
    studentId: string,
    teachingUnitId: string,
    options: GenerateNextPracticeOptions = {}
  ): Promise<NextPracticePlan> {
    const unit = this.org.getTeachingUnit(teachingUnitId)
    if (!unit) {
      throw new TeachingUnitNotFoundError(teachingUnitId)
    }

    const taughtSet = new Set(unit.taughtKpIds)
    const taughtKpIds = [...unit.taughtKpIds]
    const now = options.now ?? this.now()
    const limit = Math.min(
      Math.max(options.limit ?? this.defaultLimit, 0),
      50
    )
    const questionsPerKp = Math.min(
      Math.max(options.questionsPerKp ?? this.questionsPerKp, 1),
      10
    )
    const authorId = options.authorId ?? unit.teacherId

    if (taughtSet.size === 0 || limit === 0) {
      return {
        studentId,
        teachingUnitId,
        generatedAt: now.toISOString(),
        taughtKpIds,
        items: []
      }
    }

    // 1) FSRS due — highest priority; D4 filter drops untaught cards.
    const dueCards = this.review.listDue(studentId, now, 100)
    const merged: Array<{
      kpId: string
      source: PracticePrioritySource
      reason: string
      dueAt?: string
    }> = []
    const seen = new Set<string>()

    for (const card of dueCards) {
      if (!taughtSet.has(card.kpId)) continue
      if (seen.has(card.kpId)) continue
      seen.add(card.kpId)
      merged.push({
        kpId: card.kpId,
        source: 'fsrs_due',
        reason: 'FSRS due card within taught progress',
        dueAt: card.scheduling.dueAt
      })
      if (merged.length >= limit) break
    }

    // 2) Dependency-chain gaps on weak taught KPs (only if room remains).
    if (merged.length < limit) {
      const profile = this.mastery.getProfile(studentId)
      const weakTaught = taughtKpIds.filter(
        (kpId) => scoreOf(profile, kpId) < MASTERY_THRESHOLD
      )

      for (const weakKp of weakTaught) {
        if (merged.length >= limit) break
        const suggestion = await this.interventions.suggestNextIntervention(
          studentId,
          weakKp
        )
        // D4: intervention target must also be taught — never push untaught prereqs.
        const targetKp = taughtSet.has(suggestion.targetKp)
          ? suggestion.targetKp
          : taughtSet.has(weakKp)
            ? weakKp
            : undefined
        if (targetKp === undefined || seen.has(targetKp)) continue
        seen.add(targetKp)
        merged.push({
          kpId: targetKp,
          source: 'dependency_gap',
          reason:
            targetKp === weakKp
              ? `Weak taught KP (mastery < ${String(MASTERY_THRESHOLD)})`
              : `Prerequisite gap for weak KP ${weakKp}`
        })
      }
    }

    const recentQuestionIds = await this.collectRecentQuestionIds(studentId)
    const items: NextPracticeItem[] = merged.map((slot) => {
      const questions = this.pickQuestions({
        authorId,
        kpId: slot.kpId,
        masteryScore: scoreOf(this.mastery.getProfile(studentId), slot.kpId),
        limit: questionsPerKp,
        excludeIds: recentQuestionIds
      })
      const item: NextPracticeItem = {
        kpId: slot.kpId,
        source: slot.source,
        reason: slot.reason,
        questions: questions.map(toSummary)
      }
      if (slot.dueAt !== undefined) item.dueAt = slot.dueAt
      return item
    })

    return {
      studentId,
      teachingUnitId,
      generatedAt: now.toISOString(),
      taughtKpIds,
      items
    }
  }

  private pickQuestions(input: {
    authorId: string
    kpId: string
    masteryScore: number
    limit: number
    excludeIds: Set<string>
  }): Question[] {
    const band = difficultyBand(input.masteryScore)
    // Prefer in-band difficulty; fall back to any difficulty on that KP.
    const preferred = this.questions.list({
      authorId: input.authorId,
      kpIds: [input.kpId],
      minDifficulty: band.min,
      maxDifficulty: band.max,
      limit: 100
    })
    const fallback =
      preferred.length >= input.limit
        ? preferred
        : this.questions.list({
            authorId: input.authorId,
            kpIds: [input.kpId],
            limit: 100
          })

    const selected: Question[] = []
    const used = new Set<string>()
    for (const question of fallback) {
      if (used.has(question.id)) continue
      if (input.excludeIds.has(question.id)) continue
      used.add(question.id)
      selected.push(question)
      if (selected.length >= input.limit) break
    }

    // If everything was recently attempted, allow repeats rather than empty slots.
    if (selected.length === 0) {
      for (const question of fallback) {
        if (used.has(question.id)) continue
        used.add(question.id)
        selected.push(question)
        if (selected.length >= input.limit) break
      }
    }

    return selected
  }

  private async collectRecentQuestionIds(
    studentId: string
  ): Promise<Set<string>> {
    if (!this.attempts) return new Set()
    const recent = await this.attempts.listAttempts({ studentId })
    // Cap to the freshest slice so long histories don't ban the whole bank.
    return new Set(recent.slice(0, 50).map((attempt) => attempt.questionId))
  }
}

function scoreOf(profile: MasteryProfileMap, kpId: string): number {
  const snapshot = profile[kpId]
  return snapshot ? snapshot.score : 0
}

/**
 * Map mastery score → preferred difficulty band for consolidation.
 * Low mastery → easier items; high mastery (due review) → harder.
 */
function difficultyBand(score: number): { min: number; max: number } {
  if (score < 0.3) return { min: 1, max: 2 }
  if (score < 0.6) return { min: 2, max: 3 }
  if (score < 0.85) return { min: 3, max: 4 }
  return { min: 3, max: 5 }
}

function toSummary(question: Question): QuestionSummary {
  return {
    id: question.id,
    questionBankId: question.questionBankId,
    subject: question.subject,
    questionType: question.questionType,
    stem: question.stem,
    kpIds: question.kpIds,
    difficulty: question.difficulty,
    source: question.source,
    hasSolution: question.solution !== undefined,
    authorId: question.authorId
  }
}
