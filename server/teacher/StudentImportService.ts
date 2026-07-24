import { randomUUID } from 'node:crypto'
import type {
  ImportRosterResult,
  ImportedRosterEntry,
  RosterRow
} from '../../shared/contracts'
import type { AuthService, ImportedStudent } from '../auth/AuthService'
import type { OrgReader } from '../adaptive/OrgReader'

/**
 * T08 student roster import.
 *
 * Reuses T02 AuthService.importStudents for User creation + activation-code
 * generation (演示喂测试名单 — 守合规边界). This service adds the Enrollment
 * binding (student → class for the term) that the auth layer deliberately
 * does not own (auth knows accounts, not org membership).
 *
 * Ownership: import is scoped to a TeachingUnit the actor owns. classId/termId
 * are derived from the unit (not caller-supplied), so a teacher cannot inject
 * enrollments into another teacher's class.
 *
 * Demo compliance: the roster is teacher-pasted test data, never real学籍.
 */
export interface StudentImportServiceOptions {
  auth: AuthService
  org: OrgReader & {
    saveEnrollment(enrollment: {
      id: string
      studentId: string
      classId: string
      termId: string
    }): void
  }
}

export class StudentImportError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'StudentImportError'
  }
}

export class StudentImportService {
  private readonly auth: AuthService
  private readonly org: StudentImportServiceOptions['org']

  public constructor(options: StudentImportServiceOptions) {
    this.auth = options.auth
    this.org = options.org
  }

  /**
   * Import a roster for a teaching unit the actor owns. Each row becomes a
   * Student User (with activation code) + an Enrollment bound to the unit's
   * class×term. Returns the activation-code manifest for offline distribution.
   */
  public import(
    actor: {
      userId: string
      role: 'student' | 'teacher' | 'admin'
    },
    teachingUnitId: string,
    rows: RosterRow[]
  ): ImportRosterResult {
    if (teachingUnitId.trim() === '') {
      throw new StudentImportError('teachingUnitId is required')
    }
    if (rows.length === 0) {
      throw new StudentImportError('At least one roster row is required')
    }
    if (actor.role !== 'teacher' && actor.role !== 'admin') {
      throw new StudentImportError(
        'Forbidden: only teachers can import students'
      )
    }

    const unit = this.org.getTeachingUnit(teachingUnitId)
    if (!unit) {
      throw new StudentImportError(
        `Teaching unit not found: ${teachingUnitId}`
      )
    }
    // Admin may import into any unit (demo parity); teachers only their own.
    if (actor.role === 'teacher' && unit.teacherId !== actor.userId) {
      throw new StudentImportError(
        'Forbidden: only the teaching-unit teacher may import students into this unit'
      )
    }

    const publicUser = this.auth.getPublicUser(actor.userId)
    if (publicUser === null) {
      throw new StudentImportError(`Actor user not found: ${actor.userId}`)
    }

    const importedStudents = this.auth.importStudents(
      publicUser,
      rows.map((r) => ({
        studentNumber: r.studentNumber,
        displayName: r.displayName
      }))
    )

    const imported: ImportedRosterEntry[] = importedStudents.map(
      (s: ImportedStudent) => {
        // Bind each new student to the unit's class for this term.
        this.org.saveEnrollment({
          id: `enr_${randomUUID()}`,
          studentId: s.userId,
          classId: unit.classId,
          termId: unit.termId
        })
        return {
          userId: s.userId,
          loginId: s.loginId,
          displayName: s.displayName,
          activationCode: s.activationCode
        }
      }
    )

    return {
      classId: unit.classId,
      termId: unit.termId,
      imported
    }
  }
}
