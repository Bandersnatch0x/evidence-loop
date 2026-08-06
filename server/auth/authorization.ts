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
 * Single policy gate for teaching authority and learner-data access.
 *
 * Reviewer is a restrictive flag, never a role expansion: a flagged principal
 * cannot read teaching, grade, audit, adaptive, mastery, review, or
 * intervention data even when its session role is teacher/admin (spec §2.8).
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
