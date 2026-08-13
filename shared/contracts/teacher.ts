/** Teacher workflow: units, roster, assignments, grading, tips, templates (T08/T14). */

import type { TeachingUnit, SessionMode } from './org'
import type {
  SubjectLanguage,
  TeacherAnnotation
} from './evaluation'
import type { AdvisorySuggestion } from './knowledge'

// ---------------------------------------------------------------------------
// T08 — teacher workflow: teaching unit / roster import / assignment / grading
// ---------------------------------------------------------------------------

/** A teacher creating a teaching unit (class × subject × term, D3). */
export interface CreateTeachingUnitInput {
  classId: string
  subjectId: string
  termId: string
  taughtKpIds: string[]
}

export interface TeachingUnitView extends TeachingUnit {
  className: string
  subjectName: string
  termName: string
  enrolledCount: number
}

/** Roster row for student import (T08 reuses AuthService.importStudents). */
export interface RosterRow {
  studentNumber: string
  displayName: string
}

export interface ImportedRosterEntry {
  userId: string
  loginId: string
  displayName: string
  activationCode: string
}

export interface ImportRosterResult {
  classId: string
  termId: string
  imported: ImportedRosterEntry[]
}

/** Three assignment shapes (T08): hand-pick / assemble-by-kp / by-weakness. */
export type AssignmentKind = 'handpick' | 'assemble_by_kp' | 'by_weakness'

export interface CreateAssignmentInput {
  teachingUnitId: string
  mode: SessionMode
  kind: AssignmentKind
  /** Stable paper identity for retry-safe assignment creation. */
  paperId?: string
  /** Per-question unit ownership for cross-subject papers. */
  questionTeachingUnitIds?: Record<string, string>
  /** handpick: explicit question ids. */
  questionIds?: string[]
  /** assemble_by_kp: KP filter for QuestionBankService.assembleByKnowledgePoints. */
  kpIds?: string[]
  limit?: number
  /** Optional target students; omitted = whole class. */
  studentIds?: string[]
  /** Paper/assignment title for the batch. */
  title?: string
  /** T12/P1 deadline (ISO-8601). Optional. */
  dueAt?: string
}

export interface CreateAssignmentResult {
  teachingUnitId: string
  kind: AssignmentKind
  paperId: string
  attemptIds: string[]
  studentIds: string[]
  questionIds: string[]
  mode: SessionMode
  createdAt: string
  /** Echo of input dueAt when set (T12/P1). */
  dueAt?: string
}

/**
 * A subjective (essay) item awaiting teacher final adjudication (T08).
 * The objective evidence (~40% reproducible) already entered the score;
 * the advisory AI suggestions (立意/论证) are displayed but NOT scored;
 * the teacher writes the final subjective dimension score as
 * `teacher_annotation` provenance (ADR-0006), gated by
 * requiresTeacherConfirmation. Batch grading is forbidden (守铁律).
 */
export interface GradingQueueItem {
  attemptId: string
  studentId: string
  questionId: string
  teachingUnitId: string
  stem: string
  submittedAt: string
  /** Objective evidence already scored (字数/结构/语法) — reproducible. */
  objectiveScore: number
  objectiveMaxScore: number
  /** AI advisory suggestions (灰色"AI 推断"徽章) — never scored. */
  advisory: AdvisorySuggestion[]
  /** Student's submitted answer text for the teacher to read. */
  submissionText: string
  /** Present when a teacher has already adjudicated this item. */
  teacherAnnotation?: TeacherAnnotation
}

export interface GradeSubjectiveInput {
  attemptId: string
  subjectiveScore: number
  subjectiveMaxScore: number
  note: string
}

export interface GradeSubjectiveResult {
  attemptId: string
  /** teacher_annotation provenance — never folded into the automatic score. */
  teacherAnnotation: TeacherAnnotation
}

// ---------------------------------------------------------------------------
// T14 — teacher batch tips (站内消息; never touches score)
// ---------------------------------------------------------------------------

/** Teacher-authored short tip for a teaching unit (not a grade, not Intervention). */
export interface TeacherTip {
  id: string
  teachingUnitId: string
  teacherId: string
  /** Plain text body, max ~2000 chars. */
  body: string
  createdAt: string
  /** Optional weak-KP tags (display/link only). */
  kpIds?: string[]
  /** Optional paper link (display only; never writes score). */
  paperId?: string
  /** Optional question link (display only; never writes score). */
  questionId?: string
}

/** Per-student delivery envelope for a tip (one tip → N deliveries). */
export interface TeacherTipDelivery {
  tipId: string
  studentId: string
  /** ISO-8601; absent/undefined = unread. */
  readAt?: string
}

/** POST /api/teacher/tips */
export interface CreateTeacherTipInput {
  teachingUnitId: string
  body: string
  /** Optional subset of enrolled students; omitted = whole unit. */
  studentIds?: string[]
  kpIds?: string[]
  paperId?: string
  questionId?: string
}

/**
 * 知识点任务模板（复赛 item 3）：预置题库中可一键部署的任务单元。
 *
 * 模板把「任务配置 + 量规 + 知识诊断」绑到知识点：questionId 指向系统预置库
 * （seedQuestionsFromAssignments 导入），kpIds 关联 121 节点知识 DAG，
 * 部署 = 以 handpick 布置到教学单元（练习态/测评态由部署时 mode 决定）。
 * 铁律不变：模板不写分数，分数只来自题目自身 runner 的可复现证据。
 */
export interface TaskTemplate {
  id: string
  name: string
  subject: SubjectLanguage
  /** 绑定知识点（知识 DAG 节点 id，如 kp.math.algebra.quadratic）。 */
  kpIds: string[]
  /** 系统预置库中的题目 id。 */
  questionId: string
  description: string
  estimatedMinutes: number
  difficulty: 1 | 2 | 3
}

/** list 响应：附 kp 名称便于 UI 展示。 */
export interface TaskTemplateWithKpNames extends TaskTemplate {
  kpNames: string[]
}

/** POST /api/teacher/task-templates/:id/deploy */
export interface DeployTaskTemplateInput {
  teachingUnitId: string
  /** Optional subset of enrolled students; omitted = whole class. */
  studentIds?: string[]
  /** T12/P1 deadline (ISO-8601). Optional. */
  dueAt?: string
}

export interface DeployTaskTemplateResult {
  template: TaskTemplate
  assignment: CreateAssignmentResult
}

export interface CreateTeacherTipResult {
  tip: TeacherTip
  /** Students who received a delivery envelope. */
  studentIds: string[]
  deliveryCount: number
}

/** GET /api/teacher/tips — tip + read counters for the teacher. */
export interface TeacherTipSummary extends TeacherTip {
  deliveryCount: number
  readCount: number
}

/** GET /api/student/tips — inbox item (unread first). */
export interface StudentTipItem extends TeacherTip {
  /** Present when this student has marked the tip read. */
  readAt?: string
}
