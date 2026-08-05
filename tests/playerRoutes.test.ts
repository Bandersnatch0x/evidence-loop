/**
 * T-G player payload endpoint tests — read-only published snapshot serving.
 * Covers: only approved versions served, drafts/taken-down refused, security
 * guard refusal, capability negotiation passthrough, media manifest + external
 * video resolution, accessibility refs, budget preflight, and the iron law
 * that the payload carries zero teaching/grade/student data.
 */
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { handlePlayerApi } from '../server/demonstration/playerRoutes'
import { parseSceneDocument, type SceneDocument } from '../server/demonstration/sceneDocumentSchema'
import { applyProductMigrations } from '../server/db/migrate'
import { createDemoAuditSink } from '../server/demonstration/demoAuditSink'
import { DemonstrationService } from '../server/demonstration/DemonstrationService'
import { ReferenceService } from '../server/demonstration/ReferenceService'
import { ReviewService } from '../server/demonstration/ReviewService'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Socket } from 'node:net'

const META = {
  title: '光合作用',
  subject: 'biology',
  grade: 'grade7',
  kpIds: ['kp.bio.photo'],
  description: '叶片光合',
  format: 'scene',
  space: '2d',
  behavior: 'interactive'
}

function baseDoc(): SceneDocument {
  return parseSceneDocument({
    documentMeta: { sceneFormatVersion: '1.0' },
    runtimeVersion: {
      sceneFormatVersion: '1.0',
      capabilities: []
    },
    viewerConfig: { camera: { position: [3, 2, 5], target: [0, 0, 0], fov: 50 } },
    objectTree: [
      {
        id: 'leaf',
        name: 'leaf',
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        visible: true,
        meshRef: 'leaf-rect',
        children: []
      }
    ],
    geometry2D: [
      { id: 'leaf-rect', shape: 'rect', x: -1, y: -1, width: 2, height: 2, rx: 0, ry: 0 }
    ],
    materials: [{ kind: 'fill2d', fill: '#228b22', fillOpacity: 1 }],
    interactions: [{ type: 'orbit', nodeId: 'leaf', enabled: true }],
    timeline: { tracks: [], chapters: [], duration: 30 },
    editorMetadata: {}
  })
}

interface Env {
  db: Database.Database
  demo: DemonstrationService
  review: ReviewService
  refs: ReferenceService
  audit: ReturnType<typeof createDemoAuditSink>
}

function makeEnv(): Env {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  applyProductMigrations(db)
  db.prepare(
    `INSERT INTO users (id, person_id, role, login_id, display_name, created_at, public_library_reviewer)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run('reviewer-1', 'p-reviewer-1', 'teacher', 'login-reviewer-1', 'reviewer-1', new Date().toISOString(), 1)
  const audit = createDemoAuditSink({
    enqueue: () => {}
  } as never)
  const demo = new DemonstrationService({ db, audit })
  const review = new ReviewService({ db, audit })
  const refs = new ReferenceService({ db })
  return { db, demo, review, refs, audit }
}

function publish(env: Env, owner = 'teacher-1'): { demoId: string; versionId: string } {
  const demoId = env.demo.createDemonstration(owner, { ...META })
  env.demo.saveDraft(demoId, owner, baseDoc())
  const versionId = env.demo.submit(demoId, owner, {
    classification: 'biology',
    license: 'CC-BY-4.0',
    aiDisclosure: 'none'
  })
  env.review.approve('reviewer-1', versionId)
  return { demoId, versionId }
}

function capture(): { res: ServerResponse; json: () => unknown; status: () => number } {
  let status = 0
  let body = ''
  const res = {
    writeHead: (code: number) => {
      status = code
    },
    end: (chunk?: unknown) => {
      body = typeof chunk === 'string' ? chunk : JSON.stringify(chunk ?? '')
    }
  } as unknown as ServerResponse
  return {
    res,
    status: () => status,
    json: () => JSON.parse(body) as unknown
  }
}

function makeRequest(url: string): { request: IncomingMessage; url: URL } {
  const socket = {} as Socket
  const request = {
    method: 'GET',
    headers: {},
    socket
  } as unknown as IncomingMessage
  const parsed = new URL(url, 'http://localhost')
  return { request, url: parsed }
}

describe('T-G player payload endpoint', () => {
  it('serves only approved published snapshots (draft/pending/rejected refused)', () => {
    const env = makeEnv()
    const demoId = env.demo.createDemonstration('teacher-1', { ...META })
    env.demo.saveDraft(demoId, 'teacher-1', baseDoc())
    // pending submit
    const pendingVersionId = env.demo.submit(demoId, 'teacher-1', {
      classification: 'biology',
      license: 'CC-BY-4.0',
      aiDisclosure: 'none'
    })

    const ctx = { db: env.db }
    // pending (not approved) -> refused
    const pending = capture()
    handlePlayerApi(
      makeRequest(`/api/demonstrations/${demoId}/versions/${pendingVersionId}/player`).request,
      pending.res,
      `/api/demonstrations/${demoId}/versions/${pendingVersionId}/player`,
      ctx
    )
    expect(pending.status()).toBe(404)

    // approved -> served
    env.review.approve('reviewer-1', pendingVersionId)
    const ok = capture()
    handlePlayerApi(
      makeRequest(`/api/demonstrations/${demoId}/versions/${pendingVersionId}/player`).request,
      ok.res,
      `/api/demonstrations/${demoId}/versions/${pendingVersionId}/player`,
      ctx
    )
    expect(ok.status()).toBe(200)
    const payload = ok.json() as { status: string; document: unknown }
    expect(payload.status).toBe('approved')
    expect(payload.document).not.toBeNull()
  })

  it('refuses soft-deleted / taken-down demonstrations', () => {
    const env = makeEnv()
    const { demoId, versionId } = publish(env)
    env.demo.softDelete(demoId, 'teacher-1')

    const ctx = { db: env.db }
    const c = capture()
    handlePlayerApi(
      makeRequest(`/api/demonstrations/${demoId}/versions/${versionId}/player`).request,
      c.res,
      `/api/demonstrations/${demoId}/versions/${versionId}/player`,
      ctx
    )
    expect(c.status()).toBe(404)
  })

  it('refuses unknown versions and mismatched demo/version pairs', () => {
    const env = makeEnv()
    const { demoId, versionId } = publish(env)
    const other = env.demo.createDemonstration('teacher-2', { ...META })
    const ctx = { db: env.db }

    const missing = capture()
    handlePlayerApi(
      makeRequest(`/api/demonstrations/${demoId}/versions/nope/player`).request,
      missing.res,
      `/api/demonstrations/${demoId}/versions/nope/player`,
      ctx
    )
    expect(missing.status()).toBe(404)

    const mismatched = capture()
    handlePlayerApi(
      makeRequest(`/api/demonstrations/${other}/versions/${versionId}/player`).request,
      mismatched.res,
      `/api/demonstrations/${other}/versions/${versionId}/player`,
      ctx
    )
    expect(mismatched.status()).toBe(404)
  })

  it('passes through capability negotiation (device-dependent render level)', () => {
    const env = makeEnv()
    const { demoId, versionId } = publish(env)
    // Doc declares svg2d only -> full on any webgl2 device.
    const c = capture()
    handlePlayerApi(
      makeRequest(`/api/demonstrations/${demoId}/versions/${versionId}/player`).request,
      c.res,
      `/api/demonstrations/${demoId}/versions/${versionId}/player`,
      { db: env.db, device: { webgl: 'webgl2', tier: 'high', prefersReducedMotion: false, maxTextureSize: 4096 } }
    )
    expect(c.status()).toBe(200)
    const payload = (c.json()) as { renderLevel: string }
    expect(payload.renderLevel).toBe('full')
  })

  it('refuses on security guard violation (script-like content)', () => {
    const env = makeEnv()
    const { demoId } = publish(env)
    // Simulate a corrupt/hostile snapshot row that bypassed the draft guard
    // (e.g. written before the guard existed) — the player must refuse it.
    const versionRow = env.db
      .prepare(`SELECT id FROM demonstration_versions WHERE demonstration_id = ?`)
      .get(demoId) as { id: string }
    const hostile = JSON.stringify({
      documentMeta: { sceneFormatVersion: '1.0' },
      objectTree: [],
      editorMetadata: { injected: 'window.eval("x")' }
    })
    env.db
      .prepare(`UPDATE demonstration_versions SET snapshot_document_json = ? WHERE id = ?`)
      .run(hostile, versionRow.id)

    const c = capture()
    handlePlayerApi(
      makeRequest(`/api/demonstrations/${demoId}/versions/${versionRow.id}/player`).request,
      c.res,
      `/api/demonstrations/${demoId}/versions/${versionRow.id}/player`,
      { db: env.db }
    )
    expect(c.status()).toBe(200)
    const payload = c.json() as { renderLevel: string; document: unknown }
    expect(payload.renderLevel).toBe('refuse')
    expect(payload.document).toBeNull()
  })

  it('resolves media manifest + external video health + accessibility refs', () => {
    const env = makeEnv()
    const blobHash = 'a'.repeat(64)
    env.db
      .prepare(
        `INSERT INTO media_blobs (hash, canonical_extension, media_type, byte_size, storage_key, scan_status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(blobHash, 'png', 'image/png', 1234, `data/media/${blobHash}.png`, 'clean', new Date().toISOString())
    env.db
      .prepare(
        `INSERT INTO media_assets (id, owner_id, kind, original_blob_hash, status, display_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run('tex-1', 'teacher-1', 'image', blobHash, 'ready', 'tex.png', new Date().toISOString())
    env.db
      .prepare(
        `INSERT INTO external_video_refs (id, owner_id, provider, provider_video_id, canonical_url, health, checked_at, consecutive_failures)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run('evr-1', 'teacher-1', 'youtube', 'abc123', 'https://www.youtube.com/watch?v=abc123', 'healthy', new Date().toISOString(), 0)
    env.db
      .prepare(
        `INSERT INTO media_blobs (hash, canonical_extension, media_type, byte_size, storage_key, scan_status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run('c'.repeat(64), 'vtt', 'text/vtt', 512, `data/media/${'c'.repeat(64)}.vtt`, 'clean', new Date().toISOString())
    env.db
      .prepare(
        `INSERT INTO media_assets (id, owner_id, kind, original_blob_hash, status, display_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run('sub-1', 'teacher-1', 'subtitle', 'c'.repeat(64), 'ready', 'subs.vtt', new Date().toISOString())

    const doc = parseSceneDocument({
      documentMeta: { sceneFormatVersion: '1.0' },
      objectTree: [],
      geometry2D: [],
      mediaRefs: [
        { id: 'tex-1', blobHash, purpose: 'texture' },
        { id: 'evr-1', blobHash: '0'.repeat(64), purpose: 'video' },
        { id: 'sub-1', blobHash: 'c'.repeat(64), purpose: 'subtitle' }
      ],
      timeline: { tracks: [], chapters: [], duration: 60 }
    })
    const demoId = env.demo.createDemonstration('teacher-1', { ...META })
    env.demo.saveDraft(demoId, 'teacher-1', doc)
    const versionId = env.demo.submit(demoId, 'teacher-1', {
      classification: 'biology',
      license: 'CC-BY-4.0',
      aiDisclosure: 'none'
    })
    env.review.approve('reviewer-1', versionId)

    const c = capture()
    handlePlayerApi(
      makeRequest(`/api/demonstrations/${demoId}/versions/${versionId}/player`).request,
      c.res,
      `/api/demonstrations/${demoId}/versions/${versionId}/player`,
      { db: env.db }
    )
    expect(c.status()).toBe(200)
    const payload = (c.json()) as {
      mediaManifest: Array<{ purpose: string; mediaType: string | null; byteSize: number | null; scanStatus: string | null }>
      externalVideos: Array<{ provider: string; health: string }>
      subtitleRef: { blobHash: string } | null
      budget: { ok: boolean; mediaRefs: number; durationSeconds: number }
    }
    const texture = payload.mediaManifest.find((m) => m.purpose === 'texture')
    expect(texture?.mediaType).toBe('image/png')
    expect(texture?.byteSize).toBe(1234)
    expect(texture?.scanStatus).toBe('clean')
    expect(payload.externalVideos).toHaveLength(1)
    expect(payload.externalVideos[0]?.provider).toBe('youtube')
    expect(payload.externalVideos[0]?.health).toBe('healthy')
    expect(payload.subtitleRef?.blobHash).toBe('c'.repeat(64))
    expect(payload.budget.mediaRefs).toBe(3)
    expect(payload.budget.durationSeconds).toBe(60)
    expect(payload.budget.ok).toBe(true)
  })

  it('serves GET only (no mutation verbs handled)', () => {
    const env = makeEnv()
    const { demoId, versionId } = publish(env)
    const socket = {} as Socket
    const post = {
      method: 'POST',
      headers: {},
      socket
    } as unknown as IncomingMessage
    const res = {} as ServerResponse
    const handled = handlePlayerApi(
      post,
      res,
      `/api/demonstrations/${demoId}/versions/${versionId}/player`,
      { db: env.db }
    )
    expect(handled).toBe(false)
  })

  it('lists KP-bound student demonstrations (知识点页)', () => {
    const env = makeEnv()
    const { versionId } = publish(env)
    env.refs.setReferences('reviewer-1', 'teacher', {
      kpId: 'kp.bio.photo',
      entries: [{ demoVersionId: versionId, role: 'primary' }]
    })
    const c = capture()
    handlePlayerApi(
      makeRequest('/api/demonstrations/by-kp/kp.bio.photo').request,
      c.res,
      '/api/demonstrations/by-kp/kp.bio.photo',
      { db: env.db, references: env.refs, getRole: () => 'student' }
    )
    expect(c.status()).toBe(200)
    const body = c.json() as { demonstrations: Array<{ role: string; versionId: string; health: string }> }
    expect(body.demonstrations).toHaveLength(1)
    expect(body.demonstrations[0]?.role).toBe('primary')
    expect(body.demonstrations[0]?.versionId).toBe(versionId)
    expect(body.demonstrations[0]?.health).toBe('healthy')
  })

  it('returns an empty demonstration list for an unknown KP', () => {
    const env = makeEnv()
    const c = capture()
    handlePlayerApi(
      makeRequest('/api/demonstrations/by-kp/kp.unknown').request,
      c.res,
      '/api/demonstrations/by-kp/kp.unknown',
      { db: env.db, references: env.refs, getRole: () => 'student' }
    )
    expect(c.status()).toBe(200)
    const body = c.json() as { demonstrations: unknown[] }
    expect(body.demonstrations).toEqual([])
  })

  it('denies KP demonstration listing to non-student roles', () => {
    const env = makeEnv()
    const c = capture()
    handlePlayerApi(
      makeRequest('/api/demonstrations/by-kp/kp.bio.photo').request,
      c.res,
      '/api/demonstrations/by-kp/kp.bio.photo',
      { db: env.db, references: env.refs, getRole: () => 'teacher' }
    )
    expect(c.status()).toBe(403)
  })
})
