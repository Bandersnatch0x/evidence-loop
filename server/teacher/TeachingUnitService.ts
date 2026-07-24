import { randomUUID } from 'node:crypto'
import type {
  Class,
  CreateTeachingUnitInput,
  Subject,
  TeachingUnit,
  TeachingUnitView,
  Term
} from '../../shared/contracts'
import type { OrgReader } from '../adaptive/OrgReader'

/**
 * T08 teaching-unit service (D3: class × subject × term).
 *
 * Thin orchestration over the T01 org tables. The T06 SqliteOrgReader already
 * owns saveTeachingUnit/saveEnrollment + class/subject/term catalog helpers —
 * this service adds the teacher-facing create flow (look up class/subject/term
 * names for the Gradebook view) without re-implementing SQL.
 *
 * A teacher creates a unit for their own class×subject×term; taughtKpIds
 * carries the D4 taught set so un-taught KPs never alarm.
 */
export interface TeachingUnitServiceOptions {
  org: OrgReader & {
    saveTeachingUnit(unit: TeachingUnit): void
    saveEnrollment(enrollment: {
      id: string
      studentId: string
      classId: string
      termId: string
    }): void
    listClasses?: () => Class[]
    listSubjects?: () => Subject[]
    listTerms?: () => Term[]
  }
  now?: () => Date
}

export class TeachingUnitError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'TeachingUnitError'
  }
}

export class TeachingUnitService {
  private readonly org: TeachingUnitServiceOptions['org']
  private readonly now: () => Date

  public constructor(options: TeachingUnitServiceOptions) {
    this.org = options.org
    this.now = options.now ?? (() => new Date())
  }

  public create(
    input: CreateTeachingUnitInput,
    teacherId: string
  ): TeachingUnit {
    if (input.classId.trim() === '' || input.subjectId.trim() === '' || input.termId.trim() === '') {
      throw new TeachingUnitError(
        'classId, subjectId and termId are required'
      )
    }
    const unit: TeachingUnit = {
      id: `tu_${randomUUID()}`,
      teacherId,
      classId: input.classId,
      subjectId: input.subjectId,
      termId: input.termId,
      taughtKpIds: [...new Set(input.taughtKpIds)]
    }
    this.org.saveTeachingUnit(unit)
    return unit
  }

  public getView(id: string, teacherId: string): TeachingUnitView {
    const unit = this.org.getTeachingUnit(id)
    if (!unit) throw new TeachingUnitError(`Teaching unit not found: ${id}`)
    if (unit.teacherId !== teacherId) {
      throw new TeachingUnitError(
        'Forbidden: only the teaching-unit teacher may view it'
      )
    }
    const className = this.org.listClasses?.().find((c) => c.id === unit.classId)?.name ?? unit.classId
    const subjectName =
      this.org.listSubjects?.().find((s) => s.id === unit.subjectId)?.name ?? unit.subjectId
    const termName = this.org.listTerms?.().find((t) => t.id === unit.termId)?.name ?? unit.termId
    const enrolledCount = this.org.listEnrolledStudentIds(
      unit.classId,
      unit.termId
    ).length
    return {
      ...unit,
      className,
      subjectName,
      termName,
      enrolledCount
    }
  }
}
