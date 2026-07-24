import { createHmac, timingSafeEqual } from 'node:crypto'
import type { TeacherAnnotation } from '../../shared/contracts'

/**
 * T13/P5 — tamper-evident signature for teacher final adjudication.
 *
 * Payload is a stable pipe-joined string of the fields that must not drift
 * after the teacher submits. Secret reuses the audit HMAC (demo fallback in
 * non-production via resolveAuditHmacSecret).
 */

export function buildTeacherAnnotationPayload(input: {
  attemptId: string
  teacherId: string
  subjectiveScore: number
  subjectiveMaxScore: number
  note: string
  adjudicatedAt: string
}): string {
  return [
    input.attemptId,
    input.teacherId,
    String(input.subjectiveScore),
    String(input.subjectiveMaxScore),
    input.note,
    input.adjudicatedAt
  ].join('|')
}

export function signTeacherAnnotation(
  input: {
    attemptId: string
    teacherId: string
    subjectiveScore: number
    subjectiveMaxScore: number
    note: string
    adjudicatedAt: string
  },
  secret: string
): string {
  const payload = buildTeacherAnnotationPayload(input)
  return createHmac('sha256', secret).update(payload, 'utf8').digest('hex')
}

export function verifyTeacherAnnotation(
  attemptId: string,
  annotation: TeacherAnnotation,
  secret: string
): boolean {
  if (annotation.signature === undefined || annotation.signature === '') {
    return false
  }
  const expected = signTeacherAnnotation(
    {
      attemptId,
      teacherId: annotation.teacherId,
      subjectiveScore: annotation.subjectiveScore,
      subjectiveMaxScore: annotation.subjectiveMaxScore,
      note: annotation.note,
      adjudicatedAt: annotation.adjudicatedAt
    },
    secret
  )
  try {
    const left = Buffer.from(annotation.signature, 'hex')
    const right = Buffer.from(expected, 'hex')
    if (left.length === 0 || left.length !== right.length) return false
    return timingSafeEqual(left, right)
  } catch {
    return false
  }
}
