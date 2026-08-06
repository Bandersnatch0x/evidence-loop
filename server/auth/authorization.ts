/**
 * authorization — shared route-authorization helpers.
 *
 * C4 deepening (#38): `canAccessStudent` was copy-pasted into index.ts and
 * adaptive/adaptiveRoutes.ts with identical logic. This module is the single
 * home for student-access checks so the teaching/grade/audit route surface
 * stays consistent with spec §2.8 (reviewer pseudo-role never expands access).
 */
import type { SessionUser } from './SessionProvider'

/**
 * May this principal access a given student's data? Teachers/admins may access
 * any student; students may access only their own record (matched by studentId
 * or, for demo sessions, the userId fallback).
 */
export function canAccessStudent(
  user: SessionUser,
  studentId: string
): boolean {
  if (user.role === 'teacher' || user.role === 'admin') return true
  if (user.role === 'student') {
    return (user.studentId ?? user.userId) === studentId
  }
  return false
}