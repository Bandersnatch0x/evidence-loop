import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import type { TeacherTip, TeacherTipDelivery } from '../../shared/contracts'
import { applyProductMigrations } from '../db/migrate'

/**
 * SQLite-backed store for T14 teacher tips + per-student deliveries.
 * Shares the product DB migration path. Tips never touch Attempt/score.
 */

export interface TeacherTipStoreOptions {
  dbPath?: string
  database?: Database.Database
}

interface TipRow {
  id: string
  teaching_unit_id: string
  teacher_id: string
  body: string
  created_at: string
  kp_ids: string
  paper_id: string | null
  question_id: string | null
}

interface DeliveryRow {
  tip_id: string
  student_id: string
  read_at: string | null
}

export function newTeacherTipId(): string {
  return `tip_${randomUUID().replace(/-/g, '').slice(0, 16)}`
}

export class TeacherTipStore {
  private readonly db: Database.Database
  private readonly ownsDb: boolean

  public constructor(options: TeacherTipStoreOptions = {}) {
    if (options.database) {
      this.db = options.database
      this.ownsDb = false
      applyProductMigrations(this.db)
      return
    }

    const dbPath = options.dbPath ?? ':memory:'
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true })
    }
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.ownsDb = true
    applyProductMigrations(this.db)
  }

  public close(): void {
    if (this.ownsDb) this.db.close()
  }

  /** Atomic insert of tip header + N delivery envelopes. */
  public insertTipWithDeliveries(
    tip: TeacherTip,
    studentIds: string[]
  ): void {
    const insertTip = this.db.prepare(
      `INSERT INTO teacher_tips (
        id, teaching_unit_id, teacher_id, body, created_at,
        kp_ids, paper_id, question_id
      ) VALUES (
        @id, @teaching_unit_id, @teacher_id, @body, @created_at,
        @kp_ids, @paper_id, @question_id
      )`
    )
    const insertDelivery = this.db.prepare(
      `INSERT INTO teacher_tip_deliveries (tip_id, student_id, read_at)
       VALUES (@tip_id, @student_id, NULL)`
    )

    const run = this.db.transaction(() => {
      insertTip.run({
        id: tip.id,
        teaching_unit_id: tip.teachingUnitId,
        teacher_id: tip.teacherId,
        body: tip.body,
        created_at: tip.createdAt,
        kp_ids: JSON.stringify(tip.kpIds ?? []),
        paper_id: tip.paperId ?? null,
        question_id: tip.questionId ?? null
      })
      for (const studentId of studentIds) {
        insertDelivery.run({ tip_id: tip.id, student_id: studentId })
      }
    })
    run()
  }

  public getTip(id: string): TeacherTip | undefined {
    const row = this.db
      .prepare(`SELECT * FROM teacher_tips WHERE id = ?`)
      .get(id) as TipRow | undefined
    return row ? rowToTip(row) : undefined
  }

  public listTipsForUnit(teachingUnitId: string): TeacherTip[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM teacher_tips
         WHERE teaching_unit_id = ?
         ORDER BY created_at DESC`
      )
      .all(teachingUnitId) as TipRow[]
    return rows.map(rowToTip)
  }

  public listDeliveriesForTip(tipId: string): TeacherTipDelivery[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM teacher_tip_deliveries WHERE tip_id = ?`
      )
      .all(tipId) as DeliveryRow[]
    return rows.map(rowToDelivery)
  }

  public listDeliveriesForStudent(studentId: string): TeacherTipDelivery[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM teacher_tip_deliveries WHERE student_id = ?`
      )
      .all(studentId) as DeliveryRow[]
    return rows.map(rowToDelivery)
  }

  public getDelivery(
    tipId: string,
    studentId: string
  ): TeacherTipDelivery | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM teacher_tip_deliveries
         WHERE tip_id = ? AND student_id = ?`
      )
      .get(tipId, studentId) as DeliveryRow | undefined
    return row ? rowToDelivery(row) : undefined
  }

  public markRead(tipId: string, studentId: string, readAt: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE teacher_tip_deliveries
         SET read_at = @read_at
         WHERE tip_id = @tip_id AND student_id = @student_id
           AND read_at IS NULL`
      )
      .run({ tip_id: tipId, student_id: studentId, read_at: readAt })
    // Also succeed if already read (idempotent mark).
    if (result.changes > 0) return true
    const existing = this.getDelivery(tipId, studentId)
    return existing !== undefined
  }
}

function rowToTip(row: TipRow): TeacherTip {
  const kpIds = parseJsonArray(row.kp_ids)
  return {
    id: row.id,
    teachingUnitId: row.teaching_unit_id,
    teacherId: row.teacher_id,
    body: row.body,
    createdAt: row.created_at,
    ...(kpIds.length > 0 ? { kpIds } : {}),
    ...(row.paper_id ? { paperId: row.paper_id } : {}),
    ...(row.question_id ? { questionId: row.question_id } : {})
  }
}

function rowToDelivery(row: DeliveryRow): TeacherTipDelivery {
  return {
    tipId: row.tip_id,
    studentId: row.student_id,
    ...(row.read_at ? { readAt: row.read_at } : {})
  }
}

function parseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    return []
  }
}
