// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { openMemoryDatabase } from '../server/db/memorySchema'
import { DemonstrationService } from '../server/demonstration/DemonstrationService'
import { ReviewService } from '../server/demonstration/ReviewService'
import { DerivationError, DerivationService } from '../server/demonstration/DerivationService'
import { assertLicenseAllowed } from '../server/demonstration/licenseInheritance'
import { parseSceneDocument } from '../server/demonstration/sceneDocumentSchema'

const baseDoc = () =>
  parseSceneDocument({
    documentMeta: { sceneFormatVersion: '1.0' },
    geometry3D: [{ id: 'box1', kind: 'box' }]
  })

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
  seedUser(db, 'teacher-2', false)
  const service = new DemonstrationService({ db })
  const review = new ReviewService({ db })
  const derive = new DerivationService({ db })
  return { db, service, review, derive }
}

/** Create + submit + approve a demo version, returns { demoId, versionId }. */
function published(env: ReturnType<typeof makeEnv>, label = 'demo'): { demoId: string; versionId: string } {
  const demoId = env.service.createDemonstration('teacher-1', { title: label })
  env.service.saveDraft(demoId, 'teacher-1', baseDoc())
  const versionId = env.service.submit(demoId, 'teacher-1', {
    classification: 'physics',
    license: 'CC-BY-4.0',
    aiDisclosure: 'none'
  })
  env.review.approve('reviewer-1', versionId)
  return { demoId, versionId }
}

describe('DerivationService — source chain + license inheritance', () => {
  it('derives a new work with permanent source chain', () => {
    const env = makeEnv()
    const src = published(env, 'source')
    const { demoId, source } = env.derive.deriveFrom('teacher-2', src.demoId, src.versionId, {
      title: 'derived'
    })
    expect(source.sourceDemoId).toBe(src.demoId)
    expect(source.sourceVersionId).toBe(src.versionId)
    expect(source.originalAuthorId).toBe('teacher-1')
    expect(env.derive.sourceChain(demoId)).toEqual(source)
  })

  it('refuses deriving from a non-approved version', () => {
    const env = makeEnv()
    const demoId = env.service.createDemonstration('teacher-1')
    env.service.saveDraft(demoId, 'teacher-1', baseDoc())
    const versionId = env.service.submit(demoId, 'teacher-1', {
      classification: 'x',
      license: 'CC-BY-4.0',
      aiDisclosure: 'none'
    })
    // submitted, not approved
    expect(() => env.derive.deriveFrom('teacher-2', demoId, versionId)).toThrow(DerivationError)
  })

  it('refuses version belonging to a different demo', () => {
    const env = makeEnv()
    const a = published(env, 'a')
    const b = published(env, 'b')
    expect(() => env.derive.deriveFrom('teacher-2', b.demoId, a.versionId)).toThrow(/does not belong/)
  })

  it('license inheritance: same or more permissive OK', () => {
    expect(() => assertLicenseAllowed('CC-BY-SA-4.0', 'CC0', false)).not.toThrow()
    expect(() => assertLicenseAllowed('CC-BY-SA-4.0', 'CC-BY-4.0', false)).not.toThrow()
    expect(() => assertLicenseAllowed('CC-BY-NC-SA-4.0', 'CC-BY-NC-4.0', false)).not.toThrow()
  })

  it('license inheritance: stricter rejected unless all source content removed', () => {
    expect(() => assertLicenseAllowed('CC0', 'proprietary', false)).toThrow(/stricter/)
    expect(() => assertLicenseAllowed('CC-BY-4.0', 'CC-BY-NC-4.0', false)).toThrow(/stricter/)
    expect(() => assertLicenseAllowed('CC-BY-NC-4.0', 'CC-BY-NC-SA-4.0', false)).toThrow(/stricter/)
    // Content removed → any license allowed.
    expect(() => assertLicenseAllowed('CC0', 'proprietary', true)).not.toThrow()
  })

  it('attribution exposes original author + source', () => {
    const env = makeEnv()
    const src = published(env, 'source')
    const { demoId } = env.derive.deriveFrom('teacher-2', src.demoId, src.versionId)
    const attr = env.derive.attribution(demoId)
    expect(attr?.originalAuthorId).toBe('teacher-1')
    expect(attr?.sourceVersionId).toBe(src.versionId)
  })

  it('no source chain → attribution null', () => {
    const env = makeEnv()
    const demoId = env.service.createDemonstration('teacher-1')
    expect(env.derive.attribution(demoId)).toBeNull()
  })

  it('submit enforces license inheritance for derived works (no stricter than source)', () => {
    const env = makeEnv()
    const src = published(env, 'source') // CC-BY-4.0
    const { demoId } = env.derive.deriveFrom('teacher-2', src.demoId, src.versionId)
    // Same content kept (baseDoc has no mediaRefs → sourceContentRemoved=true for
    // our simple doc, but the license check still runs when a source exists).
    env.service.saveDraft(demoId, 'teacher-2', baseDoc())
    // CC-BY-NC-4.0 is stricter than CC-BY-4.0 — but derived doc has no source
    // blobs, so content is removed → allowed. Verify the strict path too:
    // craft a doc that keeps a source blob.
    expect(() =>
      env.service.submit(demoId, 'teacher-2', {
        classification: 'x',
        license: 'CC-BY-NC-4.0',
        aiDisclosure: 'none'
      })
    ).not.toThrow()
  })

  it('submit rejects a stricter license when source content is kept', () => {
    const env = makeEnv()
    const H = 'e'.repeat(64)
    // Source version carries a texture blob (CC-BY-4.0).
    const srcDemo = env.service.createDemonstration('teacher-1', { title: 'src' })
    env.db.prepare(
      `INSERT INTO media_assets
         (id, owner_id, kind, original_blob_hash, status, display_name, created_at)
       VALUES (?, ?, 'image', ?, 'ready', 'x', ?)`
    ).run('asset-src', 'teacher-1', H, new Date().toISOString())
    const srcDoc = parseSceneDocument({
      documentMeta: { sceneFormatVersion: '1.0' },
      mediaRefs: [{ id: 'asset-src', assetId: 'asset-src', blobHash: H, purpose: 'texture' }]
    })
    env.service.saveDraft(srcDemo, 'teacher-1', srcDoc)
    const srcVersion = env.service.submit(srcDemo, 'teacher-1', {
      classification: 'x',
      license: 'CC-BY-4.0',
      aiDisclosure: 'none'
    })
    env.review.approve('reviewer-1', srcVersion)
    // Derive and KEEP the source blob → sourceContentRemoved=false.
    const { demoId } = env.derive.deriveFrom('teacher-2', srcDemo, srcVersion)
    const keptDoc = parseSceneDocument({
      documentMeta: { sceneFormatVersion: '1.0' },
      mediaRefs: [{ id: 'asset-src', assetId: 'asset-src', blobHash: H, purpose: 'texture' }]
    })
    env.service.saveDraft(demoId, 'teacher-2', keptDoc)
    expect(() =>
      env.service.submit(demoId, 'teacher-2', {
        classification: 'x',
        license: 'CC-BY-NC-4.0', // stricter than CC-BY-4.0
        aiDisclosure: 'none'
      })
    ).toThrow(/stricter/)
  })

  it('transitive attribution: A→B→C attributes to root author A', () => {
    const env = makeEnv()
    const a = published(env, 'A')
    const b = env.derive.deriveFrom('teacher-2', a.demoId, a.versionId)
    // B submits + approves (its own version), then C derives from B.
    env.service.saveDraft(b.demoId, 'teacher-2', baseDoc())
    const bVersion = env.service.submit(b.demoId, 'teacher-2', {
      classification: 'x',
      license: 'CC-BY-4.0',
      aiDisclosure: 'none'
    })
    env.review.approve('reviewer-1', bVersion)
    const c = env.derive.deriveFrom('teacher-1', b.demoId, bVersion)
    const attr = env.derive.attribution(c.demoId)
    expect(attr?.originalAuthorId).toBe('teacher-1') // root A, not B's owner
  })
})