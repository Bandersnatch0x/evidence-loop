/** Knowledge graph + advisory layer contracts. */

import type { Provenance } from './evaluation'

export interface KnowledgePoint {
  id: string
  name: string
  parentId?: string
  weight: number
}

export interface KpPrerequisite {
  kpId: string
  prereqId: string
  strength: number
}

export interface KnowledgeGraph {
  points: KnowledgePoint[]
  edges: KpPrerequisite[]
}

/**
 * Subjective advisory suggestion (ADR-0008 §2).
 *
 * Produced by the AdvisoryLayer for essay / subjective dimensions that have
 * **no reproducible evidence** (立意、洞察、论证质量、语言表达). These are
 * deliberately NOT scores: the type carries no numeric `score`/`weight`/`earned`
 * field, so it can never be folded into a Rubric total. Every suggestion is
 * `llm_inference`-provenanced, requires teacher confirmation before it can
 * influence any Cohort metric, and honours ADR-0001's evidence-first rule by
 * staying out of the automatic score entirely.
 */
export interface AdvisorySuggestion {
  id: string
  /** The subjective dimension this advice targets (e.g. 立意 / 论证质量). */
  dimensionLabel: string
  /** Human-readable coaching note. This is advice, never a grade. */
  suggestion: string
  /**
   * Always `llm_inference` — subjective advice is model-derived, never
   * evidence-backed. Narrowed from Provenance so an evidence-kind tag can
   * never be attached to advisory output.
   */
  provenance: Extract<Provenance, { kind: 'llm_inference' }>
  /**
   * Hard teacher gate. Literal `true` so the compiler forbids constructing an
   * auto-applied advisory — nothing here enters scoring without a human.
   */
  requiresTeacherConfirmation: true
}
