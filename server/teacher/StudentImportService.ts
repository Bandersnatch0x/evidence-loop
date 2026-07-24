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

export class StudentImportService {
  private readonly auth: AuthService
  private readonly org: StudentImportServiceOptions['org']

  public constructor(options: StudentImportServiceOptions) {
    this.auth = options.auth
    this.org = options.org
  }

  /**
   * Import a roster for a class×term. The actor must be a teacher. Each row
   * becomes a Student User (with activation code) + an Enrollment row. Returns
   * the activation-code manifest for offline distribution (T02/T08).
   *
   * `actor` is a minimal principal (userId+role). The service resolves the full
   * PublicAuthUser via AuthService.getPublicUser so the underlying importStudents
   * (which stamps the actor) gets a complete record.
   */
  public import(
    actor: {
      userId: string
      role: 'student' | 'teacher' | 'admin'
    },
    classId: string,
    termId: string,
    rows: RosterRow[]
  ): ImportRosterResult {
    if (classId.trim() === '' || termId.trim() === '') {
      throw new Error('classId and termId are required')
    }
    if (rows.length === 0) {
      throw new Error('At least one roster row is required')
    }
    if (actor.role !== 'teacher' && actor.role !== 'admin') {
      throw new Error('Forbidden: only teachers can import students')
    }

    const publicUser = this.auth.getPublicUser(actor.userId)
    if (publicUser === null) {
      throw new Error(`Actor user not found: ${actor.userId}`)
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
        // Bind each new student to the class for this term.
        this.org.saveEnrollment({
          id: `enr_${randomUUID()}`,
          studentId: s.userId,
          classId,
          termId
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
      classId,
      termId,
      imported
    }
  }
}
