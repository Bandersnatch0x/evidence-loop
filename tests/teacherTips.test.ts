// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { InMemoryOrgReader } from '../server/adaptive'
import { JsonAttemptStore } from '../server/store/AttemptStore'
import {
  TeacherTipError,
  TeacherTipService
} from '../server/teacher/TeacherTipService'
import { TeacherTipStore } from '../server/teacher/TeacherTipStore'
import type { Attempt, EvaluationResult, TeachingUnit } from '../shared/contracts'

const NOW = () => new Date('2026-07-24T10:00:00.000Z')
const TEACHER = 'teacher-demo'
const OTHER_TEACHER = 'teacher-other'
const STUDENT_A = 'learner-demo'
const STUDENT_B = 'learner-b'
const FOREIGN = 'not-enrolled'

const UNIT: TeachingUnit = {
  id: 'tu-demo',
  teacherId: TEACHER,
  classId: 'class-demo',
  subjectId: 'math',
  termId: 'term-demo',
  taughtKpIds: ['kp-A']
}

let org: InMemoryOrgReader
let tipStore: TeacherTipStore
let tips: TeacherTipService
let attempts: JsonAttemptStore

beforeEach(() => {
  org = new InMemoryOrgReader()
  org.saveTeachingUnit(UNIT)
  org.saveEnrollment({
    id: 'enr-a',
    studentId: STUDENT_A,
    classId: UNIT.classId,
    termId: UNIT.termId
  })
  org.saveEnrollment({
    id: 'enr-b',
    studentId: STUDENT_B,
    classId: UNIT.classId,
    termId: UNIT.termId
  })
  tipStore = new TeacherTipStore({ dbPath: ':memory:' })
  tips = new TeacherTipService({ store: tipStore, org, now: NOW })
  attempts = new JsonAttemptStore(':memory:')
})

afterEach(() => {
  tipStore.close()
})

function scoredAttempt(score: number): Attempt {
  const result: EvaluationResult = {
    id: 'att-score-1',
    assignmentId: 'q-1',
    attempt: 1,
    createdAt: '2026-07-24T09:00:00.000Z',
    status: 'completed',
    score,
    summary: 'scored',
    evidence: [
      {
        id: 'ev-1',
        kind: 'test',
        label: 'correctness',
        dimensionId: 'correctness',
        visibility: 'public',
        state: 'passed',
        weight: score,
        message: 'ok',
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
    }
  }
  return {
    id: 'att-score-1',
    studentId: STUDENT_A,
    questionId: 'q-1',
    teachingUnitId: UNIT.id,
    termId: UNIT.termId,
    mode: 'assessment',
    createdAt: '2026-07-24T09:00:00.000Z',
    result
  }
}

describe('T14 TeacherTipService — send + fan-out', () => {
  it('teacher can send a tip to the whole enrolled class', () => {
    const out = tips.send(
      { teachingUnitId: UNIT.id, body: '今晚复习二次函数' },
      TEACHER
    )
    expect(out.deliveryCount).toBe(2)
    expect(out.studentIds.sort()).toEqual([STUDENT_A, STUDENT_B].sort())
    expect(out.tip.body).toBe('今晚复习二次函数')
    expect(out.tip.teacherId).toBe(TEACHER)
    expect(out.tip.teachingUnitId).toBe(UNIT.id)
  })

  it('teacher can target an explicit enrolled subset', () => {
    const out = tips.send(
      {
        teachingUnitId: UNIT.id,
        body: 'A 同学单独提示',
        studentIds: [STUDENT_A]
      },
      TEACHER
    )
    expect(out.studentIds).toEqual([STUDENT_A])
    expect(out.deliveryCount).toBe(1)
  })

  it('rejects studentIds not enrolled in the unit (T11/S2 gate)', () => {
    expect(() =>
      tips.send(
        {
          teachingUnitId: UNIT.id,
          body: '跨班广播',
          studentIds: [STUDENT_A, FOREIGN]
        },
        TEACHER
      )
    ).toThrow(TeacherTipError)
    expect(() =>
      tips.send(
        {
          teachingUnitId: UNIT.id,
          body: '跨班广播',
          studentIds: [FOREIGN]
        },
        TEACHER
      )
    ).toThrow(/not enrolled/i)
  })

  it('rejects a non-owner teacher (403-class)', () => {
    expect(() =>
      tips.send(
        { teachingUnitId: UNIT.id, body: '越权提示' },
        OTHER_TEACHER
      )
    ).toThrow(/only the teaching-unit teacher/i)
  })

  it('rejects empty body', () => {
    expect(() =>
      tips.send({ teachingUnitId: UNIT.id, body: '   ' }, TEACHER)
    ).toThrow(/empty/i)
  })
})

describe('T14 TeacherTipService — student inbox + read', () => {
  it('student sees unread tip then markRead sets readAt', () => {
    const sent = tips.send(
      { teachingUnitId: UNIT.id, body: '记得订正错题', studentIds: [STUDENT_A] },
      TEACHER
    )

    const inbox = tips.listForStudent(STUDENT_A)
    expect(inbox).toHaveLength(1)
    expect(inbox[0]?.id).toBe(sent.tip.id)
    expect(inbox[0]?.readAt).toBeUndefined()

    const marked = tips.markRead(sent.tip.id, STUDENT_A)
    expect(marked.readAt).toBe('2026-07-24T10:00:00.000Z')

    const after = tips.listForStudent(STUDENT_A)
    expect(after[0]?.readAt).toBe('2026-07-24T10:00:00.000Z')
  })

  it('student cannot read another student delivery', () => {
    const sent = tips.send(
      { teachingUnitId: UNIT.id, body: '只给 A', studentIds: [STUDENT_A] },
      TEACHER
    )
    expect(tips.listForStudent(STUDENT_B)).toHaveLength(0)
    expect(() => tips.markRead(sent.tip.id, STUDENT_B)).toThrow(
      /not delivered/i
    )
  })

  it('inbox sorts unread before read', () => {
    const first = tips.send(
      { teachingUnitId: UNIT.id, body: '第一条', studentIds: [STUDENT_A] },
      TEACHER
    )
    tips.send(
      { teachingUnitId: UNIT.id, body: '第二条', studentIds: [STUDENT_A] },
      TEACHER
    )
    tips.markRead(first.tip.id, STUDENT_A)

    const inbox = tips.listForStudent(STUDENT_A)
    expect(inbox).toHaveLength(2)
    expect(inbox[0]?.body).toBe('第二条')
    expect(inbox[0]?.readAt).toBeUndefined()
    expect(inbox[1]?.body).toBe('第一条')
    expect(inbox[1]?.readAt).toBeDefined()
  })
})

describe('T14 TeacherTipService — teacher list counters', () => {
  it('lists tips with delivery/read counts for the unit owner', () => {
    tips.send(
      {
        teachingUnitId: UNIT.id,
        body: '全班提示',
        studentIds: [STUDENT_A, STUDENT_B]
      },
      TEACHER
    )
    const before = tips.listForTeacher(UNIT.id, TEACHER)
    expect(before).toHaveLength(1)
    expect(before[0]?.deliveryCount).toBe(2)
    expect(before[0]?.readCount).toBe(0)

    tips.markRead(before[0]!.id, STUDENT_A)
    const after = tips.listForTeacher(UNIT.id, TEACHER)
    expect(after[0]?.readCount).toBe(1)
  })

  it('rejects list from non-owner teacher', () => {
    expect(() => tips.listForTeacher(UNIT.id, OTHER_TEACHER)).toThrow(
      /only the teaching-unit teacher/i
    )
  })
})

describe('T14 铁律 — tips never touch Attempt score', () => {
  it('sending a tip leaves result.score byte-identical', async () => {
    const attempt = scoredAttempt(72)
    await attempts.saveAttempt(attempt)
    const before = await attempts.getAttempt(attempt.id)
    expect(before?.result.score).toBe(72)
    const scoreJsonBefore = JSON.stringify(before?.result)

    tips.send(
      {
        teachingUnitId: UNIT.id,
        body: '与评分无关的提示',
        studentIds: [STUDENT_A],
        kpIds: ['kp-A'],
        questionId: 'q-1'
      },
      TEACHER
    )

    const after = await attempts.getAttempt(attempt.id)
    expect(after?.result.score).toBe(72)
    expect(JSON.stringify(after?.result)).toBe(scoreJsonBefore)
  })
})
