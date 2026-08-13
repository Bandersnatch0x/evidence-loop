/** Demo roles, audit log view, cohort snapshot, product identity. */

import type { SubjectLanguage } from './evaluation'

/** Demo role used by the mock multi-tenant access control layer. */
export type DemoRole = 'student' | 'teacher' | 'admin'

export interface AuditLogItem {
  id: string
  sequence: number
  timestamp: string
  actorRole: string
  actorId: string | null
  action: string
  resourceType: string
  resourceId: string | null
  studentId: string | null
  containerId: string | null
  result: string | null
  /** Interaction modality when present (ADR-0005 §7). */
  modality?: 'text' | 'voice' | null
  metadata?: Record<string, string | number | boolean | null> | null
}

export interface CohortLearner {
  id: string
  displayName: string
  assignmentTitle: string
  attempts: number
  latestScore: number
  delta: number
  focusConcept: string
  state: 'on-track' | 'needs-attention' | 'not-started'
  lastActiveAt: string
}

export interface CohortSnapshot {
  cohortName: string
  generatedAt: string
  completionRate: number
  /**
   * Formal median — excludes subjective submissions still awaiting
   * teacherAnnotation (T08/T11 P4: 终裁后才入 Cohort).
   */
  medianScore: number
  needsAttention: number
  /**
   * Count of completed results with requiresTeacherConfirmation advisory
   * but no teacherAnnotation yet (T11 P4).
   */
  pendingAdjudication: number
  learners: CohortLearner[]
}

// ---------------------------------------------------------------------------
// Product data model (T01) — org / person / attempt aggregate roots
// ---------------------------------------------------------------------------

/** D1 dual-mode attempt: practice feeds FSRS only; assessment feeds formal mastery. */
export type SessionMode = 'practice' | 'assessment'

/** Two-layer product roles (no school admin). */
export type ProductRole = 'student' | 'teacher'

/** Natural person; accounts bind via User. */
export interface Person {
  id: string
  displayName: string
}

/** Account bound to a Person with a single role (student | teacher). */
export interface User {
  id: string
  personId: string
  role: ProductRole
  /** Login handle: student number, or teacher email / employee id. */
  loginId: string
  createdAt: string
}

/** Academic term slice (D4). */
export interface Term {
  id: string
  name: string
  startAt: string
  endAt: string
}

/** Administrative class (homeroom). */
export interface Class {
  id: string
  name: string
}

/** Subject catalog entry (knowledge-graph ownership dimension). */
export interface Subject {
  id: string
  name: string
  /** Optional bridge to existing scoring SubjectLanguage. */
  language?: SubjectLanguage
}

/**
 * Teaching unit = class × subject (D3). Carries the taught KP set for D4
 * cohort filtering (un-taught KPs must not alarm).
 */
export interface TeachingUnit {
  id: string
  teacherId: string
  classId: string
  subjectId: string
  termId: string
  taughtKpIds: string[]
}

/** Student enrollment in an administrative class for a term. */
export interface Enrollment {
  id: string
  studentId: string
  classId: string
  termId: string
}
