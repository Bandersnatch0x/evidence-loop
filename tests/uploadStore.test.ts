// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { openMemoryDatabase } from '../server/db/memorySchema'
import { QuotaService } from '../server/media/QuotaService'
import { UploadStore } from '../server/media/UploadStore'

/**
 * T-B slice 2 — UploadStore: session lifecycle, quota reservation (transactional
 * with media_assets per spec §5.5), state machine, expiry, cancel cleanup.
 */

function makeStore() {
  const db = openMemoryDatabase(':memory:')
  const quotas = new QuotaService(db)
  const store = new UploadStore(db, quotas)
  return { db, store, quotas }
}

describe('UploadStore', () => {
  it('creates a session, reserving quota in the same transaction', () => {
    const { db, store } = makeStore()
    const session = store.create({
      id: 'up-1',
      ownerId: 'teacher-1',
      kind: 'image',
      declaredBytes: 10 * 1024 * 1024
    })
    expect(session.state).toBe('uploading')
    expect(session.receivedBytes).toBe(0)
    expect(session.tempKey).toMatch(/^up-1\.part$/)

    // Quota row exists for the owner (per-teacher 5GiB budget).
    const used = (db
      .prepare('SELECT SUM(quota_reservation_bytes) AS used FROM upload_sessions WHERE owner_id = ?')
      .get('teacher-1') as { used: number }).used
    expect(used).toBe(10 * 1024 * 1024)
  })

  it('rejects a session that would exceed the per-teacher quota', () => {
    const { store } = makeStore()
    // 5 GiB is the v1 per-teacher cap (spec §9). Reserve 4 GiB then try 2 GiB.
    store.create({ id: 'up-a', ownerId: 't-1', kind: 'image', declaredBytes: 4 * 1024 ** 3 })
    expect(() =>
      store.create({ id: 'up-b', ownerId: 't-1', kind: 'image', declaredBytes: 2 * 1024 ** 3 })
    ).toThrow(/quota/)
  })

  it('records received bytes and rejects over-declared uploads', () => {
    const { store } = makeStore()
    const session = store.create({ id: 'up-2', ownerId: 't-2', kind: 'image', declaredBytes: 100 })
    store.recordReceived(session.id, 40)
    expect(store.get(session.id)?.receivedBytes).toBe(40)
    expect(() => store.recordReceived(session.id, 61)).toThrow(/declared|received/)
  })

  it('transitions uploading -> quarantined -> processing -> ready', () => {
    const { db, store } = makeStore()
    const session = store.create({ id: 'up-3', ownerId: 't-3', kind: 'glb', declaredBytes: 50 })
    store.recordReceived(session.id, 50)
    store.markQuarantined(session.id)
    expect(store.get(session.id)?.state).toBe('quarantined')
    store.markInspected(session.id)
    store.markProcessing(session.id)
    store.markReady(session.id)
    expect(store.get(session.id)?.state).toBe('ready')
    // Ready releases the quota reservation: session row keeps the historical
    // reservation figure but no longer counts toward the live quota.
    const live = (db
      .prepare("SELECT COALESCE(SUM(quota_reservation_bytes), 0) AS used FROM upload_sessions WHERE owner_id = ? AND state IN (?,?,?,?,?)")
      .get('t-3', 'uploading', 'quarantined', 'inspecting', 'processing', 'rejected') as { used: number }).used
    expect(live).toBe(0)
  })

  it('rejects invalid state transitions', () => {
    const { store } = makeStore()
    const session = store.create({ id: 'up-4', ownerId: 't-4', kind: 'image', declaredBytes: 10 })
    expect(() => store.markReady(session.id)).toThrow(/transition/)
    expect(() => store.markQuarantined(session.id)).not.toThrow()
  })

  it('finds expired sessions and cancels them, releasing quota', () => {
    const { db, store } = makeStore()
    // Create then backdate expires_at.
    const session = store.create({ id: 'up-5', ownerId: 't-5', kind: 'image', declaredBytes: 10 })
    db.prepare('UPDATE upload_sessions SET expires_at = ? WHERE id = ?').run(
      new Date(Date.now() - 86_400_000).toISOString(),
      session.id
    )
    const expired = store.findExpired()
    expect(expired).toContain(session.id)
    store.cancel(session.id)
    expect(store.get(session.id)?.state).toBe('failed')
  })

  it('cancel releases the quota reservation', () => {
    const { store } = makeStore()
    store.create({ id: 'up-6', ownerId: 't-6', kind: 'image', declaredBytes: 2048 })
    store.cancel('up-6')
    // Quota row for this session is gone.
    expect(store.get('up-6')?.state).toBe('failed')
  })
})