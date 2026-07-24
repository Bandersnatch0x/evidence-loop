// @vitest-environment node

import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type {
  Attempt,
  Class,
  Enrollment,
  EvaluationResult,
  Person,
  Subject,
  TeachingUnit,
  Term,
  User
} from '../shared/contracts'
import {
  migrateMemorySchema,
  openMemoryDatabase
} from '../server/db/memorySchema'
import {
  assertMediaPathSafe,
  extensionFromFilename,
  hashMediaBytes,
  mediaAbsolutePath,
  mediaRelativePath
} from '../server/media/paths'
import { MasteryService } from '../server/mastery/MasteryService'
import { JsonAttemptStore } from '../server/store/AttemptStore'
import { JsonEvaluationStore } from '../server/store/EvaluationStore'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SECRET = 't01-product-data-model-hmac'

function sampleResult(
  overrides: Partial<EvaluationResult> = {}
): EvaluationResult {
  return {
    id: 'eval_t01_1',
    assignmentId: 'python-average',
    attempt: 1,
    createdAt: '2026-07-24T00:00:00.000Z',
    status: 'completed',
    score: 100,
    summary: 'ok',
    evidence: [
      {
        id: 'empty-input',
        kind: 'test',
        label: 'empty',
        dimensionId: 'correctness',
        visibility: 'public',
        state: 'passed',
        weight: 20,
        message: 'ok',
        conceptId: 'empty-sequence',
        source: 'test_case'
      }
    ],
    dimensions: [],
    diagnoses: [],
    trace: [],
    mastery: [],
    feedbackSource: 'local-policy',
    studentId: 'student-1',
    provenance: {
      kind: 'evidence',
      evidenceIds: ['empty-input'],
      algorithm: 'simple.v1'
    },
    ...overrides
  }
}

function sampleAttempt(overrides: Partial<Attempt> = {}): Attempt {
  const result = overrides.result ?? sampleResult()
  return {
    id: result.id,
    studentId: 'student-1',
    questionId: result.assignmentId,
    teachingUnitId: 'tu-math-1',
    termId: 'term-2026-fall',
    mode: 'assessment',
    createdAt: result.createdAt,
    result,
    ...overrides
  }
}

describe('T01 product org + person types (compile + shape)', () => {
  it('constructs Term / Class / Subject / TeachingUnit / Enrollment', () => {
    const term: Term = {
      id: 'term-2026-fall',
      name: '2026 秋',
      startAt: '2026-09-01T00:00:00.000Z',
      endAt: '2027-01-15T00:00:00.000Z'
    }
    const klass: Class = { id: 'class-1', name: '高一(1)班' }
    const subject: Subject = {
      id: 'subject-math',
      name: '数学',
      language: 'math'
    }
    const unit: TeachingUnit = {
      id: 'tu-math-1',
      teacherId: 'teacher-1',
      classId: klass.id,
      subjectId: subject.id,
      termId: term.id,
      taughtKpIds: ['empty-sequence']
    }
    const enrollment: Enrollment = {
      id: 'enr-1',
      studentId: 'student-1',
      classId: klass.id,
      termId: term.id
    }
    expect(unit.taughtKpIds).toContain('empty-sequence')
    expect(enrollment.classId).toBe(klass.id)
  })

  it('constructs Person / User two-layer roles', () => {
    const person: Person = { id: 'person-1', displayName: 'Demo Student' }
    const student: User = {
      id: 'user-student-1',
      personId: person.id,
      role: 'student',
      loginId: '20260001',
      createdAt: '2026-07-24T00:00:00.000Z'
    }
    const teacher: User = {
      id: 'user-teacher-1',
      personId: 'person-t1',
      role: 'teacher',
      loginId: 't.zhang@school.example',
      createdAt: '2026-07-24T00:00:00.000Z'
    }
    expect(student.role).toBe('student')
    expect(teacher.role).toBe('teacher')
  })
})

describe('JsonAttemptStore expand-contract', () => {
  it('implements EvaluationStore via Attempt projection', async () => {
    const store = new JsonAttemptStore(':memory:')
    const attempt = sampleAttempt()
    await store.saveAttempt(attempt)

    const got = await store.get(attempt.id)
    expect(got?.id).toBe(attempt.id)
    expect(got?.evidence[0]?.source).toBe('test_case')

    const listed = await store.list({ studentId: 'student-1' })
    expect(listed).toHaveLength(1)
    expect(listed[0]?.assignmentId).toBe('python-average')

    const results = await store.listResults({ studentId: 'student-1' })
    expect(results[0]?.score).toBe(100)

    const attempts = await store.listAttempts({ mode: 'assessment' })
    expect(attempts).toHaveLength(1)
    expect(attempts[0]?.teachingUnitId).toBe('tu-math-1')
  })

  it('save(evaluation) wraps as assessment Attempt for legacy callers', async () => {
    const store = new JsonAttemptStore(':memory:')
    await store.save(sampleResult({ id: 'eval_legacy' }))
    const attempts = await store.listAttempts()
    expect(attempts).toHaveLength(1)
    expect(attempts[0]?.mode).toBe('assessment')
    expect(attempts[0]?.termId).toBe('legacy-term')
  })

  it('coexists with JsonEvaluationStore (expand-contract)', async () => {
    const legacy = new JsonEvaluationStore(':memory:')
    await legacy.save(sampleResult({ id: 'eval_json' }))
    expect((await legacy.listResults()).length).toBe(1)

    const next = new JsonAttemptStore(':memory:')
    await next.saveAttempt(sampleAttempt({ id: 'eval_attempt' }))
    expect((await next.listAttempts()).length).toBe(1)
  })

  it('reads legacy bare EvaluationResult rows without throwing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'attempt-store-'))
    const file = join(dir, 'evaluations.json')
    const withStudent = sampleResult({
      id: 'eval_legacy_file',
      studentId: 'learner-demo'
    })
    const { studentId: _omitStudentId, ...withoutStudent } = sampleResult({
      id: 'eval_legacy_no_student'
    })
    const legacyRows = [withStudent, withoutStudent]
    await writeFile(file, JSON.stringify(legacyRows, null, 2), 'utf8')

    const store = new JsonAttemptStore(file)
    const attempts = await store.listAttempts()
    expect(attempts).toHaveLength(2)
    expect(attempts.map((item) => item.id).sort()).toEqual([
      'eval_legacy_file',
      'eval_legacy_no_student'
    ])
    expect(attempts.find((item) => item.id === 'eval_legacy_file')?.studentId).toBe(
      'learner-demo'
    )
    expect(
      attempts.find((item) => item.id === 'eval_legacy_no_student')?.studentId
    ).toBe('unknown-student')
    expect(attempts.every((item) => item.mode === 'assessment')).toBe(true)

    const listed = await store.list()
    expect(listed).toHaveLength(2)
  })
})

describe('Mastery projector mode split (D1 iron rule)', () => {
  it('practice attempts feed nothing into formal mastery; assessment does', async () => {
    const store = new JsonAttemptStore(':memory:')
    const db = openMemoryDatabase(':memory:')
    const mastery = new MasteryService({
      db,
      hmacSecret: SECRET,
      evaluationStore: store
    })

    await store.saveAttempt(
      sampleAttempt({
        id: 'practice-1',
        mode: 'practice',
        result: sampleResult({
          id: 'practice-1',
          score: 0,
          evidence: [
            {
              id: 'empty-input',
              kind: 'test',
              label: 'empty',
              dimensionId: 'correctness',
              visibility: 'public',
              state: 'failed',
              weight: 20,
              message: 'fail',
              conceptId: 'empty-sequence',
              source: 'test_case'
            }
          ]
        })
      })
    )

    // Practice alone must not create a formal mastery row.
    await mastery.recompute('student-1', 'empty-sequence')
    expect(mastery.getProfile('student-1')['empty-sequence']?.score).toBe(0)
    expect(
      mastery.getProfile('student-1')['empty-sequence']?.evidenceIds ?? []
    ).toEqual([])

    await store.saveAttempt(
      sampleAttempt({
        id: 'assessment-1',
        mode: 'assessment',
        result: sampleResult({
          id: 'assessment-1',
          studentId: 'student-1'
        })
      })
    )

    const snapshot = await mastery.recompute('student-1', 'empty-sequence')
    expect(snapshot.score).toBe(1)
    expect(snapshot.evidenceIds).toEqual(['assessment-1:empty-input'])
    // Practice id must never appear in formal evidence ids.
    expect(snapshot.evidenceIds.some((id) => id.startsWith('practice-'))).toBe(
      false
    )

    db.close()
  })
})

describe('Drizzle product migrations (0001 + 0002)', () => {
  it('creates mastery/review and product org tables without dropping data', () => {
    const db = openMemoryDatabase(':memory:')

    // Seed mastery as pre-existing data would appear after 0001.
    db.prepare(
      `INSERT INTO mastery_scores (
        student_id, kp_id, score, evidence_ids, computed_at,
        algorithm_version, prev_hash, hmac
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'student-1',
      'kp-a',
      0.5,
      '[]',
      '2026-07-24T00:00:00.000Z',
      'simple.v1',
      '0'.repeat(64),
      'a'.repeat(64)
    )

    // Re-run migrations (idempotent) and ensure row survives + product tables exist.
    migrateMemorySchema(db)

    const masteryCount = db
      .prepare(`SELECT COUNT(*) AS c FROM mastery_scores`)
      .get() as { c: number }
    expect(masteryCount.c).toBe(1)

    for (const table of [
      'review_cards',
      'evaluations',
      'users',
      'terms',
      'classes',
      'teaching_units',
      'enrollments',
      'attempts',
      'auth_credentials',
      'auth_sessions'
    ]) {
      const row = db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
        )
        .get(table) as { name: string } | undefined
      expect(row?.name).toBe(table)
    }

    db.prepare(
      `INSERT INTO attempts (
        id, student_id, question_id, teaching_unit_id, term_id, mode, created_at, result_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'att-1',
      'student-1',
      'q-1',
      'tu-1',
      'term-1',
      'practice',
      '2026-07-24T00:00:00.000Z',
      JSON.stringify(sampleResult())
    )

    const attempt = db
      .prepare(`SELECT mode FROM attempts WHERE id = ?`)
      .get('att-1') as { mode: string }
    expect(attempt.mode).toBe('practice')

    db.close()
  })
})

describe('media content-addressed paths', () => {
  it('builds data/media/<hash>.<ext> and rejects traversal', () => {
    const bytes = Buffer.from('fake-image-bytes')
    const hash = hashMediaBytes(bytes)
    expect(hash).toBe(createHash('sha256').update(bytes).digest('hex'))

    const relative = mediaRelativePath(hash, '.png')
    expect(relative).toBe(`media/${hash}.png`)
    expect(mediaAbsolutePath('D:/data', hash, 'jpg').replace(/\\/g, '/')).toMatch(
      new RegExp(`media/${hash}\\.jpg$`)
    )
    expect(extensionFromFilename('scan.PDF')).toBe('.PDF')

    expect(() => assertMediaPathSafe('D:/data', 'media/../secret')).toThrow(
      /Unsafe media path/
    )
    expect(() => mediaRelativePath('not-a-hash', '.png')).toThrow(/64-char/)
  })
})

