// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuditStore } from '../server/audit/AuditStore'
import { openMemoryDatabase } from '../server/db/memorySchema'
import { MediaWorkerLoop } from '../server/media/MediaWorkerLoop'
import { MemoryLayer } from '../server/memory/MemoryLayer'
import { RunnerRegistry } from '../server/runner/RunnerRegistry'
import { createServerContext } from '../server/serverContext'

const tempRoots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(
    tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  )
})

describe('createServerContext', () => {
  it('assembles the runtime context and disposes owned resources idempotently', async () => {
    const productDb = openMemoryDatabase(':memory:')
    const mediaDataRoot = await mkdtemp(join(tmpdir(), 'server-context-'))
    tempRoots.push(mediaDataRoot)
    const audit = new AuditStore({
      dbPath: ':memory:',
      hmacSecret: 'server-context-test-hmac'
    })

    const composed = await createServerContext({
      dataFile: ':memory:',
      auditStore: audit,
      auditHmacSecret: 'server-context-test-hmac',
      memoryDbPath: ':memory:',
      productDb,
      mediaDataRoot
    })

    expect(composed.context.productDb).toBe(productDb)
    expect(composed.context.runnerName).toBeTruthy()
    expect(composed.context.assignments.list().length).toBeGreaterThan(0)
    expect(composed.context.demonstration.db).toBe(productDb)
    expect(composed.context.media.db).toBe(productDb)

    await composed.dispose()
    await composed.dispose()

    // Injected product DB is caller-owned; composition teardown must not close it.
    expect(productDb.prepare('SELECT 1 AS value').get()).toEqual({ value: 1 })
    productDb.close()
  })

  it('cleans composed resources when a late seed step fails', async () => {
    const productDb = openMemoryDatabase(':memory:')
    productDb.exec(`
      CREATE TRIGGER fail_seed_question
      BEFORE INSERT ON questions
      BEGIN
        SELECT RAISE(ABORT, 'forced seed failure');
      END;
    `)
    const mediaDataRoot = await mkdtemp(join(tmpdir(), 'server-context-fail-'))
    tempRoots.push(mediaDataRoot)
    const audit = new AuditStore({
      dbPath: ':memory:',
      hmacSecret: 'server-context-failure-hmac'
    })
    const runners = new RunnerRegistry()
    const runnerDispose = vi.spyOn(runners, 'dispose')
    const auditClose = vi.spyOn(audit, 'close')
    const memoryClose = vi.spyOn(MemoryLayer.prototype, 'close')
    const workerStop = vi.spyOn(MediaWorkerLoop.prototype, 'stop')

    await expect(
      createServerContext({
        dataFile: ':memory:',
        runners,
        auditStore: audit,
        auditHmacSecret: 'server-context-failure-hmac',
        memoryDbPath: ':memory:',
        productDb,
        mediaDataRoot
      })
    ).rejects.toThrow('forced seed failure')

    expect(workerStop).toHaveBeenCalledOnce()
    expect(runnerDispose).toHaveBeenCalledOnce()
    expect(auditClose).toHaveBeenCalledOnce()
    expect(memoryClose).toHaveBeenCalledOnce()
  })

  it('defaults to SqliteAttemptStore and shares history across two contexts on one product db file (复赛 item 2)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'server-context-sqlite-'))
    tempRoots.push(root)
    const mediaDataRoot = join(root, 'media')
    const audit = new AuditStore({
      dbPath: ':memory:',
      hmacSecret: 'server-context-sqlite-hmac'
    })
    const { SqliteAttemptStore } = await import('../server/store/SqliteAttemptStore')

    const first = await createServerContext({
      productDbPath: join(root, 'product.sqlite'),
      auditStore: audit,
      auditHmacSecret: 'server-context-sqlite-hmac',
      memoryDbPath: ':memory:',
      mediaDataRoot
    })
    expect(first.context.store).toBeInstanceOf(SqliteAttemptStore)
    await first.context.store.saveAttempt({
      id: 'ctx_shared_1',
      studentId: 'student-1',
      questionId: 'python-average',
      teachingUnitId: 'tu-math-1',
      termId: 'term-2026-fall',
      mode: 'assessment',
      createdAt: '2026-07-24T00:00:00.000Z',
      result: {
        id: 'ctx_shared_1',
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
        }
      }
    })
    await first.dispose()

    // A second context over the same product db file sees the first's history.
    const second = await createServerContext({
      productDbPath: join(root, 'product.sqlite'),
      auditStore: audit,
      auditHmacSecret: 'server-context-sqlite-hmac',
      memoryDbPath: ':memory:',
      mediaDataRoot
    })
    expect((await second.context.store.getAttempt('ctx_shared_1'))?.studentId).toBe(
      'student-1'
    )
    await second.dispose()
  })
})
