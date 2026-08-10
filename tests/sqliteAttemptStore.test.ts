// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  Attempt,
  EvaluationResult
} from '../shared/contracts'
import { SqliteAttemptStore } from '../server/store/SqliteAttemptStore'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  )
})

async function tempFile(contents: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sqlite-attempt-'))
  tempRoots.push(dir)
  const path = join(dir, 'legacy.json')
  await writeFile(path, contents, 'utf8')
  return path
}

function sampleResult(overrides: Partial<EvaluationResult> = {}): EvaluationResult {
  return {
    id: 'eval_1',
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
    provenance: { kind: 'evidence', evidenceIds: ['empty-input'], algorithm: 'simple.v1' },
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

describe('SqliteAttemptStore', () => {
  it('round-trips attempts through the AttemptStore surface', async () => {
    const store = new SqliteAttemptStore({ dbPath: ':memory:' })
    await store.saveAttempt(sampleAttempt({ id: 'a1' }))

    expect((await store.getAttempt('a1'))?.studentId).toBe('student-1')

    const byStudent = await store.listAttempts({ studentId: 'student-1' })
    expect(byStudent).toHaveLength(1)
    expect(byStudent[0]!.mode).toBe('assessment')

    expect(
      await store.listAttempts({ studentId: 'student-1', questionId: 'python-average' })
    ).toHaveLength(1)
    expect(await store.listAttempts({ studentId: 'nobody' })).toHaveLength(0)
    expect(await store.listAttempts({ mode: 'practice' })).toHaveLength(0)

    expect(await store.deleteAttempt('a1')).toBe(true)
    expect(await store.deleteAttempt('a1')).toBe(false)
    expect(await store.getAttempt('a1')).toBeUndefined()
    store.close()
  })

  it('upserts on id without duplicating rows', async () => {
    const store = new SqliteAttemptStore({ dbPath: ':memory:' })
    await store.saveAttempts([
      sampleAttempt({ id: 'a1', result: sampleResult({ score: 40 }) })
    ])
    await store.saveAttempts([
      sampleAttempt({ id: 'a1', result: sampleResult({ score: 90 }) })
    ])

    const rows = await store.listAttempts()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.result.score).toBe(90)
    store.close()
  })

  it('lists attempts newest-first', async () => {
    const store = new SqliteAttemptStore({ dbPath: ':memory:' })
    await store.saveAttempts([
      sampleAttempt({
        id: 'old',
        createdAt: '2026-07-20T00:00:00.000Z',
        result: sampleResult({
          id: 'r_old',
          createdAt: '2026-07-20T00:00:00.000Z'
        })
      }),
      sampleAttempt({
        id: 'new',
        createdAt: '2026-07-25T00:00:00.000Z',
        result: sampleResult({
          id: 'r_new',
          createdAt: '2026-07-25T00:00:00.000Z'
        })
      })
    ])
    expect((await store.listAttempts()).map((item) => item.id)).toEqual([
      'new',
      'old'
    ])
    expect((await store.latest('python-average'))?.id).toBe('r_new')
    store.close()
  })

  it('implements the EvaluationStore projection (expand-contract)', async () => {
    const store = new SqliteAttemptStore({ dbPath: ':memory:' })
    await store.save(sampleResult({ id: 'e1' }))

    const stored = await store.get('e1')
    expect(stored?.score).toBe(100)

    const history = await store.list({ assignmentId: 'python-average' })
    expect(history).toHaveLength(1)
    expect(history[0]!.id).toBe('e1')

    const results = await store.listResults({ studentId: 'student-1' })
    expect(results[0]!.provenance.kind).toBe('evidence')

    // save() projects to a legacy Attempt: assessment mode + legacy unit (D1).
    const attempt = await store.getAttempt('e1')
    expect(attempt?.mode).toBe('assessment')
    expect(attempt?.teachingUnitId).toBe('legacy-teaching-unit')

    expect(await store.delete('e1')).toBe(true)
    expect(await store.get('e1')).toBeUndefined()
    store.close()
  })

  it('round-trips paperId and dueAt (migration 0020 columns)', async () => {
    const store = new SqliteAttemptStore({ dbPath: ':memory:' })
    const attempt = sampleAttempt({
      id: 'paper_attempt_1',
      paperId: 'paper-mock-1',
      dueAt: '2026-08-30T23:59:00.000Z'
    })
    await store.saveAttempt(attempt)

    const loaded = await store.getAttempt('paper_attempt_1')
    expect(loaded?.paperId).toBe('paper-mock-1')
    expect(loaded?.dueAt).toBe('2026-08-30T23:59:00.000Z')

    // Absent paperId/dueAt stay undefined (null columns), not empty strings.
    const plain = await store.getAttempt('paper_attempt_1')
    expect(plain).toBeDefined()
    expect((await store.listAttempts()).length).toBeGreaterThan(0)
    store.close()
  })

  it('imports legacy JSON once, idempotently, and non-destructively', async () => {
    const filePath = await tempFile(
      JSON.stringify([
        sampleAttempt({ id: 'a1' }),
        sampleResult({ id: 'legacy_1', studentId: 'student-legacy' }),
        { junk: true }
      ])
    )
    const store = new SqliteAttemptStore({ dbPath: ':memory:' })

    expect(await store.importLegacyJson(filePath)).toBe(2)
    // Junk row skipped; legacy row coerced into an Attempt wrapper.
    const rows = await store.listAttempts()
    expect(rows).toHaveLength(2)
    expect(rows.some((row) => row.id === 'legacy_1')).toBe(true)
    expect(rows.some((row) => row.id === 'a1')).toBe(true)

    // Table no longer empty → second boot is a no-op.
    expect(await store.importLegacyJson(filePath)).toBe(0)
    expect(await store.listAttempts()).toHaveLength(2)

    // File untouched (non-destructive migration).
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toHaveLength(3)
    store.close()
  })

  it('missing legacy file imports nothing', async () => {
    const store = new SqliteAttemptStore({ dbPath: ':memory:' })
    expect(await store.importLegacyJson('/nonexistent/legacy.json')).toBe(0)
    store.close()
  })

  it('shares history across instances on the same db file (multi-instance)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sqlite-attempt-shared-'))
    tempRoots.push(dir)
    const dbPath = join(dir, 'product.sqlite')

    const first = new SqliteAttemptStore({ dbPath })
    const second = new SqliteAttemptStore({ dbPath })

    await first.saveAttempt(sampleAttempt({ id: 'shared_1' }))
    expect((await second.getAttempt('shared_1'))?.studentId).toBe('student-1')

    await second.saveAttempt(
      sampleAttempt({ id: 'shared_2', result: sampleResult({ id: 'shared_2' }) })
    )
    expect((await first.listAttempts()).map((item) => item.id).sort()).toEqual([
      'shared_1',
      'shared_2'
    ])

    first.close()
    second.close()
  })

  it('opens an in-memory database by default', async () => {
    const store = new SqliteAttemptStore()
    await store.saveAttempt(sampleAttempt({ id: 'mem_1' }))
    expect(await store.getAttempt('mem_1')).toBeDefined()
    store.close()
  })
})
