import type {
  Question,
  QuestionSummary,
  StandardSolution
} from '../../shared/contracts'
import { newQuestionId, type QuestionQuery, type QuestionStore } from './QuestionStore'
import {
  QuestionValidationError,
  validateQuestionDraft,
  type QuestionDraft
} from './questionValidation'
import { buildTutoringContext, type TutoringContext } from './solution'
import { SEED_AUTHOR_ID } from './seedFromAssignments'

/**
 * T03 question-bank service: CRUD over teacher-private questions + 组卷 (paper
 * assembly). Ownership is teacher-private — every read/write is scoped by
 * `authorId`, and cross-teacher access is refused (共享出界). Questions carry
 * the D2 authority `source` (authored_key for teacher keys); the T09 optional
 * `solution` tiers downstream AI-tutoring trust.
 *
 * Smart weakness-based assembly is the teacher-side exit of the T06 auto-loop
 * engine; this service exposes the composition primitive (select by KP +
 * difficulty) without duplicating the FSRS/dependency-chain logic that T06 owns.
 */

export class QuestionOwnershipError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'QuestionOwnershipError'
  }
}

export class QuestionNotFoundError extends Error {
  public constructor(id: string) {
    super(`Question not found: ${id}`)
    this.name = 'QuestionNotFoundError'
  }
}

/** A composed paper: an ordered set of questions for a single布置. */
export interface Paper {
  id: string
  title: string
  authorId: string
  questionIds: string[]
  createdAt: string
}

export interface AssembleByKpOptions {
  authorId: string
  kpIds: string[]
  minDifficulty?: number
  maxDifficulty?: number
  /** Max questions in the assembled paper. */
  limit?: number
  subject?: Question['subject']
  title?: string
}

export interface QuestionBankServiceOptions {
  store: QuestionStore
  /** Injectable clock for deterministic tests. */
  now?: () => Date
}

const DEFAULT_PAPER_SIZE = 10

export class QuestionBankService {
  private readonly store: QuestionStore
  private readonly now: () => Date

  public constructor(options: QuestionBankServiceOptions) {
    this.store = options.store
    this.now = options.now ?? (() => new Date())
  }

  // ---------------------------------------------------------------------------
  // CRUD (teacher-private)
  // ---------------------------------------------------------------------------

  /**
   * Create a structured Question from teacher hand-entry. Validates the draft
   * (subject / type / stem / type-matched RunnerSpec payload / KP tags /
   * difficulty / optional solution). The persisted answer key is stamped with
   * the D2 authority source (default authored_key — a teacher wrote it).
   */
  public create(draft: QuestionDraft): Question {
    const normalized = validateQuestionDraft(draft)
    const question: Question = {
      ...normalized,
      id: normalized.id ?? newQuestionId(),
      createdAt: normalized.createdAt ?? this.now().toISOString()
    }
    this.store.save(question)
    return question
  }

  public get(id: string, authorId: string): Question {
    const question = this.store.get(id)
    if (!question) throw new QuestionNotFoundError(id)
    this.assertOwner(question, authorId)
    return question
  }

  /**
   * Resolve a question the teacher may assign: own private bank OR system
   * seed bank (T03 预置库 / T06「老师题库/预置库选」). Edit/delete still use
   * get() and refuse seed rows so teachers cannot rewrite the built-in bank.
   */
  public getAssignable(id: string, teacherId: string): Question {
    const question = this.store.get(id)
    if (!question) throw new QuestionNotFoundError(id)
    if (
      question.authorId === teacherId ||
      question.authorId === SEED_AUTHOR_ID
    ) {
      return question
    }
    throw new QuestionOwnershipError(
      'Forbidden: question belongs to another teacher (question bank is private)'
    )
  }

  /** List questions owned by `authorId`, with optional filters. */
  public list(
    authorId: string,
    filters: Omit<QuestionQuery, 'authorId'> = {}
  ): QuestionSummary[] {
    return this.store
      .list({ ...filters, authorId })
      .map(toSummary)
  }

  /**
   * Update an existing question the teacher owns. Re-validates the merged draft
   * so the answer key can never drift into an invalid RunnerSpec. Changing the
   * answer key re-stamps source (still authored_key unless overridden) — the
   * downstream Attempt recompute is handled by the caller (裁决: 翻转
   * authored_key + 重算受影响 Attempt).
   */
  public update(
    id: string,
    authorId: string,
    patch: Partial<QuestionDraft>
  ): Question {
    const existing = this.get(id, authorId)
    const draft: QuestionDraft = {
      id: existing.id,
      createdAt: existing.createdAt,
      questionBankId: patch.questionBankId ?? existing.questionBankId,
      authorId: existing.authorId,
      subject: patch.subject ?? existing.subject,
      questionType: patch.questionType ?? existing.questionType,
      stem: patch.stem ?? existing.stem,
      payload: patch.payload ?? existing.payload,
      kpIds: patch.kpIds ?? existing.kpIds,
      difficulty: patch.difficulty ?? existing.difficulty,
      source: patch.source ?? existing.source,
      termId: patch.termId ?? existing.termId,
      solution: 'solution' in patch ? patch.solution : existing.solution
    }
    const normalized = validateQuestionDraft(draft)
    const updated: Question = {
      ...normalized,
      id: existing.id,
      createdAt: existing.createdAt
    }
    this.store.save(updated)
    return updated
  }

  public delete(id: string, authorId: string): boolean {
    // Assert ownership before delete so a teacher cannot erase another's key.
    this.get(id, authorId)
    return this.store.delete(id)
  }

  // ---------------------------------------------------------------------------
  // T09 solution access
  // ---------------------------------------------------------------------------

  /** Read a question's standard solution (T09). Undefined = 待补. */
  public getSolution(id: string, authorId: string): StandardSolution | undefined {
    return this.get(id, authorId).solution
  }

  /**
   * Build the AI-tutoring context from a question's solution presence (T09 §3):
   * present → RAG restate (low hallucination); absent → 待补 + pure-generation
   * disclaimer.
   */
  public tutoringContextFor(id: string, authorId: string): TutoringContext {
    return buildTutoringContext(this.get(id, authorId).solution)
  }

  /**
   * T09 "采纳": promote an AI-generated explanation (or any draft text) into a
   * teacher-authored standard solution. Stamps `source: 'authored'` + the
   * adopting teacher's `authorId` so provenance becomes human-authoritative
   * (D2) and downstream tutoring flips to `rag_restate`.
   *
   * Does NOT touch scores / evidence — only the Question.solution field.
   */
  public adoptSolution(
    id: string,
    authorId: string,
    draft: {
      content: string
      latex?: string
      keyPoints?: string[]
    }
  ): Question {
    // Ownership check first so foreign banks cannot be rewritten.
    this.get(id, authorId)
    const solution: StandardSolution = {
      content: draft.content,
      authorId,
      source: 'authored'
    }
    if (draft.latex !== undefined) solution.latex = draft.latex
    if (draft.keyPoints !== undefined) solution.keyPoints = draft.keyPoints
    return this.update(id, authorId, { solution })
  }

  // ---------------------------------------------------------------------------
  // 组卷 (paper assembly)
  // ---------------------------------------------------------------------------

  /**
   * Manual assembly: compose a paper from a teacher-chosen, ordered set of
   * question ids. Every id must be owned by the teacher — a foreign or missing
   * id is refused so a paper can never leak another teacher's private bank.
   */
  public assembleManual(
    authorId: string,
    questionIds: string[],
    title = '手动组卷'
  ): Paper {
    if (questionIds.length === 0) {
      throw new QuestionValidationError('A paper requires at least one question')
    }
    const seen = new Set<string>()
    for (const id of questionIds) {
      if (seen.has(id)) {
        throw new QuestionValidationError(`Duplicate question in paper: ${id}`)
      }
      seen.add(id)
      // Ownership + existence check (throws on foreign / missing id).
      this.get(id, authorId)
    }
    return this.makePaper(authorId, [...questionIds], title)
  }

  /**
   * KP-based assembly: pick questions tagged with any of the target knowledge
   * points, within an optional difficulty band. Prefer the teacher's private
   * bank, then fill from the system seed bank (T03 预置库) so cold-start demo
   * teachers can still 组卷 before hand-entering private items.
   */
  public assembleByKnowledgePoints(options: AssembleByKpOptions): Paper {
    if (options.kpIds.length === 0) {
      throw new QuestionValidationError(
        'assembleByKnowledgePoints requires at least one kpId'
      )
    }
    const limit = options.limit ?? DEFAULT_PAPER_SIZE
    const filter = {
      subject: options.subject,
      kpIds: options.kpIds,
      minDifficulty: options.minDifficulty,
      maxDifficulty: options.maxDifficulty,
      limit
    }
    const teacherMatches = this.store.list({
      ...filter,
      authorId: options.authorId
    })
    const seedMatches =
      options.authorId === SEED_AUTHOR_ID
        ? []
        : this.store.list({
            ...filter,
            authorId: SEED_AUTHOR_ID
          })
    const seen = new Set<string>()
    const merged: Question[] = []
    for (const question of [...teacherMatches, ...seedMatches]) {
      if (seen.has(question.id)) continue
      seen.add(question.id)
      merged.push(question)
      if (merged.length >= limit) break
    }
    if (merged.length === 0) {
      throw new QuestionNotFoundError(
        `no questions tagged with ${options.kpIds.join(', ')}`
      )
    }
    return this.makePaper(
      options.authorId,
      merged.map((question) => question.id),
      options.title ?? '按知识点组卷'
    )
  }

  private makePaper(
    authorId: string,
    questionIds: string[],
    title: string
  ): Paper {
    return {
      id: `paper_${this.now().getTime().toString(36)}_${String(questionIds.length)}`,
      title,
      authorId,
      questionIds,
      createdAt: this.now().toISOString()
    }
  }

  private assertOwner(question: Question, authorId: string): void {
    if (question.authorId !== authorId) {
      throw new QuestionOwnershipError(
        'Forbidden: question belongs to another teacher (question bank is private)'
      )
    }
  }
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
    hasSolution: question.solution !== undefined
  }
}
