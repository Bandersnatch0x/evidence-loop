import type Database from 'better-sqlite3'
import type { Enrollment, TeachingUnit } from '../../shared/contracts'

/**
 * Minimal org read surface for the T06 adaptive loop.
 * Keeps TeachingUnit / Enrollment access out of the scoring closed loop
 * (server/mastery, server/review) while still reusing the T01 product tables.
 */
export interface OrgReader {
  getTeachingUnit(id: string): TeachingUnit | undefined
  listEnrollments(classId: string, termId: string): Enrollment[]
  listEnrolledStudentIds(classId: string, termId: string): string[]
  /** Optional: list units owned by a teacher (T08 workbench unit picker). */
  listTeachingUnitsByTeacher?(teacherId: string): TeachingUnit[]
}

export class TeachingUnitNotFoundError extends Error {
  public constructor(id: string) {
    super(`Teaching unit not found: ${id}`)
    this.name = 'TeachingUnitNotFoundError'
  }
}

interface TeachingUnitRow {
  id: string
  teacher_id: string
  class_id: string
  subject_id: string
  term_id: string
  taught_kp_ids: string
}

interface EnrollmentRow {
  id: string
  student_id: string
  class_id: string
  term_id: string
}

/**
 * SQLite-backed OrgReader over the T01 product tables
 * (`teaching_units`, `enrollments`). Safe to share an open better-sqlite3
 * connection with Audit / Memory / QuestionStore.
 */
export class SqliteOrgReader implements OrgReader {
  private readonly db: Database.Database

  public constructor(db: Database.Database) {
    this.db = db
  }

  public getTeachingUnit(id: string): TeachingUnit | undefined {
    const row = this.db
      .prepare(`SELECT * FROM teaching_units WHERE id = ?`)
      .get(id) as TeachingUnitRow | undefined
    return row ? rowToTeachingUnit(row) : undefined
  }

  public listEnrollments(classId: string, termId: string): Enrollment[] {
    const rows = this.db
      .prepare(
        `
        SELECT * FROM enrollments
        WHERE class_id = @classId AND term_id = @termId
        ORDER BY student_id ASC
        `
      )
      .all({ classId, termId }) as EnrollmentRow[]
    return rows.map(rowToEnrollment)
  }

  public listEnrolledStudentIds(classId: string, termId: string): string[] {
    return this.listEnrollments(classId, termId).map((row) => row.studentId)
  }

  public listTeachingUnitsByTeacher(teacherId: string): TeachingUnit[] {
    const rows = this.db
      .prepare(
        `
        SELECT * FROM teaching_units
        WHERE teacher_id = ?
        ORDER BY id ASC
        `
      )
      .all(teacherId) as TeachingUnitRow[]
    return rows.map(rowToTeachingUnit)
  }

  /** Test / seed helper: upsert a teaching unit. */
  public saveTeachingUnit(unit: TeachingUnit): void {
    this.db
      .prepare(
        `
        INSERT INTO teaching_units (
          id, teacher_id, class_id, subject_id, term_id, taught_kp_ids
        ) VALUES (
          @id, @teacher_id, @class_id, @subject_id, @term_id, @taught_kp_ids
        )
        ON CONFLICT(id) DO UPDATE SET
          teacher_id = excluded.teacher_id,
          class_id = excluded.class_id,
          subject_id = excluded.subject_id,
          term_id = excluded.term_id,
          taught_kp_ids = excluded.taught_kp_ids
        `
      )
      .run({
        id: unit.id,
        teacher_id: unit.teacherId,
        class_id: unit.classId,
        subject_id: unit.subjectId,
        term_id: unit.termId,
        taught_kp_ids: JSON.stringify(unit.taughtKpIds)
      })
  }

  /** Test / seed helper: upsert an enrollment. */
  public saveEnrollment(enrollment: Enrollment): void {
    this.db
      .prepare(
        `
        INSERT INTO enrollments (id, student_id, class_id, term_id)
        VALUES (@id, @student_id, @class_id, @term_id)
        ON CONFLICT(student_id, class_id, term_id) DO UPDATE SET
          id = excluded.id
        `
      )
      .run({
        id: enrollment.id,
        student_id: enrollment.studentId,
        class_id: enrollment.classId,
        term_id: enrollment.termId
      })
  }
}

/**
 * In-memory OrgReader for unit tests that do not want a SQLite surface.
 */
export class InMemoryOrgReader implements OrgReader {
  private readonly units = new Map<string, TeachingUnit>()
  private readonly enrollments: Enrollment[] = []

  public saveTeachingUnit(unit: TeachingUnit): void {
    this.units.set(unit.id, {
      ...unit,
      taughtKpIds: [...unit.taughtKpIds]
    })
  }

  public saveEnrollment(enrollment: Enrollment): void {
    const idx = this.enrollments.findIndex(
      (row) =>
        row.studentId === enrollment.studentId &&
        row.classId === enrollment.classId &&
        row.termId === enrollment.termId
    )
    if (idx >= 0) {
      this.enrollments[idx] = enrollment
    } else {
      this.enrollments.push(enrollment)
    }
  }

  public getTeachingUnit(id: string): TeachingUnit | undefined {
    const unit = this.units.get(id)
    return unit
      ? { ...unit, taughtKpIds: [...unit.taughtKpIds] }
      : undefined
  }

  public listEnrollments(classId: string, termId: string): Enrollment[] {
    return this.enrollments
      .filter((row) => row.classId === classId && row.termId === termId)
      .map((row) => ({ ...row }))
  }

  public listEnrolledStudentIds(classId: string, termId: string): string[] {
    return this.listEnrollments(classId, termId).map((row) => row.studentId)
  }

  public listTeachingUnitsByTeacher(teacherId: string): TeachingUnit[] {
    return [...this.units.values()]
      .filter((unit) => unit.teacherId === teacherId)
      .map((unit) => ({ ...unit, taughtKpIds: [...unit.taughtKpIds] }))
      .sort((a, b) => a.id.localeCompare(b.id))
  }
}

function rowToTeachingUnit(row: TeachingUnitRow): TeachingUnit {
  return {
    id: row.id,
    teacherId: row.teacher_id,
    classId: row.class_id,
    subjectId: row.subject_id,
    termId: row.term_id,
    taughtKpIds: parseStringArray(row.taught_kp_ids)
  }
}

function rowToEnrollment(row: EnrollmentRow): Enrollment {
  return {
    id: row.id,
    studentId: row.student_id,
    classId: row.class_id,
    termId: row.term_id
  }
}

function parseStringArray(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    return []
  }
}
