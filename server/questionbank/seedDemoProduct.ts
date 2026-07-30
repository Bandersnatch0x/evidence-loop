import type { Enrollment, TeachingUnit } from '../../shared/contracts'
import type { SqliteOrgReader } from '../adaptive/OrgReader'
import type { QuestionStore } from './QuestionStore'
import { ensureDemoCurveVisualizations } from './demoVisualizations'
import {
  SEED_AUTHOR_ID,
  seedQuestionsFromAssignments
} from './seedFromAssignments'

/**
 * Demo product bootstrap for T07 student + T08 teacher surfaces.
 *
 * T03 left `seedQuestionsFromAssignments` unmounted on the main process, so a
 * cold product.sqlite had an empty bank and T06 "今日该练" could never pick
 * questions. This helper is the minimal coordinator glue:
 *   1. Idempotently seed the built-in question bank from demo assignments
 *   2. Ensure a demo teaching unit (`tu-demo`) owned by the demo teacher
 *      (`teacher-demo` — matches MockSessionProvider) so T08 roster / assign /
 *      grade paths pass ownership checks on cold start
 *   3. Enroll the demo learner so student-scoped routes resolve cleanly
 *
 * Safe to call on every boot — all writes are upsert / overwrite by id.
 *
 * Note: seed questions stay authored by `system-builtin` (预置库). T08
 * AssignmentService resolves them via getAssignable / seed-inclusive assemble.
 */

export const DEMO_TEACHING_UNIT_ID = 'tu-demo'
export const DEMO_TERM_ID = 'term-demo'
export const DEMO_CLASS_ID = 'class-demo'
export const DEMO_LEARNER_ID = 'learner-demo'
/** Matches MockSessionProvider DEMO_USERS.teacher.userId. */
export const DEMO_TEACHER_ID = 'teacher-demo'

export interface SeedDemoProductResult {
  questionsImported: number
  curveVisualizationsSeeded: number
  taughtKpCount: number
  teachingUnitId: string
  teacherId: string
}

export function seedDemoProduct(input: {
  questions: QuestionStore
  org: SqliteOrgReader
  now?: () => Date
}): SeedDemoProductResult {
  const now = input.now ?? (() => new Date())
  const seed = seedQuestionsFromAssignments(input.questions, now)
  // ADR-0015: attach pre-sampled curve demos (magnetic helix / DNA) — no LLM.
  const curveVisualizationsSeeded = ensureDemoCurveVisualizations(input.questions)

  const taughtKpIds = collectTaughtKpIds(input.questions)
  const unit: TeachingUnit = {
    id: DEMO_TEACHING_UNIT_ID,
    teacherId: DEMO_TEACHER_ID,
    classId: DEMO_CLASS_ID,
    subjectId: 'math',
    termId: DEMO_TERM_ID,
    taughtKpIds
  }
  input.org.saveTeachingUnit(unit)

  const enrollment: Enrollment = {
    id: `enr_${DEMO_LEARNER_ID}_${DEMO_CLASS_ID}_${DEMO_TERM_ID}`,
    studentId: DEMO_LEARNER_ID,
    classId: DEMO_CLASS_ID,
    termId: DEMO_TERM_ID
  }
  input.org.saveEnrollment(enrollment)

  return {
    questionsImported: seed.imported,
    curveVisualizationsSeeded,
    taughtKpCount: taughtKpIds.length,
    teachingUnitId: unit.id,
    teacherId: unit.teacherId
  }
}

function collectTaughtKpIds(questions: QuestionStore): string[] {
  const seen = new Set<string>()
  for (const question of questions.list({
    authorId: SEED_AUTHOR_ID,
    limit: 500
  })) {
    for (const kpId of question.kpIds) {
      if (kpId.trim() !== '') seen.add(kpId)
    }
  }
  // Cap so D4 filter stays demo-sized; order stable for snapshots.
  return [...seen].sort().slice(0, 40)
}
