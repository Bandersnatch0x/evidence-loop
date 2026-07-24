// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { InMemoryOrgReader } from '../server/adaptive'
import { AuthService } from '../server/auth/AuthService'
import { AuthStore } from '../server/auth/AuthStore'
import {
  AssignmentService,
  SubjectiveGradingService,
  StudentImportService,
  TeachingUnitService
} from '../server/teacher'
import { QuestionBankService } from '../server/questionbank/QuestionBankService'
import { QuestionStore } from '../server/questionbank/QuestionStore'
import type { QuestionDraft } from '../server/questionbank/questionValidation'
import { JsonAttemptStore } from '../server/store/AttemptStore'
import { openMemoryDatabase } from '../server/db/memorySchema'
import type {
  Attempt,
  EvaluationResult,
  AdvisorySuggestion,
  TeachingUnit
} from '../shared/contracts'

const NOW = () => new Date('2026-07-24T08:00:00.000Z')
const TEACHER_EMAIL = 'teacher@t08.dev'

let db: ReturnType<typeof openMemoryDatabase>
let auth: AuthService
let questions: QuestionStore
let bank: QuestionBankService
let org: InMemoryOrgReader
let attempts: JsonAttemptStore
let teacherId: string
let essayQuestionId: string
let choiceQuestionIds: string[]

function essayDraft(authorId: string): QuestionDraft {
  return {
    questionBankId: 'bank-t08',
    authorId,
    subject: 'chinese',
    questionType: 'essay',
    stem: '作文题 立意与论证',
    payload: { kind: 'essay', minWords: 100 },
    kpIds: ['kp-essay'],
    difficulty: 3
  }
}

function choiceDraft(authorId: string, kpId: string): QuestionDraft {
  return {
    questionBankId: 'bank-t08',
    authorId,
    subject: 'math',
    questionType: 'choice',
    stem: `选择 ${kpId}`,
    payload: { kind: 'choice', correctOptionIds: ['A'] },
    kpIds: [kpId],
    difficulty: 2
  }
}

function advisory(): AdvisorySuggestion[] {
  return [
    {
      id: 'adv-1',
      dimensionLabel: '立意',
      suggestion: '建议深化论点',
      provenance: {
        kind: 'llm_inference',
        sourceMessages: ['建议深化论点'],
        model: 'rule-based',
        extractedAt: '2026-07-24T08:00:00.000Z'
      },
      requiresTeacherConfirmation: true
    }
  ]
}

function essayResult(
  attemptId: string,
  overrides: Partial<EvaluationResult> = {}
): EvaluationResult {
  return {
    id: attemptId,
    assignmentId: essayQuestionId,
    attempt: 1,
    createdAt: '2026-07-24T08:00:00.000Z',
    status: 'completed',
    score: 40,
    summary: '客观分 40/100',
    evidence: [
      {
        id: 'ev-obj',
        kind: 'structural_metric',
        label: '字数',
        dimensionId: 'structure',
        visibility: 'public',
        state: 'passed',
        weight: 40,
        message: '字数达标',
        source: 'test_case'
      }
    ],
    dimensions: [
      {
        id: 'structure',
        label: '结构',
        description: '',
        maxScore: 100,
        earnedScore: 40,
        state: 'passed',
        evidenceIds: ['ev-obj']
      }
    ],
    diagnoses: [],
    trace: [],
    mastery: [],
    feedbackSource: 'local-policy',
    studentId: 'student-a',
    provenance: { kind: 'evidence', evidenceIds: ['ev-obj'], algorithm: 'simple.v1' },
    advisory: advisory(),
    ...overrides
  }
}

function essayAttempt(
  id: string,
  teachingUnitId: string,
  res: EvaluationResult
): Attempt {
  return {
    id,
    studentId: 'student-a',
    questionId: essayQuestionId,
    teachingUnitId,
    termId: 'term-1',
    mode: 'assessment',
    createdAt: '2026-07-24T08:00:00.000Z',
    result: res
  }
}

beforeEach(() => {
  db = openMemoryDatabase(':memory:')
  const store = new AuthStore(db)
  auth = new AuthService(store)
  questions = new QuestionStore({ database: db })
  bank = new QuestionBankService({ store: questions, now: NOW })
  org = new InMemoryOrgReader()
  attempts = new JsonAttemptStore(':memory:')

  // Register a teacher so StudentImportService can resolve the actor.
  const session = auth.registerTeacher({
    email: TEACHER_EMAIL,
    password: 'password-t08',
    displayName: 'Teacher T08'
  })
  teacherId = session.user.userId

  essayQuestionId = bank.create(essayDraft(teacherId)).id
  choiceQuestionIds = [
    bank.create(choiceDraft(teacherId, 'kp-A')).id,
    bank.create(choiceDraft(teacherId, 'kp-A')).id
  ]

  const unit: TeachingUnit = {
    id: 'tu-1',
    teacherId,
    classId: 'cls-1',
    subjectId: 'subj-chinese',
    termId: 'term-1',
    taughtKpIds: ['kp-essay', 'kp-A']
  }
  org.saveTeachingUnit(unit)
  org.saveEnrollment({
    id: 'enr-1',
    studentId: 'student-a',
    classId: 'cls-1',
    termId: 'term-1'
  })
})

afterEach(() => {
  questions.close()
  db.close()
})

describe('T08 TeachingUnitService (D3)', () => {
  it('creates a teaching unit bound to the teacher', () => {
    const service = new TeachingUnitService({ org })
    const unit = service.create(
      {
        classId: 'cls-2',
        subjectId: 'subj-math',
        termId: 'term-1',
        taughtKpIds: ['kp-A', 'kp-B']
      },
      teacherId
    )
    expect(unit.teacherId).toBe(teacherId)
    expect(unit.taughtKpIds).toEqual(['kp-A', 'kp-B'])
  })

  it('auto-creates missing administrative class (T12/P2)', () => {
    const service = new TeachingUnitService({ org })
    expect(org.listClasses().some((c) => c.id === 'cls-new-auto')).toBe(false)
    service.create(
      {
        classId: 'cls-new-auto',
        subjectId: 'subj-math',
        termId: 'term-1',
        taughtKpIds: []
      },
      teacherId
    )
    const created = org.listClasses().find((c) => c.id === 'cls-new-auto')
    expect(created?.name).toBe('cls-new-auto')
  })

  it('lists only units owned by the teacher', () => {
    const service = new TeachingUnitService({ org })
    service.create(
      {
        classId: 'cls-2',
        subjectId: 'subj-math',
        termId: 'term-1',
        taughtKpIds: ['kp-A']
      },
      teacherId
    )
    org.saveTeachingUnit({
      id: 'tu-foreign',
      teacherId: 'other-teacher',
      classId: 'cls-x',
      subjectId: 'subj-x',
      termId: 'term-1',
      taughtKpIds: []
    })
    const listed = service.listForTeacher(teacherId)
    expect(listed.every((u) => u.teacherId === teacherId)).toBe(true)
    expect(listed.some((u) => u.id === 'tu-1')).toBe(true)
    expect(listed.some((u) => u.id === 'tu-foreign')).toBe(false)
  })

  it('forbids another teacher from viewing a unit', () => {
    const service = new TeachingUnitService({ org })
    expect(() => service.getView('tu-1', 'intruder')).toThrow(/Forbidden/)
  })
})

describe('T08 StudentImportService (roster + activation codes)', () => {
  it('imports students and binds enrollments', () => {
    const service = new StudentImportService({ auth, org })
    const result = service.import(
      { userId: teacherId, role: 'teacher' },
      'tu-1',
      [
        { studentNumber: '2026001', displayName: '张三' },
        { studentNumber: '2026002', displayName: '李四' }
      ]
    )
    expect(result.imported).toHaveLength(2)
    expect(result.imported[0]?.activationCode.length).toBeGreaterThan(0)
    // Enrollments bound for the new students on the unit's class×term
    const enrolled = org.listEnrolledStudentIds('cls-1', 'term-1')
    expect(enrolled).toContain(result.imported[0]?.userId)
  })

  it('rejects non-teacher actors', () => {
    const service = new StudentImportService({ auth, org })
    expect(() =>
      service.import(
        { userId: 'someone', role: 'student' },
        'tu-1',
        [{ studentNumber: '2026099', displayName: '王五' }]
      )
    ).toThrow(/Forbidden/)
  })

  it('forbids another teacher from importing into this unit', () => {
    const service = new StudentImportService({ auth, org })
    expect(() =>
      service.import(
        { userId: 'intruder', role: 'teacher' },
        'tu-1',
        [{ studentNumber: '2026098', displayName: '赵六' }]
      )
    ).toThrow(/Forbidden/)
  })
})

describe('T08 AssignmentService (three shapes)', () => {
  it('handpick creates per-student placeholder attempts', async () => {
    const service = new AssignmentService({
      questionBank: bank,
      attempts,
      org,
      now: NOW
    })
    const result = await service.create(
      {
        teachingUnitId: 'tu-1',
        mode: 'assessment',
        kind: 'handpick',
        questionIds: [...choiceQuestionIds],
        studentIds: ['student-a']
      },
      teacherId
    )
    expect(result.attemptIds).toHaveLength(2)
    expect(result.questionIds).toEqual(choiceQuestionIds)
    // Placeholders never feed mastery until submitted
    const saved = await attempts.getAttempt(result.attemptIds[0] ?? '')
    expect(saved?.result.status).toBe('rejected')
    // termId comes from the teaching unit (not a hardcode)
    expect(saved?.termId).toBe('term-1')
    // top-level paperId drives session grouping
    expect(saved?.paperId?.startsWith('paper_')).toBe(true)
  })

  it('forbids another teacher from assigning on this unit', async () => {
    const service = new AssignmentService({
      questionBank: bank,
      attempts,
      org,
      now: NOW
    })
    await expect(
      service.create(
        {
          teachingUnitId: 'tu-1',
          mode: 'assessment',
          kind: 'handpick',
          questionIds: [...choiceQuestionIds],
          studentIds: ['student-a']
        },
        'intruder'
      )
    ).rejects.toThrow(/Forbidden/)
  })

  it('assemble_by_kp assembles from the teacher bank', async () => {
    const service = new AssignmentService({
      questionBank: bank,
      attempts,
      org,
      now: NOW
    })
    const result = await service.create(
      {
        teachingUnitId: 'tu-1',
        mode: 'practice',
        kind: 'assemble_by_kp',
        kpIds: ['kp-A'],
        studentIds: ['student-a']
      },
      teacherId
    )
    expect(result.questionIds.length).toBeGreaterThan(0)
    expect(result.paperId.startsWith('paper_')).toBe(true)
  })

  it('writes dueAt onto placeholder attempts (T12/P1)', async () => {
    const service = new AssignmentService({
      questionBank: bank,
      attempts,
      org,
      now: NOW
    })
    const dueAt = '2026-07-31T16:00:00.000Z'
    const result = await service.create(
      {
        teachingUnitId: 'tu-1',
        mode: 'assessment',
        kind: 'handpick',
        questionIds: [choiceQuestionIds[0] ?? ''],
        studentIds: ['student-a'],
        dueAt
      },
      teacherId
    )
    expect(result.dueAt).toBe(dueAt)
    const saved = await attempts.getAttempt(result.attemptIds[0] ?? '')
    expect(saved?.dueAt).toBe(dueAt)
  })

  it('rejects studentIds not enrolled on the teaching unit (T11/S2)', async () => {
    const service = new AssignmentService({
      questionBank: bank,
      attempts,
      org,
      now: NOW
    })
    await expect(
      service.create(
        {
          teachingUnitId: 'tu-1',
          mode: 'assessment',
          kind: 'handpick',
          questionIds: [...choiceQuestionIds],
          studentIds: ['student-a', 'not-enrolled']
        },
        teacherId
      )
    ).rejects.toThrow(/not enrolled/)
  })

  it('handpick accepts system seed-bank questions (预置库)', async () => {
    // Seed a system-builtin question the demo teacher does not own privately.
    const seedId = 'seed:essay-demo'
    questions.save({
      id: seedId,
      questionBankId: 'seed-demo-bank',
      authorId: 'system-builtin',
      subject: 'chinese',
      questionType: 'essay',
      stem: '预置作文',
      payload: { kind: 'essay', minWords: 80 },
      kpIds: ['kp-essay'],
      difficulty: 2,
      source: 'authored_key',
      createdAt: '2026-07-24T08:00:00.000Z'
    })
    const service = new AssignmentService({
      questionBank: bank,
      attempts,
      org,
      now: NOW
    })
    const result = await service.create(
      {
        teachingUnitId: 'tu-1',
        mode: 'assessment',
        kind: 'handpick',
        questionIds: [seedId],
        studentIds: ['student-a']
      },
      teacherId
    )
    expect(result.questionIds).toEqual([seedId])
    expect(result.attemptIds).toHaveLength(1)
  })

  it('assemble_by_kp fills from seed bank when teacher bank is empty', async () => {
    questions.save({
      id: 'seed:kp-only',
      questionBankId: 'seed-demo-bank',
      authorId: 'system-builtin',
      subject: 'math',
      questionType: 'choice',
      stem: '预置选择',
      payload: { kind: 'choice', correctOptionIds: ['A'] },
      kpIds: ['kp-seed-only'],
      difficulty: 1,
      source: 'authored_key',
      createdAt: '2026-07-24T08:00:00.000Z'
    })
    const service = new AssignmentService({
      questionBank: bank,
      attempts,
      org,
      now: NOW
    })
    const result = await service.create(
      {
        teachingUnitId: 'tu-1',
        mode: 'practice',
        kind: 'assemble_by_kp',
        kpIds: ['kp-seed-only'],
        studentIds: ['student-a']
      },
      teacherId
    )
    expect(result.questionIds).toContain('seed:kp-only')
  })
})

describe('T08 SubjectiveGradingService (铁律闭环)', () => {
  let grading: SubjectiveGradingService

  beforeEach(async () => {
    grading = new SubjectiveGradingService({
      attempts,
      questions,
      org,
      hmacSecret: 'test-teacher-annotation-hmac',
      now: NOW
    })
    // Submit one essay attempt awaiting adjudication
    await attempts.saveAttempt(essayAttempt('att-essay-1', 'tu-1', essayResult('att-essay-1')))
  })

  it('queue surfaces only submitted essay attempts', async () => {
    // Add a non-essay completed attempt — must NOT appear
    await attempts.saveAttempt({
      id: 'att-choice-1',
      studentId: 'student-a',
      questionId: choiceQuestionIds[0] ?? '',
      teachingUnitId: 'tu-1',
      termId: 'term-1',
      mode: 'assessment',
      createdAt: '2026-07-24T08:00:00.000Z',
      result: {
        ...essayResult('att-choice-1'),
        assignmentId: choiceQuestionIds[0] ?? '',
        score: 10,
        evidence: [
          {
            id: 'ev-c',
            kind: 'answer_match',
            label: 'correct',
            dimensionId: 'correctness',
            visibility: 'public',
            state: 'passed',
            weight: 10,
            message: 'right',
            source: 'test_case'
          }
        ]
      }
    })
    const queue = await grading.queue('tu-1', teacherId)
    expect(queue).toHaveLength(1)
    expect(queue[0]?.attemptId).toBe('att-essay-1')
    // AI advisory suggestions are surfaced for the teacher to read
    expect(queue[0]?.advisory.length).toBeGreaterThan(0)
  })

  it('teacher grade writes teacherAnnotation WITHOUT touching score (铁律)', async () => {
    const out = await grading.grade(
      {
        attemptId: 'att-essay-1',
        subjectiveScore: 8,
        subjectiveMaxScore: 10,
        note: '立意深刻，论证可加强'
      },
      teacherId
    )
    expect(out.teacherAnnotation.subjectiveScore).toBe(8)
    expect(out.teacherAnnotation.teacherId).toBe(teacherId)
    // T13/P5: signature present and verifies
    expect(out.teacherAnnotation.signature?.length).toBeGreaterThan(0)

    // Reload: the automatic objective score is UNCHANGED.
    const saved = await attempts.getAttempt('att-essay-1')
    expect(saved?.result.score).toBe(40) // objective score untouched
    expect(saved?.result.teacherAnnotation?.subjectiveScore).toBe(8)
    // Annotation provenance is a separate layer; result.score provenance
    // stays 'evidence' — never flipped to teacher_annotation.
    expect(saved?.result.provenance.kind).toBe('evidence')
  })

  it('teacherAnnotation signature fails after field tamper (T13/P5)', async () => {
    const { verifyTeacherAnnotation } = await import(
      '../server/teacher/teacherAnnotationSignature'
    )
    const out = await grading.grade(
      {
        attemptId: 'att-essay-1',
        subjectiveScore: 7,
        subjectiveMaxScore: 10,
        note: 'ok'
      },
      teacherId
    )
    const secret = 'test-teacher-annotation-hmac'
    expect(
      verifyTeacherAnnotation('att-essay-1', out.teacherAnnotation, secret)
    ).toBe(true)
    const tampered = {
      ...out.teacherAnnotation,
      subjectiveScore: 10
    }
    expect(verifyTeacherAnnotation('att-essay-1', tampered, secret)).toBe(false)
  })

  it('listForTeacher throws when org list helper is missing (T13/S6)', () => {
    const bareOrg = {
      getTeachingUnit: (id: string) => org.getTeachingUnit(id),
      listEnrollments: (c: string, t: string) => org.listEnrollments(c, t),
      listEnrolledStudentIds: (c: string, t: string) =>
        org.listEnrolledStudentIds(c, t),
      saveTeachingUnit: (unit: Parameters<typeof org.saveTeachingUnit>[0]) =>
        org.saveTeachingUnit(unit),
      saveEnrollment: (enrollment: Parameters<typeof org.saveEnrollment>[0]) =>
        org.saveEnrollment(enrollment)
      // deliberately no listTeachingUnitsByTeacher
    }
    const service = new TeachingUnitService({ org: bareOrg })
    expect(() => service.listForTeacher(teacherId)).toThrow(/not wired/)
  })

  it('forbids another teacher from grading the unit', async () => {
    await expect(
      grading.grade(
        {
          attemptId: 'att-essay-1',
          subjectiveScore: 5,
          subjectiveMaxScore: 10,
          note: 'nope'
        },
        'intruder'
      )
    ).rejects.toThrow(/Forbidden/)
  })

  it('rejects out-of-range subjective scores', async () => {
    await expect(
      grading.grade(
        {
          attemptId: 'att-essay-1',
          subjectiveScore: 15,
          subjectiveMaxScore: 10,
          note: 'over'
        },
        teacherId
      )
    ).rejects.toThrow(/within/)
  })
})
