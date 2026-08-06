// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuditStore } from '../server/audit/AuditStore'
import { openMemoryDatabase } from '../server/db/memorySchema'
import { createServerContext } from '../server/serverContext'

const tempRoots: string[] = []

afterEach(async () => {
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
})
