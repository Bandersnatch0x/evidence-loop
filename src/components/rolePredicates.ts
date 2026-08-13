/**
 * Role predicates shared by App navigation + RoleGate.
 * Kept out of RoleGate.tsx so React fast-refresh sees only components there.
 */
import type { DemoRole } from '../../shared/contracts'

export function isTeacherRole(role: DemoRole): boolean {
  return role === 'teacher' || role === 'admin'
}

export function isStudentRole(role: DemoRole): boolean {
  return role === 'student'
}
