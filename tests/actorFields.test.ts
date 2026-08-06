// @vitest-environment node
/** actorFields — audit actor-field stamping (C3 deepening, #37). */
import { describe, it, expect } from 'vitest'
import { actorFields } from '../server/audit/AuditStore'

describe('actorFields', () => {
  it('stamps role, id, and studentId', () => {
    expect(actorFields({ role: 'student', userId: 'u1', studentId: 's1' }))
      .toEqual({ actorRole: 'student', actorId: 'u1', studentId: 's1' })
  })

  it('leaves studentId undefined when absent', () => {
    const fields = actorFields({ role: 'teacher', userId: 't1' })
    expect(fields.actorRole).toBe('teacher')
    expect(fields.actorId).toBe('t1')
    expect(fields.studentId).toBeUndefined()
  })

  it('spreads cleanly into an AuditEventInput', () => {
    const event = {
      ...actorFields({ role: 'admin', userId: 'a1' }),
      action: 'view',
      resourceType: 'cohort',
      result: 'success'
    }
    expect(event).toMatchObject({
      actorRole: 'admin',
      actorId: 'a1',
      action: 'view'
    })
  })
})