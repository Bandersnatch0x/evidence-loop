import { createHash, createHmac, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import {
  createEmptyCard,
  FSRS,
  State,
  type Card
} from 'ts-fsrs'
import type {
  EvaluationResult,
  ReviewCard,
  SchedulingState
} from '../../shared/contracts'
import { extractKpIds } from '../mastery/MasteryService'

const GENESIS_HASH = '0'.repeat(64)

export type ReviewRating = 1 | 2 | 3 | 4

interface ReviewCardRow {
  id: string
  student_id: string
  kp_id: string
  stability: number
  difficulty: number
  due_at: string
  state: string
  reps: number
  lapses: number
  last_review_at: string | null
  elapsed_days: number
  scheduled_days: number
  learning_steps: number
  prev_hash: string
  hmac: string
}

export interface ReviewSchedulerOptions {
  db: Database.Database
  hmacSecret: string
}

/**
 * FSRS-backed review scheduler.
 * Persistence uses SchedulingState field names — never MasteryLevel (ADR-0007).
 */
export class ReviewScheduler {
  private readonly db: Database.Database
  private readonly hmacSecret: string
  private readonly fsrs: FSRS
  private lastHash = GENESIS_HASH

  public constructor(options: ReviewSchedulerOptions) {
    if (options.hmacSecret.trim() === '') {
      throw new Error('ReviewScheduler requires a non-empty HMAC secret')
    }
    this.db = options.db
    this.hmacSecret = options.hmacSecret
    this.fsrs = new FSRS({ enable_fuzz: false })

    const tip = this.db
      .prepare(`SELECT * FROM review_cards ORDER BY rowid DESC LIMIT 1`)
      .get() as ReviewCardRow | undefined
    if (tip) {
      this.lastHash = computeCardPayloadHash({
        id: tip.id,
        studentId: tip.student_id,
        kpId: tip.kp_id,
        stability: tip.stability,
        difficulty: tip.difficulty,
        dueAt: tip.due_at,
        state: tip.state,
        reps: tip.reps,
        lapses: tip.lapses,
        lastReviewAt: tip.last_review_at,
        prevHash: tip.prev_hash
      })
    }
  }

  /**
   * Map an evidence / mastery score in [0, 1] onto an FSRS Grade.
   * Boundaries (inclusive lower where stated in issue 010):
   *   < 0.3 → Again, [0.3, 0.6) → Hard, [0.6, 0.85) → Good, ≥ 0.85 → Easy
   */
  public static scoreToRating(score: number): ReviewRating {
    if (score < 0.3) return 1
    if (score < 0.6) return 2
    if (score < 0.85) return 3
    return 4
  }

  public applyReview(
    studentId: string,
    kpId: string,
    rating: ReviewRating,
    now: Date = new Date()
  ): ReviewCard {
    const existing = this.getRow(studentId, kpId)
    const card = existing ? rowToFsrsCard(existing) : createEmptyCard(now)
    const next = this.fsrs.next(card, now, rating)
    return this.persistCard(studentId, kpId, next.card, existing?.id)
  }

  /**
   * After evaluation, push one FSRS review per affected knowledge point
   * using the per-kp weighted pass rate as the rating signal.
   */
  public applyFromEvaluation(evaluation: EvaluationResult): ReviewCard[] {
    const studentId = evaluation.studentId
    if (!studentId || evaluation.status !== 'completed') {
      return []
    }

    const kpIds = extractKpIds(evaluation)
    const updated: ReviewCard[] = []
    const now = new Date(evaluation.createdAt)

    for (const kpId of kpIds) {
      const kpEvidence = evaluation.evidence.filter(
        (item) => item.conceptId === kpId
      )
      if (kpEvidence.length === 0) continue

      let weightSum = 0
      let weightedScore = 0
      for (const item of kpEvidence) {
        weightSum += item.weight
        weightedScore += (item.state === 'passed' ? 1 : 0) * item.weight
      }
      const score = weightSum > 0 ? weightedScore / weightSum : 0
      const rating = ReviewScheduler.scoreToRating(score)
      updated.push(this.applyReview(studentId, kpId, rating, now))
    }

    return updated
  }

  public listDue(studentId: string, now: Date = new Date(), limit = 20): ReviewCard[] {
    const capped = Math.min(Math.max(limit, 1), 100)
    const rows = this.db
      .prepare(
        `
        SELECT *
        FROM review_cards
        WHERE student_id = @studentId AND due_at <= @now
        ORDER BY due_at ASC
        LIMIT @limit
        `
      )
      .all({
        studentId,
        now: now.toISOString(),
        limit: capped
      }) as ReviewCardRow[]

    return rows.map(rowToReviewCard)
  }

  public getById(cardId: string): ReviewCard | undefined {
    const row = this.db
      .prepare(`SELECT * FROM review_cards WHERE id = @id`)
      .get({ id: cardId }) as ReviewCardRow | undefined
    return row ? rowToReviewCard(row) : undefined
  }

  public complete(
    cardId: string,
    rating: ReviewRating,
    now: Date = new Date()
  ): ReviewCard | undefined {
    const row = this.db
      .prepare(`SELECT * FROM review_cards WHERE id = @id`)
      .get({ id: cardId }) as ReviewCardRow | undefined
    if (!row) return undefined
    return this.applyReview(row.student_id, row.kp_id, rating, now)
  }

  private getRow(studentId: string, kpId: string): ReviewCardRow | undefined {
    return this.db
      .prepare(
        `SELECT * FROM review_cards WHERE student_id = @studentId AND kp_id = @kpId`
      )
      .get({ studentId, kpId }) as ReviewCardRow | undefined
  }

  private persistCard(
    studentId: string,
    kpId: string,
    card: Card,
    existingId?: string
  ): ReviewCard {
    const id = existingId ?? `card_${randomUUID()}`
    const dueAt = toIso(card.due)
    const state = stateToLabel(card.state)
    const lastReviewAt =
      card.last_review === undefined || card.last_review === null
        ? null
        : toIso(card.last_review)
    const prevHash = this.lastHash
    const payloadHash = computeCardPayloadHash({
      id,
      studentId,
      kpId,
      stability: card.stability,
      difficulty: card.difficulty,
      dueAt,
      state,
      reps: card.reps,
      lapses: card.lapses,
      lastReviewAt,
      prevHash
    })
    const hmac = signHash(payloadHash, this.hmacSecret)

    this.db
      .prepare(
        `
        INSERT INTO review_cards (
          id, student_id, kp_id, stability, difficulty, due_at, state,
          reps, lapses, last_review_at, elapsed_days, scheduled_days,
          learning_steps, prev_hash, hmac
        ) VALUES (
          @id, @student_id, @kp_id, @stability, @difficulty, @due_at, @state,
          @reps, @lapses, @last_review_at, @elapsed_days, @scheduled_days,
          @learning_steps, @prev_hash, @hmac
        )
        ON CONFLICT(student_id, kp_id) DO UPDATE SET
          stability = excluded.stability,
          difficulty = excluded.difficulty,
          due_at = excluded.due_at,
          state = excluded.state,
          reps = excluded.reps,
          lapses = excluded.lapses,
          last_review_at = excluded.last_review_at,
          elapsed_days = excluded.elapsed_days,
          scheduled_days = excluded.scheduled_days,
          learning_steps = excluded.learning_steps,
          prev_hash = excluded.prev_hash,
          hmac = excluded.hmac
        `
      )
      .run({
        id,
        student_id: studentId,
        kp_id: kpId,
        stability: card.stability,
        difficulty: card.difficulty,
        due_at: dueAt,
        state,
        reps: card.reps,
        lapses: card.lapses,
        last_review_at: lastReviewAt,
        elapsed_days: card.elapsed_days,
        scheduled_days: card.scheduled_days,
        learning_steps: card.learning_steps,
        prev_hash: prevHash,
        hmac
      })

    this.lastHash = payloadHash
    return {
      id,
      studentId,
      kpId,
      scheduling: {
        stability: card.stability,
        difficulty: card.difficulty,
        dueAt,
        state,
        reps: card.reps,
        lapses: card.lapses,
        lastReviewAt: lastReviewAt ?? undefined
      }
    }
  }
}

function rowToFsrsCard(row: ReviewCardRow): Card {
  return {
    due: new Date(row.due_at),
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsed_days,
    scheduled_days: row.scheduled_days,
    reps: row.reps,
    lapses: row.lapses,
    learning_steps: row.learning_steps,
    state: labelToState(row.state),
    last_review: row.last_review_at ? new Date(row.last_review_at) : undefined
  }
}

function rowToReviewCard(row: ReviewCardRow): ReviewCard {
  return {
    id: row.id,
    studentId: row.student_id,
    kpId: row.kp_id,
    scheduling: {
      stability: row.stability,
      difficulty: row.difficulty,
      dueAt: row.due_at,
      state: row.state as SchedulingState['state'],
      reps: row.reps,
      lapses: row.lapses,
      lastReviewAt: row.last_review_at ?? undefined
    }
  }
}

function stateToLabel(state: State): SchedulingState['state'] {
  switch (state) {
    case State.New:
      return 'new'
    case State.Learning:
      return 'learning'
    case State.Review:
      return 'review'
    case State.Relearning:
      return 'relearning'
    default:
      return 'new'
  }
}

function labelToState(label: string): State {
  switch (label) {
    case 'learning':
      return State.Learning
    case 'review':
      return State.Review
    case 'relearning':
      return State.Relearning
    case 'new':
    default:
      return State.New
  }
}

function toIso(value: Date | string | number): string {
  if (value instanceof Date) return value.toISOString()
  return new Date(value).toISOString()
}

function computeCardPayloadHash(input: {
  id: string
  studentId: string
  kpId: string
  stability: number
  difficulty: number
  dueAt: string
  state: string
  reps: number
  lapses: number
  lastReviewAt: string | null
  prevHash: string
}): string {
  const payload = [
    input.id,
    input.studentId,
    input.kpId,
    String(input.stability),
    String(input.difficulty),
    input.dueAt,
    input.state,
    String(input.reps),
    String(input.lapses),
    input.lastReviewAt ?? '',
    input.prevHash
  ].join('\n')
  return createHash('sha256').update(payload, 'utf8').digest('hex')
}

function signHash(hash: string, secret: string): string {
  return createHmac('sha256', secret).update(hash, 'utf8').digest('hex')
}


