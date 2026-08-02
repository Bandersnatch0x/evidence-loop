/**
 * NotificationService — event triggers for reference lifecycle (spec §5.3,
 * ticket T-D slice 6, decision 08).
 *
 * Three event types (channel wiring lands in T-J — this service only emits
 * typed events):
 *  - NEW_VERSION: an upstream published a new version → referencing teachers
 *    are notified ("有新版本").
 *  - SOURCE_UNAVAILABLE: an upstream source became unavailable → referencing
 *    teachers notified ("源不可用").
 *  - FORCED_TAKEDOWN: a violation ruling forced a takedown → referencing
 *    teachers must replace within a deadline ("限期替换").
 *
 * The channel (in-app message inbox vs library notification center) is a
 * T-J decision; here we produce the event payloads a caller can route.
 */
import type { Database } from 'better-sqlite3'

export type DemoNotificationKind = 'new_version' | 'source_unavailable' | 'forced_takedown'

export interface DemoNotification {
  kind: DemoNotificationKind
  /** The demo version that triggered the event (target). */
  demoVersionId: string
  /** Teacher (or question owner) who should be notified. */
  recipientId: string
  /** Context: which question/kp references the version. */
  questionId?: string
  kpId?: string
  /** Payload per kind. */
  detail: {
    newVersionId?: string
    sourceDemoId?: string
    reason?: string
    replaceDeadline?: string
  }
}

export interface NotificationServiceOptions {
  db: Database
}

export class NotificationService {
  private readonly db: Database

  public constructor(options: NotificationServiceOptions) {
    this.db = options.db
  }

  /**
   * Find all references to a demo version and the teachers who own them —
   * the recipients of an upstream event.
   */
  private referencingTeachers(demoVersionId: string): Array<{
    teacherId: string
    questionId: string | null
    kpId: string | null
  }> {
    const refs = this.db
      .prepare(
        `SELECT question_id AS questionId, kp_id AS kpId FROM demonstration_references
         WHERE demo_version_id = ?`
      )
      .all(demoVersionId) as Array<{ questionId: string | null; kpId: string | null }>
    const out: Array<{ teacherId: string; questionId: string | null; kpId: string | null }> = []
    for (const ref of refs) {
      if (ref.questionId) {
        const q = this.db
          .prepare(`SELECT author_id AS authorId FROM questions WHERE id = ?`)
          .get(ref.questionId) as { authorId: string } | undefined
        if (q) out.push({ teacherId: q.authorId, questionId: ref.questionId, kpId: null })
      } else if (ref.kpId) {
        // KP owners are not materialized in the DB (no kp table); emit with a
        // placeholder recipient that the channel layer resolves (T-J).
        out.push({ teacherId: `kp:${ref.kpId}`, questionId: null, kpId: ref.kpId })
      }
    }
    return out
  }

  /** Emit NEW_VERSION notifications to all referencing teachers. */
  public onNewVersion(demoVersionId: string, newVersionId: string): DemoNotification[] {
    const recipients = this.referencingTeachers(demoVersionId)
    const notifications: DemoNotification[] = recipients.map((r) => ({
      kind: 'new_version',
      demoVersionId,
      recipientId: r.teacherId,
      questionId: r.questionId ?? undefined,
      kpId: r.kpId ?? undefined,
      detail: { newVersionId }
    }))
    return notifications
  }

  /** Emit SOURCE_UNAVAILABLE notifications (source demo became unavailable). */
  public onSourceUnavailable(sourceDemoId: string): DemoNotification[] {
    // Find all approved versions of the source demo that are referenced.
    const versions = this.db
      .prepare(`SELECT id FROM demonstration_versions WHERE demonstration_id = ?`)
      .all(sourceDemoId) as Array<{ id: string }>
    const notifications: DemoNotification[] = []
    for (const v of versions) {
      const recipients = this.referencingTeachers(v.id)
      for (const r of recipients) {
        notifications.push({
          kind: 'source_unavailable',
          demoVersionId: v.id,
          recipientId: r.teacherId,
          questionId: r.questionId ?? undefined,
          kpId: r.kpId ?? undefined,
          detail: { sourceDemoId }
        })
      }
    }
    return notifications
  }

  /** Emit FORCED_TAKEDOWN notifications (violation ruling, deadline to replace). */
  public onForcedTakedown(sourceDemoId: string, reason: string, replaceDeadline: string): DemoNotification[] {
    const notifications = this.onSourceUnavailable(sourceDemoId)
    return notifications.map((n) => ({
      ...n,
      kind: 'forced_takedown' as const,
      detail: { ...n.detail, reason, replaceDeadline }
    }))
  }
}