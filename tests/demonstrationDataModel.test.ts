// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  migrateMemorySchema,
  openMemoryDatabase
} from '../server/db/memorySchema'

/**
 * T-A slice 1 — migration 0008: demonstration module table family.
 * Spec §3 (ticket 14 shape + ticket 03/12 media & reference tables).
 * Tests the migration seam: tables exist, idempotent, CHECK + unique
 * constraints enforced at the DB layer.
 */

const DEMO_TABLES = [
  'teaching_demonstrations',
  'demonstration_drafts',
  'demonstration_versions',
  'media_assets',
  'media_blobs',
  'media_derivatives',
  'upload_sessions',
  'media_jobs',
  'external_video_refs',
  'demonstration_references'
]

describe('T-A migration 0008 (demonstration module)', () => {
  it('creates all demonstration tables', () => {
    const db = openMemoryDatabase(':memory:')
    for (const table of DEMO_TABLES) {
      const row = db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
        )
        .get(table) as { name: string } | undefined
      expect(row?.name, table).toBe(table)
    }
    db.close()
  })

  it('is idempotent and preserves rows across re-runs', () => {
    const db = openMemoryDatabase(':memory:')
    db.prepare(
      `INSERT INTO teaching_demonstrations (id, owner_id, meta_json) VALUES (?, ?, ?)`
    ).run('demo-1', 'user-1', '{}')

    // Re-run migrations (schema_migrations skips applied files).
    migrateMemorySchema(db)

    const count = db
      .prepare(`SELECT COUNT(*) AS c FROM teaching_demonstrations`)
      .get() as { c: number }
    expect(count.c).toBe(1)
    db.close()
  })

  it('enforces references exactly-one of question/kp (CHECK)', () => {
    const db = openMemoryDatabase(':memory:')
    // Both null must fail.
    expect(() =>
      db
        .prepare(
          `INSERT INTO demonstration_references
             (id, question_id, kp_id, demo_version_id, role, ord)
           VALUES (?, NULL, NULL, ?, ?, ?)`
        )
        .run('ref-both-null', 'ver-1', 'primary', 0)
    ).toThrow()
    // Both set must fail.
    expect(() =>
      db
        .prepare(
          `INSERT INTO demonstration_references
             (id, question_id, kp_id, demo_version_id, role, ord)
           VALUES (?, 'q-1', 'kp-1', ?, ?, ?)`
        )
        .run('ref-both-set', 'ver-1', 'primary', 0)
    ).toThrow()
    // Exactly one must succeed.
    expect(() =>
      db
        .prepare(
          `INSERT INTO demonstration_references
             (id, question_id, kp_id, demo_version_id, role, ord)
           VALUES (?, 'q-1', NULL, ?, ?, ?)`
        )
        .run('ref-q-only', 'ver-1', 'primary', 0)
    ).not.toThrow()
    db.close()
  })

  it('enforces version status / session state / video health CHECKs', () => {
    const db = openMemoryDatabase(':memory:')
    expect(() =>
      db
        .prepare(
          `INSERT INTO demonstration_versions
             (id, demonstration_id, status, snapshot_document_json, classification,
              license, ai_disclosure, media_manifest_json, frozen_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          'ver-bad',
          'demo-1',
          'bogus',
          '{}',
          '{}',
          'cc-by',
          '{}',
          '[]',
          '2026-07-31T00:00:00.000Z'
        )
    ).toThrow()
    expect(() =>
      db
        .prepare(
          `INSERT INTO upload_sessions
             (id, owner_id, intended_kind, declared_bytes, received_bytes, temp_key,
              state, quota_reservation_bytes, expires_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          'up-bad',
          'user-1',
          'image',
          100,
          0,
          't-1',
          'bogus',
          100,
          '2026-08-01T00:00:00.000Z',
          '2026-07-31T00:00:00.000Z'
        )
    ).toThrow()
    expect(() =>
      db
        .prepare(
          `INSERT INTO external_video_refs
             (id, owner_id, provider, provider_video_id, canonical_url, health)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run('vid-bad', 'user-1', 'youtube', 'vid-1', 'https://youtu.be/x', 'nope')
    ).toThrow()
    db.close()
  })

  it('enforces draft one-to-one UNIQUE and derivative idempotent UNIQUE', () => {
    const db = openMemoryDatabase(':memory:')
    const insertDraft = db.prepare(
      `INSERT INTO demonstration_drafts
         (id, demonstration_id, document_json, updated_at)
       VALUES (?, ?, ?, ?)`
    )
    insertDraft.run('d-1', 'demo-1', '{}', '2026-07-31T00:00:00.000Z')
    expect(() =>
      insertDraft.run('d-2', 'demo-1', '{}', '2026-07-31T00:00:00.000Z')
    ).toThrow()

    const insertDerivative = db.prepare(
      `INSERT INTO media_derivatives
         (id, asset_id, role, blob_hash, source_blob_hash, recipe_name, recipe_version)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    insertDerivative.run(
      'md-1',
      'asset-1',
      'display',
      'h-1',
      'src-1',
      'resize',
      'v1'
    )
    expect(() =>
      insertDerivative.run(
        'md-2',
        'asset-1',
        'display',
        'h-2',
        'src-1',
        'resize',
        'v1'
      )
    ).toThrow()
    db.close()
  })

  it('enforces references primary-at-most-one and ord uniqueness per owner', () => {
    const db = openMemoryDatabase(':memory:')
    const insertRef = db.prepare(
      `INSERT INTO demonstration_references
         (id, question_id, kp_id, demo_version_id, role, ord)
       VALUES (?, ?, NULL, ?, ?, ?)`
    )
    insertRef.run('ref-1', 'q-1', 'ver-1', 'primary', 0)
    // Second primary on the same question must fail (partial unique).
    expect(() =>
      insertRef.run('ref-2', 'q-1', 'ver-2', 'primary', 1)
    ).toThrow()
    // Same ord on the same question must fail.
    expect(() =>
      insertRef.run('ref-3', 'q-1', 'ver-2', 'supplementary', 0)
    ).toThrow()
    // Supplementary with new ord succeeds.
    expect(() =>
      insertRef.run('ref-4', 'q-1', 'ver-2', 'supplementary', 1)
    ).not.toThrow()
    db.close()
  })

  it('enforces kp-side primary-at-most-one and ord uniqueness', () => {
    const db = openMemoryDatabase(':memory:')
    const insertKpRef = db.prepare(
      `INSERT INTO demonstration_references
         (id, question_id, kp_id, demo_version_id, role, ord)
       VALUES (?, NULL, ?, ?, ?, ?)`
    )
    insertKpRef.run('kref-1', 'kp-1', 'ver-1', 'primary', 0)
    // Second primary on the same kp must fail (partial unique).
    expect(() =>
      insertKpRef.run('kref-2', 'kp-1', 'ver-2', 'primary', 1)
    ).toThrow()
    // Same ord on the same kp must fail.
    expect(() =>
      insertKpRef.run('kref-3', 'kp-1', 'ver-2', 'supplementary', 0)
    ).toThrow()
    // kp-only reference passes the exactly-one CHECK.
    expect(() =>
      insertKpRef.run('kref-4', 'kp-1', 'ver-2', 'supplementary', 1)
    ).not.toThrow()
    db.close()
  })

  it('adds public_library_reviewer flag column to users', () => {
    const db = openMemoryDatabase(':memory:')
    const columns = db
      .prepare(`PRAGMA table_info(users)`)
      .all() as Array<{ name: string }>
    expect(columns.some((c) => c.name === 'public_library_reviewer')).toBe(true)
    db.close()
  })
})
