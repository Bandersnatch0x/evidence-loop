// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest'
import { AuditStore, resolveAuditHmacSecret } from '../server/audit/AuditStore'

const SECRET = 'test-audit-hmac-secret'

describe('AuditStore', () => {
  const stores: AuditStore[] = []

  afterEach(async () => {
    await Promise.all(stores.splice(0).map((store) => store.close()))
  })

  function createStore(overrides?: {
    flushIntervalMs?: number
    flushBatchSize?: number
  }): AuditStore {
    const store = new AuditStore({
      dbPath: ':memory:',
      hmacSecret: SECRET,
      flushIntervalMs: overrides?.flushIntervalMs ?? 5_000,
      flushBatchSize: overrides?.flushBatchSize ?? 100
    })
    stores.push(store)
    return store
  }

  it('detects hash-chain breakage after a record is tampered', async () => {
    const store = createStore()
    store.enqueue({
      actorRole: 'student',
      action: 'evaluate',
      resourceType: 'evaluation',
      studentId: 'learner-demo',
      containerId: 'python-subprocess',
      result: 'success'
    })
    store.enqueue({
      actorRole: 'teacher',
      action: 'view',
      resourceType: 'cohort',
      result: 'success'
    })
    await store.flush()

    const healthy = await store.verifyIntegrity()
    expect(healthy).toEqual({ valid: true, checkedCount: 2 })

    await store.tamperForTest(1, 'result', 'forged-success')
    const broken = await store.verifyIntegrity()
    expect(broken.valid).toBe(false)
    expect(broken.brokenAtSequence).toBe(1)
    expect(broken.reason).toMatch(/hash mismatch|Hash chain broken/i)
  })

  it('fails verification when an HMAC signature is wrong', async () => {
    const store = createStore()
    store.enqueue({
      actorRole: 'student',
      action: 'evaluate',
      resourceType: 'evaluation',
      result: 'success'
    })
    await store.flush()

    await store.tamperForTest(1, 'signature', '0'.repeat(64))
    const broken = await store.verifyIntegrity()
    expect(broken.valid).toBe(false)
    expect(broken.reason).toMatch(/HMAC signature/i)
  })

  it('flushes 100 concurrent enqueues within 5s without blocking the caller >10ms', async () => {
    const store = createStore({ flushBatchSize: 100, flushIntervalMs: 5_000 })

    const enqueueStarted = performance.now()
    for (let index = 0; index < 100; index += 1) {
      store.enqueue({
        actorRole: 'student',
        action: 'evaluate',
        resourceType: 'evaluation',
        studentId: `learner-${String(index % 5)}`,
        containerId: 'python-subprocess',
        result: 'success',
        metadata: { index }
      })
    }
    const enqueueElapsedMs = performance.now() - enqueueStarted
    expect(enqueueElapsedMs).toBeLessThan(10)

    const flushStarted = performance.now()
    await store.flush()
    const flushElapsedMs = performance.now() - flushStarted
    expect(flushElapsedMs).toBeLessThan(5_000)

    const records = await store.query({ limit: 200 })
    expect(records).toHaveLength(100)
    const integrity = await store.verifyIntegrity()
    expect(integrity.valid).toBe(true)
    expect(integrity.checkedCount).toBe(100)
  })

  it('persists modality and aggregates voice usage without content fields', async () => {
    const store = createStore()
    store.enqueue({
      actorRole: 'student',
      actorId: 'learner-demo',
      action: 'view',
      resourceType: 'system',
      resourceId: 'multimodal-ask',
      studentId: 'learner-demo',
      result: 'success',
      modality: 'voice',
      metadata: {
        durationMs: 3200,
        transcriptChars: 18,
        piiHitCount: 0
      }
    })
    store.enqueue({
      actorRole: 'student',
      actorId: 'learner-02',
      action: 'view',
      resourceType: 'system',
      resourceId: 'multimodal-ask',
      studentId: 'learner-02',
      result: 'success',
      modality: 'voice',
      metadata: {
        durationMs: 1500,
        transcriptChars: 9,
        piiHitCount: 1
      }
    })
    store.enqueue({
      actorRole: 'student',
      action: 'evaluate',
      resourceType: 'evaluation',
      studentId: 'learner-demo',
      result: 'success',
      modality: 'text'
    })
    await store.flush()

    const records = await store.query({ limit: 10 })
    const voiceRows = records.filter((row) => row.modality === 'voice')
    expect(voiceRows).toHaveLength(2)
    for (const row of voiceRows) {
      expect(row.metadata).toBeTruthy()
      const metadata = row.metadata
      expect(metadata).not.toBeNull()
      if (metadata === null) {
        throw new Error('expected voice metadata')
      }
      // Counts-only: no free-text keys and no transcript body.
      expect(metadata.transcript).toBeUndefined()
      expect(metadata.text).toBeUndefined()
      expect(metadata.audio).toBeUndefined()
      expect(metadata.audioPath).toBeUndefined()
      expect(JSON.stringify(metadata)).not.toContain('哪里错了')
      expect(metadata.transcriptChars).toEqual(expect.any(Number))
      expect(metadata.piiHitCount).toEqual(expect.any(Number))
    }

    const usage = await store.getMultimodalUsage()
    expect(usage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ studentId: 'learner-demo', voiceCount: 1 }),
        expect.objectContaining({ studentId: 'learner-02', voiceCount: 1 })
      ])
    )
    expect(usage.every((row) => typeof row.lastVoiceAt === 'string')).toBe(true)

    const integrity = await store.verifyIntegrity()
    expect(integrity.valid).toBe(true)
  })

  it('queries by studentId and time range under the teacher p99 budget', async () => {
    const store = createStore({ flushBatchSize: 50 })
    const now = Date.now()

    for (let index = 0; index < 50; index += 1) {
      store.enqueue({
        actorRole: 'student',
        action: 'evaluate',
        resourceType: 'evaluation',
        studentId: index % 2 === 0 ? 'learner-demo' : 'learner-other',
        result: 'success'
      })
    }
    await store.flush()

    // Seed explicit timestamps via a second store is hard; query filters still run
    // against the flushed rows and must stay fast for the demo acceptance bar.
    const started = performance.now()
    const samples: number[] = []
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const queryStart = performance.now()
      const rows = await store.query({
        studentId: 'learner-demo',
        from: new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString(),
        to: new Date(now + 60_000).toISOString()
      })
      samples.push(performance.now() - queryStart)
      expect(rows.length).toBeGreaterThan(0)
      expect(rows.every((row) => row.studentId === 'learner-demo')).toBe(true)
    }
    samples.sort((left, right) => left - right)
    const p99 = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.99))]
    expect(p99).toBeLessThan(20)
    expect(performance.now() - started).toBeLessThan(1_000)
  })
})

describe('resolveAuditHmacSecret (production hardening)', () => {
  it('returns the configured secret when set', () => {
    const secret = resolveAuditHmacSecret({ AUDIT_HMAC_SECRET: 'real-secret' })
    expect(secret).toBe('real-secret')
  })

  it('falls back to the demo secret outside production', () => {
    const secret = resolveAuditHmacSecret({ NODE_ENV: 'development' })
    expect(secret.length).toBeGreaterThan(0)
  })

  it('throws in production when AUDIT_HMAC_SECRET is missing', () => {
    expect(() =>
      resolveAuditHmacSecret({ NODE_ENV: 'production' })
    ).toThrow(/AUDIT_HMAC_SECRET is required in production/)
  })

  it('throws in production when AUDIT_HMAC_SECRET is blank', () => {
    expect(() =>
      resolveAuditHmacSecret({ NODE_ENV: 'production', AUDIT_HMAC_SECRET: '   ' })
    ).toThrow(/AUDIT_HMAC_SECRET is required in production/)
  })
})

describe('tamperForTest (production backdoor guard)', () => {
  const stores: AuditStore[] = []

  afterEach(async () => {
    await Promise.all(stores.splice(0).map((store) => store.close()))
  })

  it('refuses to run when NODE_ENV=production', async () => {
    const previous = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      const store = new AuditStore({
        dbPath: ':memory:',
        hmacSecret: SECRET
      })
      stores.push(store)
      store.enqueue({
        actorRole: 'student',
        action: 'evaluate',
        resourceType: 'evaluation',
        result: 'success'
      })
      await store.flush()
      await expect(store.tamperForTest(1, 'result', 'forged')).rejects.toThrow(
        /test-only helper/
      )
    } finally {
      process.env.NODE_ENV = previous
    }
  })
})
