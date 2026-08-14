import type { DemoRole } from '../../shared/contracts'

const STORAGE_KEY = 'evidence-ring.demo-role'
export const DEMO_ROLE_HEADER = 'X-Demo-Role'

/**
 * Demo learner identity used by student-facing mastery/review views.
 * Mirrors server/auth/MockSessionProvider DEMO_USERS.student.studentId —
 * this is a fake tenant handle, not authentication.
 */
export const DEMO_STUDENT_ID = 'learner-demo'

export const DEMO_ROLE_OPTIONS: Array<{ value: DemoRole; label: string }> = [
  { value: 'student', label: '学生' },
  { value: 'teacher', label: '教师' },
  { value: 'admin', label: '管理员' },
  { value: 'parent', label: '家长' }
]

export function isDemoRole(value: string): value is DemoRole {
  return (
    value === 'student' ||
    value === 'teacher' ||
    value === 'admin' ||
    value === 'parent'
  )
}

export function readStoredDemoRole(): DemoRole {
  if (typeof window === 'undefined') return 'student'
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw && isDemoRole(raw)) return raw
  } catch {
    // localStorage may be unavailable in private mode; default student.
  }
  return 'student'
}

export function writeStoredDemoRole(role: DemoRole): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, role)
  } catch {
    // Ignore persistence failures; session still works via in-memory state.
  }
}
