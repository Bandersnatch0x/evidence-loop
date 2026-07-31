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
    createdAt: text('created_at').notNull(),
    /** Platform library reviewer flag (ticket 14: no role enum expansion). */
    publicLibraryReviewer: integer('public_library_reviewer')
      .notNull()
      .default(0)
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
  'import_drafts',  {
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

// ---------------------------------------------------------------------------
// Migration 0008 — demonstration module (T-A; spec §3)
// Presentation/library module only — never touches scoring tables.
// ---------------------------------------------------------------------------

export const teachingDemonstrations = sqliteTable(
  'teaching_demonstrations',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    /** Current management metadata (title/classification/license/source chain). */
    metaJson: text('meta_json').notNull(),
    /** Soft-delete timestamp; NULL = live. */
    deletedAt: text('deleted_at')
  },
  (table) => [
    index('idx_demonstrations_owner').on(table.ownerId),
    index('idx_demonstrations_deleted').on(table.deletedAt)
  ]
)

export const demonstrationDrafts = sqliteTable(
  'demonstration_drafts',
  {
    id: text('id').primaryKey(),
    demonstrationId: text('demonstration_id').notNull().unique(),
    /** SceneDocument (current editable state). */
    documentJson: text('document_json').notNull(),
    /** AI checkpoint snapshot series (ticket 09). */
    checkpointJson: text('checkpoint_json'),
    updatedAt: text('updated_at').notNull()
  }
)

export const demonstrationVersions = sqliteTable(
  'demonstration_versions',
  {
    id: text('id').primaryKey(),
    demonstrationId: text('demonstration_id').notNull(),
    status: text('status').notNull(), // submitted|approved|rejected|withdrawn
    /** Immutable SceneDocument snapshot. */
    snapshotDocumentJson: text('snapshot_document_json').notNull(),
    /** Multi-dim classification JSON (format×space×behavior). */
    classification: text('classification').notNull(),
    /** Distribution license (v1 whitelist). */
    license: text('license').notNull(),
    /** AI disclosure (required, ticket 04). */
    aiDisclosure: text('ai_disclosure').notNull(),
    /** Derivation source chain (source work+version+author, ticket 08). */
    sourceChainJson: text('source_chain_json'),
    /** Media manifest (blob hash/type/size/state/derivative hash). */
    mediaManifestJson: text('media_manifest_json').notNull(),
    /** Rejection reason / review note. */
    reviewerNote: text('reviewer_note'),
    frozenAt: text('frozen_at').notNull()
  },
  (table) => [
    index('idx_demo_versions_demo_status').on(
      table.demonstrationId,
      table.status
    ),
    index('idx_demo_versions_status_frozen').on(table.status, table.frozenAt)
  ]
)

export const mediaAssets = sqliteTable(
  'media_assets',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    kind: text('kind').notNull(), // image|audio|model3d|video|subtitle
    originalBlobHash: text('original_blob_hash').notNull(),
    status: text('status').notNull(),
    /** Sanitized display name; never part of the disk path. */
    displayName: text('display_name').notNull(),
    createdAt: text('created_at').notNull(),
    deletedAt: text('deleted_at')
  }
)

export const mediaBlobs = sqliteTable(
  'media_blobs',
  {
    /** SHA-256 content-addressed, globally unique. */
    hash: text('hash').primaryKey(),
    /** Server-confirmed canonical extension (not the user filename). */
    canonicalExtension: text('canonical_extension').notNull(),
    mediaType: text('media_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    /** data/media/<hash>.<ext> relative path (paths.ts contract). */
    storageKey: text('storage_key').notNull(),
    /** ClamAV result; fail-closed keeps quarantined when unavailable. */
    scanStatus: text('scan_status').notNull(),
    createdAt: text('created_at').notNull()
  }
)

export const mediaDerivatives = sqliteTable(
  'media_derivatives',
  {
    id: text('id').primaryKey(),
    assetId: text('asset_id').notNull(),
    role: text('role').notNull(), // display|thumbnail|poster|playback|caption
    blobHash: text('blob_hash').notNull(),
    sourceBlobHash: text('source_blob_hash').notNull(),
    recipeName: text('recipe_name').notNull(),
    recipeVersion: text('recipe_version').notNull()
  },
  (table) => [
    uniqueIndex('idx_media_derivatives_idempotent').on(
      table.sourceBlobHash,
      table.recipeName,
      table.recipeVersion
    )
  ]
)

export const uploadSessions = sqliteTable(
  'upload_sessions',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    intendedKind: text('intended_kind').notNull(),
    declaredBytes: integer('declared_bytes').notNull(),
    /** Server-counted actual bytes; never trust Content-Length alone. */
    receivedBytes: integer('received_bytes').notNull(),
    tempKey: text('temp_key').notNull(),
    state: text('state').notNull(), // uploading|quarantined|inspecting|processing|ready|rejected|failed
    quotaReservationBytes: integer('quota_reservation_bytes').notNull(),
    expiresAt: text('expires_at').notNull(),
    createdAt: text('created_at').notNull()
  },
  (table) => [
    index('idx_upload_sessions_owner_state').on(table.ownerId, table.state),
    index('idx_upload_sessions_expires').on(table.expiresAt)
  ]
)

export const mediaJobs = sqliteTable(
  'media_jobs',
  {
    id: text('id').primaryKey(),
    assetId: text('asset_id').notNull(),
    jobType: text('job_type').notNull(),
    state: text('state').notNull(),
    attempts: integer('attempts').notNull().default(0),
    availableAt: text('available_at').notNull(),
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: text('lease_expires_at'),
    lastErrorCode: text('last_error_code')
  },
  (table) => [
    index('idx_media_jobs_state_available').on(table.state, table.availableAt),
    index('idx_media_jobs_lease').on(table.leaseExpiresAt)
  ]
)

export const externalVideoRefs = sqliteTable(
  'external_video_refs',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    provider: text('provider').notNull(), // youtube|vimeo (v1 whitelist)
    providerVideoId: text('provider_video_id').notNull(),
    canonicalUrl: text('canonical_url').notNull(),
    health: text('health').notNull(), // unknown|healthy|degraded|unavailable|private|embed_forbidden
    checkedAt: text('checked_at'),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    lastFailureCode: text('last_failure_code')
  },
  (table) => [
    index('idx_external_video_provider_health').on(
      table.provider,
      table.health
    )
  ]
)

export const demonstrationReferences = sqliteTable(
  'demonstration_references',
  {
    id: text('id').primaryKey(),
    questionId: text('question_id'),
    kpId: text('kp_id'),
    demoVersionId: text('demo_version_id').notNull(),
    role: text('role').notNull(), // primary|supplementary
    ord: integer('ord').notNull()
  },
  (table) => [
    uniqueIndex('idx_demo_refs_question_ord').on(
      table.questionId,
      table.ord
    ),
    uniqueIndex('idx_demo_refs_kp_ord').on(table.kpId, table.ord),
    // Partial unique indexes matching 0008 SQL — primary at most one per owner
    // (DB layer double-guard alongside service layer, ticket 12).
    uniqueIndex('idx_demo_refs_question_primary')
      .on(table.questionId, table.role)
      .where(sql`${table.questionId} IS NOT NULL AND ${table.role} = 'primary'`),
    uniqueIndex('idx_demo_refs_kp_primary')
      .on(table.kpId, table.role)
      .where(sql`${table.kpId} IS NOT NULL AND ${table.role} = 'primary'`),
    index('idx_demo_refs_version').on(table.demoVersionId)
  ]
)
