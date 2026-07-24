/**
 * Drizzle TS-first schema for the product data model (T01).
 * SQLite dialect today; swap dialect config to move to Postgres later without
 * rewriting business types.
 */
import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex
} from 'drizzle-orm/sqlite-core'

// ---------------------------------------------------------------------------
// Migration 0001 — memory layer (mastery + review + evaluation projection)
// ---------------------------------------------------------------------------

export const masteryScores = sqliteTable(
  'mastery_scores',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    studentId: text('student_id').notNull(),
    kpId: text('kp_id').notNull(),
    score: real('score').notNull(),
    evidenceIds: text('evidence_ids').notNull(),
    computedAt: text('computed_at').notNull(),
    algorithmVersion: text('algorithm_version').notNull(),
    prevHash: text('prev_hash').notNull(),
    hmac: text('hmac').notNull()
  },
  (table) => [
    index('idx_mastery_student_kp').on(
      table.studentId,
      table.kpId,
      table.computedAt
    )
  ]
)

export const reviewCards = sqliteTable(
  'review_cards',
  {
    id: text('id').primaryKey(),
    studentId: text('student_id').notNull(),
    kpId: text('kp_id').notNull(),
    stability: real('stability').notNull(),
    difficulty: real('difficulty').notNull(),
    dueAt: text('due_at').notNull(),
    state: text('state').notNull(),
    reps: integer('reps').notNull().default(0),
    lapses: integer('lapses').notNull().default(0),
    lastReviewAt: text('last_review_at'),
    elapsedDays: real('elapsed_days').notNull().default(0),
    scheduledDays: real('scheduled_days').notNull().default(0),
    learningSteps: integer('learning_steps').notNull().default(0),
    prevHash: text('prev_hash').notNull(),
    hmac: text('hmac').notNull()
  },
  (table) => [
    uniqueIndex('idx_review_student_kp').on(table.studentId, table.kpId),
    index('idx_review_due').on(table.studentId, table.dueAt)
  ]
)

/** Lightweight evaluation projection used by mastery provenance dual-write. */
export const evaluations = sqliteTable('evaluations', {
  id: text('id').primaryKey(),
  studentId: text('student_id'),
  assignmentId: text('assignment_id'),
  createdAt: text('created_at'),
  score: real('score'),
  status: text('status'),
  provenance: text('provenance')
    .notNull()
    .default(sql`'{"kind":"evidence"}'`)
})

// ---------------------------------------------------------------------------
// Migration 0002 — product org + Attempt aggregate root
// ---------------------------------------------------------------------------

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    personId: text('person_id').notNull(),
    role: text('role').notNull(),
    loginId: text('login_id').notNull(),
    displayName: text('display_name').notNull(),
    createdAt: text('created_at').notNull()
  },
  (table) => [uniqueIndex('idx_users_login').on(table.loginId)]
)

// ---------------------------------------------------------------------------
// Migration 0003 — auth credentials + server-side sessions (T02)
// ---------------------------------------------------------------------------

export const authCredentials = sqliteTable('auth_credentials', {
  userId: text('user_id').primaryKey(),
  passwordHash: text('password_hash'),
  activationCodeHash: text('activation_code_hash'),
  mustChangePassword: integer('must_change_password').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
})

export const authSessions = sqliteTable(
  'auth_sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    role: text('role').notNull(),
    expiresAt: text('expires_at').notNull(),
    createdAt: text('created_at').notNull()
  },
  (table) => [
    index('idx_auth_sessions_user').on(table.userId),
    index('idx_auth_sessions_expires').on(table.expiresAt)
  ]
)

export const terms = sqliteTable('terms', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  startAt: text('start_at').notNull(),
  endAt: text('end_at').notNull()
})

export const classes = sqliteTable('classes', {
  id: text('id').primaryKey(),
  name: text('name').notNull()
})

export const teachingUnits = sqliteTable(
  'teaching_units',
  {
    id: text('id').primaryKey(),
    teacherId: text('teacher_id').notNull(),
    classId: text('class_id').notNull(),
    subjectId: text('subject_id').notNull(),
    termId: text('term_id').notNull(),
    /** JSON array of taught knowledge-point ids (D4). */
    taughtKpIds: text('taught_kp_ids').notNull().default(sql`'[]'`)
  },
  (table) => [
    index('idx_teaching_unit_term_class').on(
      table.termId,
      table.classId,
      table.subjectId
    )
  ]
)

export const enrollments = sqliteTable(
  'enrollments',
  {
    id: text('id').primaryKey(),
    studentId: text('student_id').notNull(),
    classId: text('class_id').notNull(),
    termId: text('term_id').notNull()
  },
  (table) => [
    uniqueIndex('idx_enrollment_unique').on(
      table.studentId,
      table.classId,
      table.termId
    ),
    index('idx_enrollment_class_term').on(table.classId, table.termId)
  ]
)

export const attempts = sqliteTable(
  'attempts',
  {
    id: text('id').primaryKey(),
    studentId: text('student_id').notNull(),
    questionId: text('question_id').notNull(),
    teachingUnitId: text('teaching_unit_id').notNull(),
    termId: text('term_id').notNull(),
    mode: text('mode').notNull(),
    createdAt: text('created_at').notNull(),
    /** Full EvaluationResult JSON (embedded for expand-contract). */
    resultJson: text('result_json').notNull()
  },
  (table) => [
    index('idx_attempts_student_created').on(table.studentId, table.createdAt),
    index('idx_attempts_question').on(table.questionId),
    index('idx_attempts_term_mode').on(table.termId, table.mode)
  ]
)

// ---------------------------------------------------------------------------
// Migration 0003 — question bank (T03) + 0004 standard solution (T09)
// ---------------------------------------------------------------------------

/**
 * Teacher-private question bank (T03). `payload_json` holds the RunnerSpec that
 * the RunnerRegistry already routes by `question_type`; `kp_ids` is a JSON
 * array tagging the 121-node knowledge DAG. `source` carries the D2 evidence
 * authority grade (authored_key for hand-entered keys, test_case for
 * machine-verified code). `solution_json` (T09) is the optional standard
 * solution added by migration 0004 — nullable so imports may omit it.
 */
export const questions = sqliteTable(
  'questions',
  {
    id: text('id').primaryKey(),
    questionBankId: text('question_bank_id').notNull(),
    authorId: text('author_id').notNull(),
    subject: text('subject').notNull(),
    questionType: text('question_type').notNull(),
    stem: text('stem').notNull(),
    payloadJson: text('payload_json').notNull(),
    kpIds: text('kp_ids').notNull().default(sql`'[]'`),
    difficulty: integer('difficulty').notNull().default(3),
    source: text('source').notNull().default('authored_key'),
    createdAt: text('created_at').notNull(),
    termId: text('term_id'),
    /** T09 standard solution (nullable JSON) — added by migration 0004. */
    solutionJson: text('solution_json')
  },
  (table) => [
    index('idx_questions_author').on(table.authorId, table.createdAt),
    index('idx_questions_bank').on(table.questionBankId),
    index('idx_questions_type').on(table.questionType)
  ]
)

// ---------------------------------------------------------------------------
// Migration 0005 — import drafts (T04 OCR / document import + human gate)
// ---------------------------------------------------------------------------

/**
 * OCR/parse drafts. Never used for scoring until teacher confirm promotes
 * items into `questions` (D2). `items_json` holds ImportDraftItem[].
 */
export const importDrafts = sqliteTable(
  'import_drafts',
  {
    id: text('id').primaryKey(),
    authorId: text('author_id').notNull(),
    questionBankId: text('question_bank_id').notNull(),
    subject: text('subject').notNull(),
    status: text('status').notNull().default('pending_review'),
    sourceFilename: text('source_filename').notNull(),
    parseMethod: text('parse_method').notNull(),
    rawText: text('raw_text').notNull(),
    itemsJson: text('items_json').notNull(),
    privacyNotice: text('privacy_notice').notNull(),
    createdAt: text('created_at').notNull(),
    confirmedAt: text('confirmed_at'),
    confirmedQuestionIds: text('confirmed_question_ids')
      .notNull()
      .default(sql`'[]'`),
    ocrProvider: text('ocr_provider'),
    egressClass: text('egress_class').notNull().default('L1'),
    allowsEgress: integer('allows_egress').notNull().default(0)
  },
  (table) => [
    index('idx_import_drafts_author').on(table.authorId, table.createdAt),
    index('idx_import_drafts_status').on(table.authorId, table.status)
  ]
)

// ---------------------------------------------------------------------------
// Migration 0006 — teacher tips / 站内消息 (T14)
// ---------------------------------------------------------------------------

/** Teacher-authored tip header. Never participates in scoring. */
export const teacherTips = sqliteTable(
  'teacher_tips',
  {
    id: text('id').primaryKey(),
    teachingUnitId: text('teaching_unit_id').notNull(),
    teacherId: text('teacher_id').notNull(),
    body: text('body').notNull(),
    createdAt: text('created_at').notNull(),
    kpIds: text('kp_ids').notNull().default(sql`'[]'`),
    paperId: text('paper_id'),
    questionId: text('question_id')
  },
  (table) => [
    index('idx_teacher_tips_unit').on(table.teachingUnitId, table.createdAt),
    index('idx_teacher_tips_teacher').on(table.teacherId, table.createdAt)
  ]
)

/** Per-student delivery; readAt null = unread. */
export const teacherTipDeliveries = sqliteTable(
  'teacher_tip_deliveries',
  {
    tipId: text('tip_id').notNull(),
    studentId: text('student_id').notNull(),
    readAt: text('read_at')
  },
  (table) => [
    // Composite PK expressed as unique index + columns (SQLite drizzle style).
    uniqueIndex('idx_teacher_tip_delivery_pk').on(table.tipId, table.studentId),
    index('idx_teacher_tip_deliveries_student').on(table.studentId, table.readAt)
  ]
)
