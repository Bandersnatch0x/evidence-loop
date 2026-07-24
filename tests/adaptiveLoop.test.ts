// @vitest-environment node

import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  AssignByWeaknessService,
  EvidenceProjector,
  InMemoryOrgReader,
  NextPracticeService,
  TeachingUnitNotFoundError,
  handleAdaptiveApi
} from '../server/adaptive'
import type { SessionUser } from '../server/auth/SessionProvider'
import { MASTERY_THRESHOLD } from '../server/config/mastery'
import { openMemoryDatabase } from '../server/db/memorySchema'
import { JsonKnowledgeStore } from '../server/knowledge/KnowledgeStore'
import { InterventionService } from '../server/mastery/InterventionService'
import { MasteryService } from '../server/mastery/MasteryService'
import { QuestionBankService } from '../server/questionbank/QuestionBankService'
import { QuestionStore } from '../server/questionbank/QuestionStore'
import type { QuestionDraft } from '../server/questionbank/questionValidation'
import { ReviewScheduler } from '../server/review/ReviewScheduler'
import { JsonAttemptStore } from '../server/store/AttemptStore'
import type {
  Attempt,
  EvaluationResult,
  MasteryProfileMap,
  MasterySnapshot,
  TeachingUnit
} from '../shared/contracts'

const SECRET = 't06-adaptive-loop-hmac'
const TEACHER = 'teacher-t06'
const STUDENT_A = 'student-a'
const STUDENT_B = 'student-b'
const FIXED_NOW = () => new Date('2026-07-24T08:00:00.000Z')

function snapshot(score: number): MasterySnapshot {
  return {
    score,
    evidenceIds: [],
    computedAt: '2026-07-24T00:00:00.000Z',
    algorithmVersion: 'simple.v1'
  }
}

function profileOf(scores: Record<string, number>): MasteryProfileMap {
  const profile: MasteryProfileMap = {}
  for (const [kpId, score] of Object.entries(scores)) {
    profile[kpId] = snapshot(score)
  }
  return profile
}

function sampleUnit(overrides: Partial<TeachingUnit> = {}): TeachingUnit {
  return {
    id: 'tu-math-1',
    teacherId: TEACHER,
    classId: 'class-1',
    subjectId: 'subject-math',
    termId: 'term-2026-fall',
    taughtKpIds: ['kp-A', 'kp-B', 'kp-C'],
    ...overrides
  }
}

function choiceDraft(
  kpId: string,
  difficulty: number,
  stemSuffix: string
): QuestionDraft {
  return {
    questionBankId: 'bank-t06',
    authorId: TEACHER,
    subject: 'math',
    questionType: 'choice',
    stem: `巩固题 ${kpId} ${stemSuffix}`,
    payload: { kind: 'choice', correctOptionIds: ['A'] },
    kpIds: [kpId],
    difficulty
  }
}

function sampleResult(
  overrides: Partial<EvaluationResult> = {}
): EvaluationResult {
  return {
    id: 'eval_t06_1',
    assignmentId: 'q-1',
    attempt: 1,
    createdAt: '2026-07-24T08:00:00.000Z',
    status: 'completed',
    score: 0,
    summary: 'practice fail',
    evidence: [
      {
        id: 'ev-1',
        kind: 'test',
        label: 'kp-A',
        dimensionId: 'correctness',
        visibility: 'public',
        state: 'failed',
        weight: 10,
        message: 'fail',
        conceptId: 'kp-A',
        source: 'test_case'
      }
    ],
    dimensions: [],
    diagnoses: [],
    trace: [],
    mastery: [],
    feedbackSource: 'local-policy',
    studentId: STUDENT_A,
    provenance: {
      kind: 'evidence',
      evidenceIds: ['ev-1'],
      algorithm: 'simple.v1'
    },
    ...overrides
  }
}

describe('NextPracticeService (FSRS + dependency + D4)', () => {
  let db: ReturnType<typeof openMemoryDatabase>
  let review: ReviewScheduler
  let questions: QuestionStore
  let bank: QuestionBankService
  let org: InMemoryOrgReader
  let knowledge: JsonKnowledgeStore

  beforeEach(() => {
    db = openMemoryDatabase(':memory:')
    review = new ReviewScheduler({ db, hmacSecret: SECRET })
    questions = new QuestionStore({ database: db })
    bank = new QuestionBankService({ store: questions, now: FIXED_NOW })
    org = new InMemoryOrgReader()
    org.saveTeachingUnit(sampleUnit())
    // Chain: C depends on B depends on A
    knowledge = new JsonKnowledgeStore({
      seed: {
        points: [
          { id: 'kp-A', name: 'A', weight: 1 },
          { id: 'kp-B', name: 'B', weight: 1 },
          { id: 'kp-C', name: 'C', weight: 1 },
          { id: 'kp-UNTAUGHT', name: 'U', weight: 1 }
        ],
        edges: [
          { kpId: 'kp-C', prereqId: 'kp-B', strength: 1 },
          { kpId: 'kp-B', prereqId: 'kp-A', strength: 1 }
        ]
      }
    })

    // Seed bank: multiple difficulties per taught KP + one untaught KP.
    for (const kp of ['kp-A', 'kp-B', 'kp-C', 'kp-UNTAUGHT'] as const) {
      bank.create(choiceDraft(kp, 1, 'easy'))
      bank.create(choiceDraft(kp, 3, 'mid'))
      bank.create(choiceDraft(kp, 5, 'hard'))
    }
  })

  afterEach(() => {
    questions.close()
    db.close()
  })

  it('prioritises FSRS due cards and filters by taughtKpIds (D4)', async () => {
    // Due cards: untaught + taught; untaught must never appear.
    review.applyReview(STUDENT_A, 'kp-UNTAUGHT', 1, new Date('2026-07-01T00:00:00.000Z'))
    review.applyReview(STUDENT_A, 'kp-B', 1, new Date('2026-07-01T00:00:00.000Z'))
    review.applyReview(STUDENT_A, 'kp-C', 1, new Date('2026-07-02T00:00:00.000Z'))

    const mastery = {
      getProfile: () => profileOf({ 'kp-A': 0.9, 'kp-B': 0.9, 'kp-C': 0.9 })
    }
    const interventions = new InterventionService({ knowledge, mastery })
    const service = new NextPracticeService({
      review,
      mastery,
      interventions,
      questions,
      org,
      now: FIXED_NOW
    })

    const plan = await service.generate(STUDENT_A, 'tu-math-1')
    expect(plan.taughtKpIds).toEqual(['kp-A', 'kp-B', 'kp-C'])
    expect(plan.items.map((item) => item.kpId)).toEqual(['kp-B', 'kp-C'])
    expect(plan.items.every((item) => item.source === 'fsrs_due')).toBe(true)
    expect(plan.items.some((item) => item.kpId === 'kp-UNTAUGHT')).toBe(false)
    expect(plan.items[0]?.questions.length).toBeGreaterThan(0)
  })

  it('fills remaining slots from dependency-chain gaps within taught progress', async () => {
    // No due cards. Weak on C; A unmastered → intervention target A (taught).
    const mastery = {
      getProfile: () => profileOf({ 'kp-A': 0.2, 'kp-B': 0.5, 'kp-C': 0.1 })
    }
    const interventions = new InterventionService({ knowledge, mastery })
    const service = new NextPracticeService({
      review,
      mastery,
      interventions,
      questions,
      org,
      now: FIXED_NOW
    })

    const plan = await service.generate(STUDENT_A, 'tu-math-1', { limit: 5 })
    expect(plan.items.length).toBeGreaterThan(0)
    // First weak taught KP is A (score 0.2); intervention on A → A itself (no prereq).
    expect(plan.items.some((item) => item.source === 'dependency_gap')).toBe(true)
    expect(plan.items.every((item) => plan.taughtKpIds.includes(item.kpId))).toBe(
      true
    )
    expect(plan.items.every((item) => item.kpId !== 'kp-UNTAUGHT')).toBe(true)
  })

  it('never pushes an untaught prerequisite even when intervention points there', async () => {
    // Unit only taught C; mastery weak on C; prereq B/A untaught → stay on C.
    org.saveTeachingUnit(sampleUnit({ taughtKpIds: ['kp-C'] }))
    const mastery = {
      getProfile: () => profileOf({ 'kp-A': 0, 'kp-B': 0, 'kp-C': 0.1 })
    }
    const interventions = new InterventionService({ knowledge, mastery })
    const service = new NextPracticeService({
      review,
      mastery,
      interventions,
      questions,
      org,
      now: FIXED_NOW
    })

    const plan = await service.generate(STUDENT_A, 'tu-math-1')
    expect(plan.taughtKpIds).toEqual(['kp-C'])
    expect(plan.items.map((item) => item.kpId)).toEqual(['kp-C'])
  })

  it('returns empty items when taughtKpIds is empty', async () => {
    org.saveTeachingUnit(sampleUnit({ taughtKpIds: [] }))
    const mastery = { getProfile: () => profileOf({}) }
    const interventions = new InterventionService({ knowledge, mastery })
    const service = new NextPracticeService({
      review,
      mastery,
      interventions,
      questions,
      org,
      now: FIXED_NOW
    })

    const plan = await service.generate(STUDENT_A, 'tu-math-1')
    expect(plan.items).toEqual([])
  })

  it('throws when teaching unit is missing', async () => {
    const mastery = { getProfile: () => profileOf({}) }
    const interventions = new InterventionService({ knowledge, mastery })
    const service = new NextPracticeService({
      review,
      mastery,
      interventions,
      questions,
      org,
      now: FIXED_NOW
    })
    await expect(service.generate(STUDENT_A, 'missing-unit')).rejects.toBeInstanceOf(
      TeachingUnitNotFoundError
    )
  })
})

describe('AssignByWeaknessService', () => {
  let db: ReturnType<typeof openMemoryDatabase>
  let questions: QuestionStore
  let bank: QuestionBankService
  let org: InMemoryOrgReader
  let attempts: JsonAttemptStore

  beforeEach(() => {
    db = openMemoryDatabase(':memory:')
    questions = new QuestionStore({ database: db })
    bank = new QuestionBankService({ store: questions, now: FIXED_NOW })
    org = new InMemoryOrgReader()
    org.saveTeachingUnit(sampleUnit())
    org.saveEnrollment({
      id: 'enr-a',
      studentId: STUDENT_A,
      classId: 'class-1',
      termId: 'term-2026-fall'
    })
    org.saveEnrollment({
      id: 'enr-b',
      studentId: STUDENT_B,
      classId: 'class-1',
      termId: 'term-2026-fall'
    })
    attempts = new JsonAttemptStore(':memory:')

    bank.create(choiceDraft('kp-A', 2, 'assign-a1'))
    bank.create(choiceDraft('kp-A', 2, 'assign-a2'))
    bank.create(choiceDraft('kp-B', 2, 'assign-b1'))
  })

  afterEach(() => {
    questions.close()
    db.close()
  })

  it('aggregates class weak taught KPs, assembles paper, batch-creates practice Attempts', async () => {
    const mastery = {
      getProfile: (studentId: string) => {
        if (studentId === STUDENT_A) {
          return profileOf({ 'kp-A': 0.2, 'kp-B': 0.9, 'kp-C': 0.9 })
        }
        // Both weak on A → A ranks first; B not weak for B student
        return profileOf({ 'kp-A': 0.1, 'kp-B': 0.9, 'kp-C': 0.9 })
      }
    }
    const service = new AssignByWeaknessService({
      org,
      mastery,
      questionBank: bank,
      attempts,
      now: FIXED_NOW
    })

    const result = await service.assign({
      teachingUnitId: 'tu-math-1',
      teacherId: TEACHER,
      limit: 5
    })

    expect(result.kpIds[0]).toBe('kp-A')
    expect(result.studentIds).toEqual([STUDENT_A, STUDENT_B])
    expect(result.mode).toBe('practice')
    expect(result.questionIds.length).toBeGreaterThan(0)
    // 2 students × N questions
    expect(result.attemptIds.length).toBe(
      result.studentIds.length * result.questionIds.length
    )

    const stored = await attempts.listAttempts({ mode: 'practice' })
    expect(stored.length).toBe(result.attemptIds.length)
    expect(stored.every((item) => item.result.status === 'rejected')).toBe(true)
    expect(
      stored.every((item) => item.result.rejectionReason === 'assigned_not_started')
    ).toBe(true)
    // Placeholders must not look "completed" so they never enter mastery/FSRS.
    expect(stored.every((item) => item.teachingUnitId === 'tu-math-1')).toBe(true)
  })

  it('respects explicit kpIds ∩ taught and teacher ownership', async () => {
    const mastery = { getProfile: () => profileOf({}) }
    const service = new AssignByWeaknessService({
      org,
      mastery,
      questionBank: bank,
      attempts,
      now: FIXED_NOW
    })

    await expect(
      service.assign({
        teachingUnitId: 'tu-math-1',
        teacherId: 'other-teacher',
        kpIds: ['kp-A']
      })
    ).rejects.toThrow(/only the teaching-unit teacher/)

    const result = await service.assign({
      teachingUnitId: 'tu-math-1',
      teacherId: TEACHER,
      kpIds: ['kp-A', 'kp-UNTAUGHT'],
      studentIds: [STUDENT_A],
      mode: 'assessment',
      limit: 2
    })
    expect(result.kpIds).toEqual(['kp-A'])
    expect(result.mode).toBe('assessment')
    expect(result.studentIds).toEqual([STUDENT_A])
  })
})

describe('EvidenceProjector D1 dual-mode', () => {
  it('practice feeds FSRS but not formal MasteryProfile; assessment feeds both', async () => {
    const db = openMemoryDatabase(':memory:')
    const attemptStore = new JsonAttemptStore(':memory:')
    const mastery = new MasteryService({
      db,
      hmacSecret: SECRET,
      evaluationStore: attemptStore
    })
    const review = new ReviewScheduler({ db, hmacSecret: SECRET })
    const projector = new EvidenceProjector({ mastery, review })

    const practiceAttempt: Attempt = {
      id: 'practice-1',
      studentId: STUDENT_A,
      questionId: 'q-1',
      teachingUnitId: 'tu-math-1',
      termId: 'term-2026-fall',
      mode: 'practice',
      createdAt: '2026-07-24T08:00:00.000Z',
      result: sampleResult({
        id: 'practice-1',
        score: 0,
        evidence: [
          {
            id: 'ev-1',
            kind: 'test',
            label: 'kp-A',
            dimensionId: 'correctness',
            visibility: 'public',
            state: 'failed',
            weight: 10,
            message: 'fail',
            conceptId: 'kp-A',
            source: 'test_case'
          }
        ]
      })
    }
    await attemptStore.saveAttempt(practiceAttempt)

    const practiceProjection = await projector.projectAttempt(practiceAttempt)
    expect(practiceProjection.reviewCards.length).toBe(1)
    expect(practiceProjection.reviewCards[0]?.kpId).toBe('kp-A')
    expect(practiceProjection.masteryKpIds).toEqual([])
    // Formal mastery stays empty / zero — no assessment evidence yet.
    await mastery.recompute(STUDENT_A, 'kp-A')
    expect(mastery.getProfile(STUDENT_A)['kp-A']?.evidenceIds ?? []).toEqual([])

    const assessmentAttempt: Attempt = {
      ...practiceAttempt,
      id: 'assessment-1',
      mode: 'assessment',
      result: sampleResult({
        id: 'assessment-1',
        score: 100,
        evidence: [
          {
            id: 'ev-1',
            kind: 'test',
            label: 'kp-A',
            dimensionId: 'correctness',
            visibility: 'public',
            state: 'passed',
            weight: 10,
            message: 'ok',
            conceptId: 'kp-A',
            source: 'test_case'
          }
        ]
      })
    }
    await attemptStore.saveAttempt(assessmentAttempt)
    const assessmentProjection = await projector.projectAttempt(assessmentAttempt)
    expect(assessmentProjection.masteryKpIds).toContain('kp-A')
    expect(assessmentProjection.reviewCards.length).toBe(1)
    expect(mastery.getProfile(STUDENT_A)['kp-A']?.score).toBe(1)

    db.close()
  })
})

describe('adaptive HTTP routes', () => {
  let db: ReturnType<typeof openMemoryDatabase>
  let questions: QuestionStore
  let bank: QuestionBankService
  let org: InMemoryOrgReader
  let attempts: JsonAttemptStore
  let nextPractice: NextPracticeService
  let assignByWeakness: AssignByWeaknessService
  let baseUrl: string
  let closeServer: () => Promise<void>

  beforeEach(async () => {
    db = openMemoryDatabase(':memory:')
    const review = new ReviewScheduler({ db, hmacSecret: SECRET })
    questions = new QuestionStore({ database: db })
    bank = new QuestionBankService({ store: questions, now: FIXED_NOW })
    org = new InMemoryOrgReader()
    org.saveTeachingUnit(sampleUnit())
    org.saveEnrollment({
      id: 'enr-a',
      studentId: STUDENT_A,
      classId: 'class-1',
      termId: 'term-2026-fall'
    })
    attempts = new JsonAttemptStore(':memory:')
    bank.create(choiceDraft('kp-A', 2, 'route'))
    bank.create(choiceDraft('kp-B', 2, 'route'))

    const mastery = {
      getProfile: () =>
        profileOf({
          'kp-A': MASTERY_THRESHOLD - 0.1,
          'kp-B': 0.9,
          'kp-C': 0.9
        })
    }
    const knowledge = new JsonKnowledgeStore({
      seed: {
        points: [
          { id: 'kp-A', name: 'A', weight: 1 },
          { id: 'kp-B', name: 'B', weight: 1 },
          { id: 'kp-C', name: 'C', weight: 1 }
        ],
        edges: []
      }
    })
    const interventions = new InterventionService({ knowledge, mastery })
    nextPractice = new NextPracticeService({
      review,
      mastery,
      interventions,
      questions,
      org,
      now: FIXED_NOW
    })
    assignByWeakness = new AssignByWeaknessService({
      org,
      mastery,
      questionBank: bank,
      attempts,
      now: FIXED_NOW
    })

    const teacher: SessionUser = {
      userId: TEACHER,
      role: 'teacher',
      displayName: 'Teacher T06'
    }
    const student: SessionUser = {
      userId: STUDENT_A,
      role: 'student',
      displayName: 'Student A',
      studentId: STUDENT_A
    }

    const server = createServer((request, response) => {
      void (async () => {
        const url = new URL(
          request.url ?? '/',
          `http://${request.headers.host ?? 'localhost'}`
        )
        const roleHeader = request.headers['x-demo-role']
        const user =
          roleHeader === 'student'
            ? student
            : roleHeader === 'stranger'
              ? {
                  userId: 'stranger',
                  role: 'student' as const,
                  displayName: 'Stranger',
                  studentId: 'other-student'
                }
              : teacher
        const handled = await handleAdaptiveApi(request, response, url, {
          nextPractice,
          assignByWeakness,
          user
        })
        if (!handled) {
          response.writeHead(404)
          response.end('not adaptive')
        }
      })()
    })

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${String(address.port)}`
    closeServer = () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
  })

  afterEach(async () => {
    await closeServer()
    questions.close()
    db.close()
  })

  it('GET /api/adaptive/next returns a plan for the student', async () => {
    const response = await fetch(
      `${baseUrl}/api/adaptive/next?studentId=${STUDENT_A}&unitId=tu-math-1`,
      { headers: { 'x-demo-role': 'student' } }
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      studentId: string
      items: Array<{ kpId: string }>
    }
    expect(body.studentId).toBe(STUDENT_A)
    expect(Array.isArray(body.items)).toBe(true)
  })

  it('GET /api/adaptive/next forbids another student', async () => {
    const response = await fetch(
      `${baseUrl}/api/adaptive/next?studentId=${STUDENT_A}&unitId=tu-math-1`,
      { headers: { 'x-demo-role': 'stranger' } }
    )
    expect(response.status).toBe(403)
  })

  it('POST /api/adaptive/assign-weakness requires teacher and creates attempts', async () => {
    const studentResponse = await fetch(`${baseUrl}/api/adaptive/assign-weakness`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-demo-role': 'student'
      },
      body: JSON.stringify({ teachingUnitId: 'tu-math-1', kpIds: ['kp-A'] })
    })
    expect(studentResponse.status).toBe(403)

    const teacherResponse = await fetch(`${baseUrl}/api/adaptive/assign-weakness`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-demo-role': 'teacher'
      },
      body: JSON.stringify({
        teachingUnitId: 'tu-math-1',
        kpIds: ['kp-A'],
        studentIds: [STUDENT_A],
        limit: 2
      })
    })
    expect(teacherResponse.status).toBe(201)
    const body = (await teacherResponse.json()) as {
      attemptIds: string[]
      mode: string
    }
    expect(body.mode).toBe('practice')
    expect(body.attemptIds.length).toBeGreaterThan(0)
  })
})

