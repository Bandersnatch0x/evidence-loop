// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createRouteAuditor } from '../server/audit/routeAudit'

const student = {
  userId: 'user-1',
  role: 'student' as const,
  displayName: 'Student',
  studentId: 'student-1'
}

describe('createRouteAuditor', () => {
  it('stamps actor, action, and resource type on every event', () => {
    const enqueue = vi.fn()
    const auditor = createRouteAuditor(
      { enqueue },
      student,
      { action: 'view', resourceType: 'cohort' }
    )

    auditor.record({ result: 'denied', metadata: { reason: 'role' } })
    auditor.record({ result: 'success', resourceId: 'cohort-1' })

    expect(enqueue).toHaveBeenNthCalledWith(1, {
      actorRole: 'student',
      actorId: 'user-1',
      studentId: 'student-1',
      action: 'view',
      resourceType: 'cohort',
      result: 'denied',
      metadata: { reason: 'role' }
    })
    expect(enqueue).toHaveBeenNthCalledWith(2, {
      actorRole: 'student',
      actorId: 'user-1',
      studentId: 'student-1',
      action: 'view',
      resourceType: 'cohort',
      result: 'success',
      resourceId: 'cohort-1'
    })
  })

  it('allows target studentId to override the actor studentId', () => {
    const enqueue = vi.fn()
    const auditor = createRouteAuditor(
      { enqueue },
      student,
      { action: 'view', resourceType: 'knowledge' }
    )

    auditor.record({ result: 'success', studentId: 'student-2' })

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ studentId: 'student-2' })
    )
  })
})
