import type { Question } from '../../shared/contracts'
import {
  createAssignmentRegistry,
  type ExecutableAssignment
} from '../data/assignments'
import type { QuestionStore } from './QuestionStore'

/**
 * Import the existing 14 hard-coded demo assignments into the questions table
 * as a "seed 题库" (T03 裁决: expand-contract with existing assignments).
 *
 * The seed rows are owned by a single virtual "system built-in" author so the
 * demo works out of the box, distinct from real teacher-private banks. The
 * RunnerSpec on each assignment is reused verbatim as the Question payload — the
 * RunnerRegistry already routes it by questionType, so seeded questions score
 * through the unchanged loop. KP tags are lifted from each assignment's evidence
 * conceptIds; difficulty is derived from estimatedMinutes.
 *
 * Idempotent: seed question ids are deterministic (`seed:<assignmentId>`), so a
 * re-run overwrites rather than duplicating.
 */

/** Virtual author owning the built-in seed bank (not a real teacher). */
export const SEED_AUTHOR_ID = 'system-builtin'
export const SEED_QUESTION_BANK_ID = 'seed-demo-bank'

/** Deterministic seed id so re-imports are idempotent. */
export function seedQuestionId(assignmentId: string): string {
  return `seed:${assignmentId}`
}

/** Map an assignment to a difficulty band (1..5) from its estimatedMinutes. */
function difficultyFromMinutes(minutes: number): number {
  if (minutes <= 4) return 1
  if (minutes <= 8) return 2
  if (minutes <= 15) return 3
  if (minutes <= 25) return 4
  return 5
}

/** Collect distinct KP ids from an assignment's evidence conceptIds. */
function kpIdsFromAssignment(assignment: ExecutableAssignment): string[] {
  const seen = new Set<string>()
  for (const criterion of assignment.criteria) {
    if (criterion.conceptId) seen.add(criterion.conceptId)
  }
  return [...seen]
}

/**
 * Convert a single demo assignment into a seed Question. The answer key is
 * marked `test_case` for code (machine-verified) and `authored_key` for every
 * other type (objective / CAS keys are teacher-authored answer keys, D2).
 */
export function assignmentToSeedQuestion(
  assignment: ExecutableAssignment,
  createdAt: string
): Question {
  return {
    id: seedQuestionId(assignment.id),
    questionBankId: SEED_QUESTION_BANK_ID,
    authorId: SEED_AUTHOR_ID,
    subject: assignment.language,
    questionType: assignment.questionType,
    stem: assignment.functionSignature || assignment.objective,
    payload: assignment.runner,
    kpIds: kpIdsFromAssignment(assignment),
    difficulty: difficultyFromMinutes(assignment.estimatedMinutes),
    // Code is machine-verified (test_case); all other seed keys are authored.
    source: assignment.questionType === 'code' ? 'test_case' : 'authored_key',
    createdAt
  }
}

export interface SeedResult {
  imported: number
  skipped: number
  questionIds: string[]
}

/**
 * Import every demo assignment into the store. Skips ids already present so a
 * teacher's later edits to a seeded question are never clobbered on restart.
 */
export function seedQuestionsFromAssignments(
  store: QuestionStore,
  now: () => Date = () => new Date()
): SeedResult {
  const registry = createAssignmentRegistry()
  const createdAt = now().toISOString()
  const questionIds: string[] = []
  let imported = 0
  let skipped = 0

  for (const summary of registry.list()) {
    const assignment = registry.get(summary.id)
    if (!assignment) continue
    const id = seedQuestionId(assignment.id)
    if (store.get(id) !== undefined) {
      skipped += 1
      questionIds.push(id)
      continue
    }
    store.save(assignmentToSeedQuestion(assignment, createdAt))
    imported += 1
    questionIds.push(id)
  }

  return { imported, skipped, questionIds }
}
