// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { openMemoryDatabase } from '../server/db/memorySchema'
import { DemonstrationService } from '../server/demonstration/DemonstrationService'
import { ReviewService } from '../server/demonstration/ReviewService'
import { RetentionService } from '../server/demonstration/RetentionService'
import { parseSceneDocument } from '../server/demonstration/sceneDocumentSchema'

const H1 = 'a'.repeat(64)

function docWithMedia(hash: string, assetId = 'asset-1') {
  return parseSceneDocument({
    documentMeta: { sceneFormatVersion: '1.0' },
    mediaRefs: [{ id: assetId, assetId, blobHash: hash, purpose: 'texture' }]
  })
}

function seedAsset(db: ReturnType<typeof openMemoryDatabase>): void {
  db.prepare(
    `INSERT INTO media_assets
       (id, owner_id, kind, original_blob_hash, status, display_name, created_at)
     VALUES (?, ?, 'image', ?, 'ready', 'x', ?)`
  ).run('asset-1', 'teacher-1', H1, new Date().toISOString())
}

function seedBlob(db: ReturnType<typeof openMemoryDatabase>, hash: string, createdAt: string): void {
  db.prepare(
    `INSERT INTO media_blobs (hash, canonical_extension, media_type, byte_size, storage_key, scan_status, created_at)
     VALUES (?, '.png', 'image/png', 10, ?, 'clean', ?)`
  ).run(hash, `media/${hash}.png`, createdAt)
}

function seedUser(db: ReturnType<typeof openMemoryDatabase>, id: string, reviewer: boolean): void {
  db.prepare(
    `INSERT INTO users (id, person_id, role, login_id, display_name, created_at, public_library_reviewer)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, `p-${id}`, 'teacher', `login-${id}`, id, new Date().toISOString(), reviewer ? 1 : 0)
}

function makeEnv() {
  const db = openMemoryDatabase(':memory:')
  seedUser(db, 'reviewer-1', true)
  seedUser(db, 'teacher-1', false)
  const service = new DemonstrationService({ db })
  const review = new ReviewService({ db })
  const retention = new RetentionService({ db, policy: { blobRetentionMs: 1000, tempTtlMs: 1000 } })
  return { db, service, review, retention }
}

describe('RetentionService — blob retention & reclaim', () => {
  it('draft-referenced blob is retained', () => {
    const env = makeEnv()
    const demo = env.service.createDemonstration('teacher-1')
    env.service.saveDraft(demo, 'teacher-1', docWithMedia(H1))
    expect(env.retention.isRetained(H1)).toBe(true)
  })

  it('version-referenced blob is retained (even after approval)', () => {
    const env = makeEnv()
    seedAsset(env.db)
    const demo = env.service.createDemonstration('teacher-1')
    env.service.saveDraft(demo, 'teacher-1', docWithMedia(H1))
    const v = env.service.submit(demo, 'teacher-1', {
      classification: 'x',
      license: 'CC-BY-4.0',
      aiDisclosure: 'none'
    })
    env.review.approve('reviewer-1', v)
    expect(env.retention.isRetained(H1)).toBe(true)
  })

  it('snapshot keeps blob retained after soft-delete (fixed refs keep playing)', () => {
    const env = makeEnv()
    seedAsset(env.db)
    const demo = env.service.createDemonstration('teacher-1')
    env.service.saveDraft(demo, 'teacher-1', docWithMedia(H1))
    env.service.submit(demo, 'teacher-1', {
      classification: 'x',
      license: 'CC-BY-4.0',
      aiDisclosure: 'none'
    })
    env.service.softDelete(demo, 'teacher-1')
    expect(env.retention.isRetained(H1)).toBe(true)
  })

  it('unreferenced blob past retention is reclaimable', () => {
    const env = makeEnv()
    const old = new Date(Date.now() - 5000).toISOString()
    seedBlob(env.db, H1, old)
    const reclaimable = env.retention.reclaimableBlobHashes()
    expect(reclaimable).toContain(H1)
  })

  it('fresh unreferenced blob is NOT reclaimable yet', () => {
    const env = makeEnv()
    seedBlob(env.db, H1, new Date().toISOString())
    expect(env.retention.reclaimableBlobHashes()).not.toContain(H1)
  })

  it('referenced blob is never reclaimable even when old', () => {
    const env = makeEnv()
    const old = new Date(Date.now() - 5000).toISOString()
    seedBlob(env.db, H1, old)
    const demo = env.service.createDemonstration('teacher-1')
    env.service.saveDraft(demo, 'teacher-1', docWithMedia(H1))
    expect(env.retention.reclaimableBlobHashes()).not.toContain(H1)
  })

  it('expired upload sessions are surfaced with shorter TTL', () => {
    const env = makeEnv()
    const now = new Date().toISOString()
    env.db.prepare(
      `INSERT INTO upload_sessions
         (id, owner_id, intended_kind, declared_bytes, received_bytes, temp_key, state,
          quota_reservation_bytes, expires_at, created_at)
       VALUES (?, ?, 'image', 10, 0, 'tmp/x', 'uploading', 10, ?, ?)`
    ).run('up-1', 'teacher-1', now, now)
    // Session was created 5s ago with default 24h expiry — NOT expired by TTL.
    const expired = env.retention.expiredUploadSessions()
    expect(expired).toEqual([])
  })

  it('expired session with past expiry is surfaced', () => {
    const env = makeEnv()
    const old = new Date(Date.now() - 5000).toISOString()
    env.db.prepare(
      `INSERT INTO upload_sessions
         (id, owner_id, intended_kind, declared_bytes, received_bytes, temp_key, state,
          quota_reservation_bytes, expires_at, created_at)
       VALUES (?, ?, 'image', 10, 0, 'tmp/x', 'uploading', 10, ?, ?)`
    ).run('up-2', 'teacher-1', old, old)
    const expired = env.retention.expiredUploadSessions()
    expect(expired.some((s) => s.id === 'up-2')).toBe(true)
  })

  it('asset-linked blob is retained even when not in any doc (asset row survives)', () => {
    const env = makeEnv()
    const old = new Date(Date.now() - 5000).toISOString()
    seedBlob(env.db, H1, old) // old, unreferenced by any doc
    env.db.prepare(
      `INSERT INTO media_assets
         (id, owner_id, kind, original_blob_hash, status, display_name, created_at)
       VALUES (?, ?, 'image', ?, 'ready', 'x', ?)`
    ).run('asset-orphan', 'teacher-1', H1, old)
    // The asset row references the blob → retained, never reclaimable.
    expect(env.retention.isRetained(H1)).toBe(true)
    expect(env.retention.reclaimableBlobHashes()).not.toContain(H1)
  })

  it('withdrawn-version blob is retained (snapshot survives all statuses)', () => {
    const env = makeEnv()
    seedAsset(env.db)
    const demo = env.service.createDemonstration('teacher-1')
    env.service.saveDraft(demo, 'teacher-1', docWithMedia(H1))
    const v = env.service.submit(demo, 'teacher-1', {
      classification: 'x',
      license: 'CC-BY-4.0',
      aiDisclosure: 'none'
    })
    env.service.withdraw(demo, 'teacher-1', v)
    expect(env.retention.isRetained(H1)).toBe(true)
  })
})