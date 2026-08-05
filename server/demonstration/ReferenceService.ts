/**
 * ReferenceService — question/KP ↔ demonstration-version references (spec
 * §2.7, §5.6, ticket T-D slice 3, decision 12).
 *
 * Invariants enforced:
 *  - reference target = fixed demo version ID (never "latest" drift, §2.7).
 *  - target must be an APPROVED version & healthy (spec §2.7).
 *  - role: primary ≤ 1 per question/KP; supplementary ≤ 8 (DB unique + service).
 *  - teachers bind own private questions; students cannot bind (spec §2.7).
 *  - pure display semantics: references live in demonstration_references only,
 *    never in QuestionType/Runner/Rubric/Evidence (arch test guards this).
 *
 * Reference upgrades are a separate explicit action (T-J / §5.6) — this
 * service never auto-drifts a fixed reference.
 */
import type { Database } from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import type { DemonstrationReferenceView } from '../../shared/contracts'

interface StudentReferenceRow {
  id: string
  role: 'primary' | 'supplementary'
  demoId: string
  versionId: string
  license: string
  versionSeq: number
  ownerId: string
  authorName: string
  metaJson: string
  health: 'healthy' | 'unavailable'
}

function toStudentReference(row: StudentReferenceRow): DemonstrationReferenceView {
  let title = '教学演示'
  try {
    const meta = JSON.parse(row.metaJson) as { title?: unknown }
    if (typeof meta.title === 'string' && meta.title.trim() !== '') title = meta.title
  } catch {
    // Invalid legacy metadata must not block student assignment loading.
  }
  return {
    id: row.id,
    role: row.role,
    title,
    authorName: row.authorName,
    license: row.license,
    versionSeq: row.versionSeq,
    source: row.ownerId === 'seed' ? 'public' : 'mine',
    demoId: row.demoId,
    versionId: row.versionId,
    health: row.health
  }
}

export class ReferenceValidationError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'ReferenceValidationError'
  }
}

export class ReferenceNotFoundError extends Error {
  public constructor(id: string) {
    super(`Reference not found: ${id}`)
    this.name = 'ReferenceNotFoundError'
  }
}

export const MAX_SUPPLEMENTARY = 8

export interface SetReferencesInput {
  /** Question id XOR kp id (exactly one). */
  questionId?: string
  kpId?: string
  entries: Array<{ demoVersionId: string; role: 'primary' | 'supplementary' }>
}

export interface ReferenceServiceOptions {
  db: Database
  audit?: (event: {
    action: string
    actorId: string
    actorRole: string
    resourceType: string
    resourceId: string
    detailJson: string
  }) => void
}

export class ReferenceService {
  private readonly db: Database
  private readonly audit: ReferenceServiceOptions['audit']

  public constructor(options: ReferenceServiceOptions) {
    this.db = options.db
    this.audit = options.audit
  }

  private assertTeacher(actorId: string, role: string): void {
    if (role !== 'teacher' && role !== 'admin') {
      throw new ReferenceValidationError('only teachers can bind demonstration references')
    }
  }

  private assertVersionApproved(demoVersionId: string): void {
    const version = this.db
      .prepare(`SELECT status, demonstration_id FROM demonstration_versions WHERE id = ?`)
      .get(demoVersionId) as { status: string; demonstration_id: string } | undefined
    if (!version) throw new ReferenceValidationError(`unknown demo version ${demoVersionId}`)
    if (version.status !== 'approved') {
      throw new ReferenceValidationError(`demo version ${demoVersionId} is not approved (status=${version.status})`)
    }
    // Spec §2.3: older approved versions stop accepting NEW references; only
    // the CURRENT published version of a demo accepts new bindings.
    const current = this.db
      .prepare(
        `SELECT id FROM demonstration_versions
         WHERE demonstration_id = ? AND status = 'approved'
         ORDER BY frozen_at DESC LIMIT 1`
      )
      .get(version.demonstration_id) as { id: string } | undefined
    if (!current || current.id !== demoVersionId) {
      throw new ReferenceValidationError(`demo version ${demoVersionId} is not the current published version; new references must bind the latest approved version`)
    }
  }

  private assertOwnerContext(actorId: string, questionId?: string): void {
    // Private questions are teacher-owned; the reviewer/other teachers cannot
    // bind someone else's private question. Public/seed questions are read-only
    // (spec §2.7). We check the question row exists and is owned by the actor
    // (or the question is public/seed authored by the platform).
    if (!questionId) return
    const q = this.db.prepare(`SELECT author_id FROM questions WHERE id = ?`).get(questionId) as
      | { author_id: string }
      | undefined
    if (!q) throw new ReferenceValidationError(`unknown question ${questionId}`)
    // Seed/platform questions are bindable by any teacher; private questions
    // only by their author. Derived from QuestionBankService ownership:
    // author_id === SEED_AUTHOR_ID means public.
    if (q.author_id !== actorId && q.author_id !== 'seed') {
      throw new ReferenceValidationError('cannot bind another teacher\'s private question')
    }
  }

  /**
   * Full replace of the reference list for a question/KP (spec §5.6 PUT
   * semantics). Validates: exactly one target scope, role counts, approved
   * targets, fixed versions.
   */
  public setReferences(
    actorId: string,
    actorRole: string,
    input: SetReferencesInput
  ): void {
    this.assertTeacher(actorId, actorRole)
    const hasQuestion = input.questionId !== undefined
    const hasKp = input.kpId !== undefined
    if (hasQuestion === hasKp) {
      throw new ReferenceValidationError('exactly one of questionId/kpId required')
    }
    if (hasQuestion) this.assertOwnerContext(actorId, input.questionId)

    const primaryCount = input.entries.filter((e) => e.role === 'primary').length
    if (primaryCount > 1) {
      throw new ReferenceValidationError('at most one primary reference per question/KP')
    }
    const supplementaryCount = input.entries.filter((e) => e.role === 'supplementary').length
    if (supplementaryCount > MAX_SUPPLEMENTARY) {
      throw new ReferenceValidationError(`at most ${MAX_SUPPLEMENTARY} supplementary references`)
    }
    // Duplicate version ids → reject.
    const seen = new Set<string>()
    for (const e of input.entries) {
      if (seen.has(e.demoVersionId)) {
        throw new ReferenceValidationError(`duplicate demo version ${e.demoVersionId}`)
      }
      seen.add(e.demoVersionId)
      this.assertVersionApproved(e.demoVersionId)
    }

    const parentId = input.questionId ?? input.kpId!
    const parentType = hasQuestion ? 'question' : 'kp'
    this.db.transaction(() => {
      // Clear existing references for the parent.
      this.db
        .prepare(
          hasQuestion
            ? `DELETE FROM demonstration_references WHERE question_id = ?`
            : `DELETE FROM demonstration_references WHERE kp_id = ?`
        )
        .run(parentId)
      // Insert with ord preserving the input order.
      input.entries.forEach((e, idx) => {
        this.db
          .prepare(
            `INSERT INTO demonstration_references
               (id, question_id, kp_id, demo_version_id, role, ord)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(
            randomUUID(),
            hasQuestion ? parentId : null,
            hasKp ? parentId : null,
            e.demoVersionId,
            e.role,
            idx
          )
      })
    })()
    this.audit?.({
      action: 'demo.reference.set',
      actorId,
      actorRole,
      resourceType: parentType,
      resourceId: parentId,
      detailJson: JSON.stringify(input.entries)
    })
  }

  /** Read references for a question/KP, ordered. */
  public listReferences(parentId: string, parentType: 'question' | 'kp'): Array<{
    id: string
    demoVersionId: string
    demoId: string
    role: 'primary' | 'supplementary'
    ord: number
  }> {
    const rows = this.db
      .prepare(
        `SELECT r.id, r.demo_version_id AS demoVersionId, v.demonstration_id AS demoId, r.role, r.ord
         FROM demonstration_references r
         JOIN demonstration_versions v ON v.id = r.demo_version_id
         WHERE r.${parentType === 'question' ? 'question_id' : 'kp_id'} = ?
         ORDER BY r.ord ASC`
      )
      .all(parentId) as Array<{
      id: string
      demoVersionId: string
      demoId: string
      role: 'primary' | 'supplementary'
      ord: number
    }>
    return rows
  }

  /**
   * Resolve student-facing fixed-version references for an assignment. Explicit
   * question references win; Phase-E migration mapping supplies a primary
   * reference only when no explicit list exists. Seed question ids are checked
   * before bare registry ids, matching legacy assignment resolution.
   */
  public listStudentReferencesForAssignment(assignmentId: string): DemonstrationReferenceView[] {
    const candidates = assignmentId.startsWith('seed:')
      ? [assignmentId]
      : [`seed:${assignmentId}`, assignmentId]
    const explicit = this.db.prepare(
      `SELECT r.id, r.role,
              d.id AS demoId, v.id AS versionId, v.license,
              (SELECT COUNT(*) FROM demonstration_versions v2
               WHERE v2.demonstration_id = d.id AND v2.frozen_at <= v.frozen_at) AS versionSeq,
              d.owner_id AS ownerId, COALESCE(u.display_name, '平台') AS authorName,
              d.meta_json AS metaJson,
              CASE WHEN d.deleted_at IS NULL THEN 'healthy' ELSE 'unavailable' END AS health
       FROM demonstration_references r
       JOIN demonstration_versions v ON v.id = r.demo_version_id
       JOIN teaching_demonstrations d ON d.id = v.demonstration_id
       LEFT JOIN users u ON u.id = d.owner_id
       WHERE r.question_id = ?
       ORDER BY r.ord ASC`
    )
    const migrated = this.db.prepare(
      `SELECT ('migration:' || m.question_id) AS id, 'primary' AS role,
              d.id AS demoId, v.id AS versionId, v.license,
              (SELECT COUNT(*) FROM demonstration_versions v2
               WHERE v2.demonstration_id = d.id AND v2.frozen_at <= v.frozen_at) AS versionSeq,
              d.owner_id AS ownerId, COALESCE(u.display_name, '平台') AS authorName,
              d.meta_json AS metaJson,
              CASE WHEN d.deleted_at IS NULL THEN 'healthy' ELSE 'unavailable' END AS health
       FROM visualization_migration_map m
       JOIN demonstration_versions v ON v.id = m.version_id
       JOIN teaching_demonstrations d ON d.id = m.demo_id
       LEFT JOIN users u ON u.id = d.owner_id
       WHERE m.question_id = ?`
    )

    for (const questionId of candidates) {
      const rows = explicit.all(questionId) as StudentReferenceRow[]
      if (rows.length > 0) return rows.map(toStudentReference)
      const migration = migrated.get(questionId) as StudentReferenceRow | undefined
      if (migration) return [toStudentReference(migration)]
    }
    return []
  }

  /** Remove a single reference (DELETE semantics, §5.6). */
  public removeReference(actorId: string, actorRole: string, referenceId: string): void {
    this.assertTeacher(actorId, actorRole)
    const ref = this.db
      .prepare(`SELECT id, question_id AS questionId FROM demonstration_references WHERE id = ?`)
      .get(referenceId) as { id: string; questionId: string | null } | undefined
    if (!ref) throw new ReferenceNotFoundError(referenceId)
    // Ownership check mirrors setReferences: private questions are bound by
    // their author only; seed/public questions are removable by any teacher.
    if (ref.questionId) this.assertOwnerContext(actorId, ref.questionId)
    this.db.prepare(`DELETE FROM demonstration_references WHERE id = ?`).run(referenceId)
    this.audit?.({
      action: 'demo.reference.remove',
      actorId,
      actorRole,
      resourceType: 'reference',
      resourceId: referenceId,
      detailJson: ''
    })
  }

  /**
   * Manual upgrade (ticket T-J / spec §2.7): point an existing reference at a
   * NEWER current approved version of the SAME demonstration. Never automatic;
   * the teacher confirms first. Fails if the target version belongs to a
   * different demonstration (prevents cross-demo rebinding via this path).
   */
  public upgradeReference(actorId: string, actorRole: string, referenceId: string, newVersionId: string): void {
    this.assertTeacher(actorId, actorRole)
    const ref = this.db
      .prepare(`SELECT id, question_id AS questionId, demo_version_id AS demoVersionId FROM demonstration_references WHERE id = ?`)
      .get(referenceId) as { id: string; questionId: string | null; demoVersionId: string } | undefined
    if (!ref) throw new ReferenceNotFoundError(referenceId)
    if (ref.questionId) this.assertOwnerContext(actorId, ref.questionId)
    this.assertVersionApproved(newVersionId)
    const oldVersion = this.db
      .prepare(`SELECT demonstration_id AS demonstrationId FROM demonstration_versions WHERE id = ?`)
      .get(ref.demoVersionId) as { demonstrationId: string } | undefined
    const newVersion = this.db
      .prepare(`SELECT demonstration_id AS demonstrationId FROM demonstration_versions WHERE id = ?`)
      .get(newVersionId) as { demonstrationId: string } | undefined
    if ((oldVersion?.demonstrationId ?? '') !== (newVersion?.demonstrationId ?? '')) {
      throw new ReferenceValidationError('upgrade must target a newer version of the SAME demonstration')
    }
    this.db
      .prepare(`UPDATE demonstration_references SET demo_version_id = ? WHERE id = ?`)
      .run(newVersionId, referenceId)
    this.audit?.({
      action: 'demo.reference.upgrade',
      actorId,
      actorRole,
      resourceType: 'reference',
      resourceId: referenceId,
      detailJson: JSON.stringify({ fromDemoVersionId: ref.demoVersionId, toDemoVersionId: newVersionId })
    })
  }
}