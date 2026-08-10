/** Shared authorization policy for teaching and student-data routes. */
import type { Database } from 'better-sqlite3'
import { isPublicLibraryReviewer } from '../demonstration/reviewerAuth'
import type { SessionUser } from './SessionProvider'

export type AuthorityPurpose = 'teaching' | 'student-data'
export type AuthorityDenialReason =
  | 'role'
  | 'reviewer-isolated'
  | 'student-isolated'

export type AuthorityDecision =
  | { allowed: true }
  | { allowed: false; reason: AuthorityDenialReason }

export type AuthorityRequest =
  | { purpose: 'teaching' }
  | { purpose: 'student-data'; studentId: string }

/**
 * Minimal org surface for unit-scoped student-data access.
 * Duck-typed against adaptive OrgReader / report ports.
 */
export interface UnitScopeOrg {
  getTeachingUnit(id: string):
    | { teacherId: string; classId: string; termId: string }
    | undefined
  listEnrolledStudentIds(classId: string, termId: string): string[]
}

export type UnitScopedDenial =
  | { allowed: false; status: 403 | 404; error: string }
  | {
      allowed: true
      unit: { teacherId: string; classId: string; termId: string }
    }

/**
 * Single policy gate for teaching authority and learner-data access.
 *
 * Reviewer is a restrictive flag, never a role expansion: a flagged principal
 * cannot read teaching, grade, audit, adaptive, mastery, review, or
 * intervention data even when its session role is teacher/admin (spec §2.8).
 *
 * NOTE: `purpose: 'student-data'` remains a coarse role gate (any teacher may
 * pass). Effort 2 routes MUST layer {@link authorizeStudentInUnit} (or force
 * `role === 'student'`) so teachers cannot cross units.
 */
export function authorizeAccess(
  db: Database,
  user: SessionUser,
  request: AuthorityRequest
): AuthorityDecision {
  if (isPublicLibraryReviewer(db, user.userId)) {
    return { allowed: false, reason: 'reviewer-isolated' }
  }

  if (request.purpose === 'teaching') {
    return user.role === 'teacher' || user.role === 'admin'
      ? { allowed: true }
      : { allowed: false, reason: 'role' }
  }

  if (user.role === 'teacher' || user.role === 'admin') {
    return { allowed: true }
  }
  if (user.role === 'student') {
    const owner = user.studentId ?? user.userId
    return owner === request.studentId
      ? { allowed: true }
      : { allowed: false, reason: 'student-isolated' }
  }
  return { allowed: false, reason: 'role' }
}

/**
 * Three-gate access for a student inside a teaching unit:
 * 1) base role / reviewer isolation via authorizeAccess
 * 2) unit exists + (teacher owns unit | admin)
 * 3) student enrolled in unit's class+term
 *
 * Students must be reading themselves. Teachers must own the unit (admins exempt).
 */
export function authorizeStudentInUnit(
  db: Database,
  user: SessionUser,
  org: UnitScopeOrg,
  input: { studentId: string; teachingUnitId: string }
): UnitScopedDenial {
  const studentId = input.studentId.trim()
  const teachingUnitId = input.teachingUnitId.trim()
  if (studentId === '' || teachingUnitId === '') {
    return {
      allowed: false,
      status: 403,
      error: 'Forbidden: studentId and teachingUnitId are required'
    }
  }

  const base = authorizeAccess(db, user, {
    purpose: 'student-data',
    studentId
  })
  if (!base.allowed) {
    return {
      allowed: false,
      status: 403,
      error: 'Forbidden: cannot access data for this student'
    }
  }

  if (user.role === 'student') {
    const own = user.studentId ?? user.userId
    if (studentId !== own) {
      return {
        allowed: false,
        status: 403,
        error: 'Forbidden: students may only access their own data'
      }
    }
  }

  const unit = org.getTeachingUnit(teachingUnitId)
  if (!unit) {
    return {
      allowed: false,
      status: 404,
      error: `Teaching unit not found: ${teachingUnitId}`
    }
  }

  // Teachers must own the unit; admins may access any unit.
  if (user.role === 'teacher' && unit.teacherId !== user.userId) {
    return {
      allowed: false,
      status: 403,
      error: 'Forbidden: teaching unit belongs to another teacher'
    }
  }

  if (!org.listEnrolledStudentIds(unit.classId, unit.termId).includes(studentId)) {
    return {
      allowed: false,
      status: 403,
      error: 'Forbidden: student is not enrolled in this teaching unit'
    }
  }

  return { allowed: true, unit }
}

/**
 * Teacher (or admin) may operate on a teaching unit they own.
 * Does not require a student id — used for class-level summaries.
 */
export function authorizeTeacherOwnsUnit(
  db: Database,
  user: SessionUser,
  org: UnitScopeOrg,
  teachingUnitId: string
): UnitScopedDenial {
  const teaching = authorizeAccess(db, user, { purpose: 'teaching' })
  if (!teaching.allowed) {
    return {
      allowed: false,
      status: 403,
      error: 'Forbidden: only teachers may perform this action'
    }
  }
  const unit = org.getTeachingUnit(teachingUnitId.trim())
  if (!unit) {
    return {
      allowed: false,
      status: 404,
      error: `Teaching unit not found: ${teachingUnitId}`
    }
  }
  if (user.role !== 'admin' && unit.teacherId !== user.userId) {
    return {
      allowed: false,
      status: 403,
      error: 'Forbidden: teaching unit belongs to another teacher'
    }
  }
  return { allowed: true, unit }
}
