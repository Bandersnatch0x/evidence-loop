/** Question bank, attempt aggregate, standard solution (T01/T03/T09). */

import type { QuestionType, SubjectLanguage, EvaluationResult, EvidenceSource } from './evaluation'
import type { SessionMode } from './org'
import type { Visualization } from './visualization'

/**
 * Attempt aggregate root (T01). Replaces bare EvaluationResult as the unit of
 * practice/assessment. D1–D4 discriminator fields are required so
 * reproducible / authoritative / model-inferred states stay distinguishable.
 */
export interface Attempt {
  id: string
  studentId: string
  questionId: string
  teachingUnitId: string
  termId: string
  mode: SessionMode
  createdAt: string
  /**
   * Paper-batch binding (T07). When set, this attempt belongs to a composed
   * paper; T07 session derivation groups attempts sharing a paperId into one
   * 'paper' session. Explicit top-level field — the old practice of stuffing
   * a paper_ prefix into result.assignmentId broke under /api/evaluations
   * submit (which overwrites assignmentId with the question id).
   */
  paperId?: string
  /** T12/P1 assignment deadline (ISO-8601). Optional on free practice. */
  dueAt?: string
  /** Embedded evaluation payload (existing EvaluationResult shape). */
  result: EvaluationResult
}

/**
 * T09 standard solution (可选 text + latex). Attached to a Question so AI
 * tutoring can RAG the verified solution instead of self-computing (TR2
 *降幻觉). `source: 'authored'` mirrors the D2 authored_key authority grade —
 * a teacher wrote it, so it is human-authoritative and overridable.
 *
 * When absent, AI tutoring degrades to pure generation with a
 * `provenance.kind = 'llm_inference'` disclaimer badge.
 */
export interface StandardSolution {
  /** Standard solution body (rich text / markdown). */
  content: string
  /** Optional KaTeX/LaTeX rendering of the solution. */
  latex?: string
  /** Optional key solving steps / scoring points. */
  keyPoints?: string[]
  /** Teacher who authored the solution (D2 authored authority). */
  authorId: string
  /** Always 'authored' — a standard solution is human-authoritative. */
  source: 'authored'
}

/**
 * Question aggregate (T03). The structured unit produced by teacher hand-entry.
 * Ownership is teacher-private via `authorId` + `questionBankId`. `payload`
 * reuses the existing RunnerSpec shape (imported by the question-bank layer,
 * not re-declared here) so the RunnerRegistry routes by `questionType` without
 * a scoring rewrite. `source` carries the D2 evidence authority grade.
 */
export interface Question {
  id: string
  questionBankId: string
  authorId: string
  subject: SubjectLanguage
  questionType: QuestionType
  /** 题干（支持 LaTeX/KaTeX）. */
  stem: string
  /** Answer spec — the same RunnerSpec union the runners already consume. */
  payload: unknown
  /** Knowledge-point tags on the 121-node DAG. */
  kpIds: string[]
  /** 1..5 difficulty band. */
  difficulty: number
  /** D2 authority grade: authored_key (teacher key) or test_case (machine). */
  source: EvidenceSource
  createdAt: string
  termId?: string
  /** T09 optional standard solution (RAG context for AI tutoring). */
  solution?: StandardSolution
  /** ADR-0015 optional teacher-authored 3D visualization (presentation only). */
  visualization?: Visualization
}

/** Lightweight list projection of a Question for bank browsing. */
export interface QuestionSummary {
  id: string
  questionBankId: string
  subject: SubjectLanguage
  questionType: QuestionType
  stem: string
  kpIds: string[]
  difficulty: number
  source: EvidenceSource
  /** True when a T09 standard solution is present (else marked 待补). */
  hasSolution: boolean
  /** Author id — 'system-builtin' marks read-only seed questions. */
  authorId: string
}

/**
 * Teacher hand-entry draft for POST /api/questions (T03).
 * `authorId` is stamped server-side from the session — never trust the client.
 */
export interface CreateQuestionInput {
  questionBankId: string
  subject: SubjectLanguage
  questionType: QuestionType
  stem: string
  /** RunnerSpec payload matching questionType. */
  payload: unknown
  kpIds?: string[]
  difficulty?: number
  source?: EvidenceSource
  termId?: string
  /** Optional T09 standard solution (teacher-authored). */
  solution?: Omit<StandardSolution, 'authorId' | 'source'> & {
    authorId?: string
    source?: 'authored'
  }
}

/** PATCH /api/questions/:id — partial update of an owned question. */
export type UpdateQuestionInput = Omit<Partial<CreateQuestionInput>, 'solution'> & {
  /** null clears an existing standard solution (待补). */
  solution?: CreateQuestionInput['solution'] | null
}

/**
 * POST /api/questions/:id/adopt-solution (T09).
 * Promote an AI (or free-text) draft into a teacher-authored standard solution.
 */
export interface AdoptSolutionInput {
  content: string
  latex?: string
  keyPoints?: string[]
}

export interface AdoptSolutionResult {
  question: Question
  solution: StandardSolution | null
  tutoring: {
    mode: 'rag_restate' | 'llm_generate'
    needsSolution: boolean
    requiresDisclaimer: boolean
  }
}
