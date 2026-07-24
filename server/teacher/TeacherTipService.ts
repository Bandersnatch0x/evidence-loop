import type {
  CreateTeacherTipInput,
  CreateTeacherTipResult,
  StudentTipItem,
  TeacherTip,
  TeacherTipSummary
} from '../../shared/contracts'
import type { OrgReader } from '../adaptive/OrgReader'
import {
  newTeacherTipId,
  type TeacherTipStore
} from './TeacherTipStore'

const MAX_BODY_CHARS = 2000

/**
 * T14 teacher batch tips — 站内消息 fan-out within a TeachingUnit.
 *
 * Iron rules:
 * - Never writes Attempt / result.score / evidence / MasteryProfile.
 * - Targets must be enrolled on the unit's class×term (T11/S2 gate).
 * - Only the unit's teacher may send or list tips for that unit.
 * - Students only see their own delivery envelopes.
 */
export interface TeacherTipServiceOptions {
  store: TeacherTipStore
  org: OrgReader
  now?: () => Date
}

export class TeacherTipError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'TeacherTipError'
  }
}

export class TeacherTipService {
  private readonly store: TeacherTipStore
  private readonly org: OrgReader
  private readonly now: () => Date

  public constructor(options: TeacherTipServiceOptions) {
    this.store = options.store
    this.org = options.org
    this.now = options.now ?? (() => new Date())
  }

  public send(
    input: CreateTeacherTipInput,
    teacherId: string
  ): CreateTeacherTipResult {
    const body = input.body.trim()
    if (body.length === 0) {
      throw new TeacherTipError('Tip body must not be empty')
    }
    if (body.length > MAX_BODY_CHARS) {
      throw new TeacherTipError(
        `Tip body exceeds ${String(MAX_BODY_CHARS)} characters`
      )
    }

    const unit = this.org.getTeachingUnit(input.teachingUnitId)
    if (!unit) {
      throw new TeacherTipError(
        `Teaching unit not found: ${input.teachingUnitId}`
      )
    }
    if (unit.teacherId !== teacherId) {
      throw new TeacherTipError(
        'Forbidden: only the teaching-unit teacher may send tips for this unit'
      )
    }

    const studentIds = this.resolveStudents(input, unit)
    if (studentIds.length === 0) {
      throw new TeacherTipError('No enrolled students to deliver this tip to')
    }

    const tip: TeacherTip = {
      id: newTeacherTipId(),
      teachingUnitId: unit.id,
      teacherId,
      body,
      createdAt: this.now().toISOString(),
      ...(input.kpIds && input.kpIds.length > 0
        ? { kpIds: [...new Set(input.kpIds)] }
        : {}),
      ...(input.paperId ? { paperId: input.paperId } : {}),
      ...(input.questionId ? { questionId: input.questionId } : {})
    }

    this.store.insertTipWithDeliveries(tip, studentIds)

    return {
      tip,
      studentIds,
      deliveryCount: studentIds.length
    }
  }

  public listForTeacher(
    teachingUnitId: string,
    teacherId: string
  ): TeacherTipSummary[] {
    const unit = this.org.getTeachingUnit(teachingUnitId)
    if (!unit) {
      throw new TeacherTipError(`Teaching unit not found: ${teachingUnitId}`)
    }
    if (unit.teacherId !== teacherId) {
      throw new TeacherTipError(
        'Forbidden: only the teaching-unit teacher may list tips for this unit'
      )
    }

    const tips = this.store.listTipsForUnit(teachingUnitId)
    return tips.map((tip) => {
      const deliveries = this.store.listDeliveriesForTip(tip.id)
      const readCount = deliveries.filter((d) => d.readAt !== undefined).length
      return {
        ...tip,
        deliveryCount: deliveries.length,
        readCount
      }
    })
  }

  /** Student inbox: unread first, then newest. Only own deliveries. */
  public listForStudent(studentId: string): StudentTipItem[] {
    const deliveries = this.store.listDeliveriesForStudent(studentId)
    const items: StudentTipItem[] = []
    for (const delivery of deliveries) {
      const tip = this.store.getTip(delivery.tipId)
      if (!tip) continue
      items.push({
        ...tip,
        ...(delivery.readAt ? { readAt: delivery.readAt } : {})
      })
    }
    items.sort((a, b) => {
      const aUnread = a.readAt === undefined ? 0 : 1
      const bUnread = b.readAt === undefined ? 0 : 1
      if (aUnread !== bUnread) return aUnread - bUnread
      return b.createdAt.localeCompare(a.createdAt)
    })
    return items
  }

  public markRead(
    tipId: string,
    studentId: string
  ): StudentTipItem {
    const delivery = this.store.getDelivery(tipId, studentId)
    if (!delivery) {
      throw new TeacherTipError(
        'Tip not found or not delivered to this student'
      )
    }
    const tip = this.store.getTip(tipId)
    if (!tip) {
      throw new TeacherTipError('Tip not found')
    }

    const readAt = delivery.readAt ?? this.now().toISOString()
    if (delivery.readAt === undefined) {
      this.store.markRead(tipId, studentId, readAt)
    }

    return { ...tip, readAt }
  }

  private resolveStudents(
    input: CreateTeacherTipInput,
    unit: { classId: string; termId: string }
  ): string[] {
    const enrolled = new Set(
      this.org.listEnrolledStudentIds(unit.classId, unit.termId)
    )
    if (input.studentIds && input.studentIds.length > 0) {
      const ids = [
        ...new Set(input.studentIds.filter((id) => id.trim() !== ''))
      ]
      const foreign = ids.filter((id) => !enrolled.has(id))
      if (foreign.length > 0) {
        throw new TeacherTipError(
          `Students not enrolled in this teaching unit: ${foreign.join(', ')}`
        )
      }
      return ids
    }
    return [...enrolled]
  }
}
