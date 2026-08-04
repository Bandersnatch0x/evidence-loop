// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { openMemoryDatabase } from '../server/db/memorySchema'
import {
  DemoNotFoundError,
  DemoOwnershipError,
  DemoSubmitError,
  DemonstrationService
} from '../server/demonstration/DemonstrationService'
import { parseSceneDocument } from '../server/demonstration/sceneDocumentSchema'

const DEFAULT_META = {
  title: '演示',
  description: '演示说明',
  subject: 'physics',
  grade: 'high',
  format: 'scene',
  space: '3d',
  behavior: 'static'
}

const baseDoc = () =>
  parseSceneDocument({
    documentMeta: { sceneFormatVersion: '1.0' },
    geometry3D: [{ id: 'box1', kind: 'box' }],
    timeline: { tracks: [], chapters: [], duration: 5 }
  })

function makeService() {
  const db = openMemoryDatabase(':memory:')
  const audits: Array<Record<string, string>> = []
  const service = new DemonstrationService({
    db,
    audit: (e) => audits.push({ ...e })
  })
  return { db, service, audits }
}

describe('DemonstrationService — lifecycle', () => {
  it('creates a work root with a 1:1 empty draft', () => {
    const { service, db } = makeService()
    const id = service.createDemonstration('t-1', { ...DEFAULT_META, title: '光合作用' })
    const demo = db.prepare('SELECT * FROM teaching_demonstrations WHERE id = ?').get(id) as { owner_id: string } | undefined
    expect(demo?.owner_id).toBe('t-1')
    const draft = db.prepare('SELECT * FROM demonstration_drafts WHERE demonstration_id = ?').get(id) as { id: string } | undefined
    expect(draft).toBeDefined()
  })

  it('rejects saveDraft on another teacher\'s demo', () => {
    const { service } = makeService()
    const id = service.createDemonstration('t-1', DEFAULT_META)
    expect(() => service.saveDraft(id, 't-2', baseDoc())).toThrow(DemoOwnershipError)
  })

  it('saves and reads back a draft', () => {
    const { service } = makeService()
    const id = service.createDemonstration('t-1', DEFAULT_META)
    service.saveDraft(id, 't-1', baseDoc())
    const { document } = service.getDraft(id, 't-1')
    expect(document.geometry3D?.[0]?.kind).toBe('box')
  })

  it('submit freezes a snapshot with status submitted', () => {
    const { service, db } = makeService()
    const id = service.createDemonstration('t-1', DEFAULT_META)
    service.saveDraft(id, 't-1', baseDoc())
    const versionId = service.submit(id, 't-1', {
      classification: 'physics',
      license: 'CC-BY-4.0',
      aiDisclosure: 'none'
    })
    const row = db
      .prepare('SELECT status, classification FROM demonstration_versions WHERE id = ?')
      .get(versionId) as { status: string; classification: string }
    expect(row.status).toBe('submitted')
    expect(row.classification).toBe('physics')
  })

  it('rejects submit without license', () => {
    const { service } = makeService()
    const id = service.createDemonstration('t-1', DEFAULT_META)
    service.saveDraft(id, 't-1', baseDoc())
    expect(() =>
      service.submit(id, 't-1', { classification: 'x', license: '', aiDisclosure: 'none' })
    ).toThrow(DemoSubmitError)
  })

  it('rejects a second pending version while one is submitted', () => {
    const { service } = makeService()
    const id = service.createDemonstration('t-1', DEFAULT_META)
    service.saveDraft(id, 't-1', baseDoc())
    service.submit(id, 't-1', { classification: 'x', license: 'CC-BY-4.0', aiDisclosure: 'none' })
    expect(() =>
      service.submit(id, 't-1', { classification: 'x', license: 'CC-BY-4.0', aiDisclosure: 'none' })
    ).toThrow(/already pending/)
  })

  it('withdraw moves the pending version to withdrawn (then re-submit allowed)', () => {
    const { service } = makeService()
    const id = service.createDemonstration('t-1', DEFAULT_META)
    service.saveDraft(id, 't-1', baseDoc())
    const v1 = service.submit(id, 't-1', { classification: 'x', license: 'CC-BY-4.0', aiDisclosure: 'none' })
    service.withdraw(id, 't-1', v1)
    const v2 = service.submit(id, 't-1', { classification: 'x', license: 'CC-BY-4.0', aiDisclosure: 'none' })
    expect(v2).not.toBe(v1)
  })

  it('rejects submit with a non-ready media ref', () => {
    const { service, db } = makeService()
    const id = service.createDemonstration('t-1', DEFAULT_META)
    db.prepare(
      `INSERT INTO media_assets (id, owner_id, kind, original_blob_hash, status, display_name, created_at)
       VALUES (?, ?, 'image', 'abc', 'processing', 'x', ?)`
    ).run('asset-1', 't-1', new Date().toISOString())
    const doc = parseSceneDocument({
      documentMeta: { sceneFormatVersion: '1.0' },
      mediaRefs: [{ id: 'asset-1', blobHash: 'a'.repeat(64), purpose: 'texture' }]
    })
    service.saveDraft(id, 't-1', doc)
    expect(() =>
      service.submit(id, 't-1', { classification: 'x', license: 'CC-BY-4.0', aiDisclosure: 'none' })
    ).toThrow(/not ready/)
  })

  it('soft delete hides identity via deleted_at', () => {
    const { service, db } = makeService()
    const id = service.createDemonstration('t-1', DEFAULT_META)
    service.softDelete(id, 't-1')
    const row = db.prepare('SELECT deleted_at FROM teaching_demonstrations WHERE id = ?').get(id) as { deleted_at: string | null } | undefined
    expect(row?.deleted_at).toBeTruthy()
  })

  it('emits audit events for create/save/submit', () => {
    const { service, audits } = makeService()
    const id = service.createDemonstration('t-1', DEFAULT_META)
    service.saveDraft(id, 't-1', baseDoc())
    service.submit(id, 't-1', { classification: 'x', license: 'CC-BY-4.0', aiDisclosure: 'none' })
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(['demo.create', 'demo.draft.save', 'demo.submit']))
  })

  it('rejects withdraw of an approved version', () => {
    const { service, db } = makeService()
    const id = service.createDemonstration('t-1', DEFAULT_META)
    service.saveDraft(id, 't-1', baseDoc())
    const v1 = service.submit(id, 't-1', { classification: 'x', license: 'CC-BY-4.0', aiDisclosure: 'none' })
    // Manually approve (DB-level) — service-level approval lives in ReviewService.
    db.prepare(`UPDATE demonstration_versions SET status = 'approved' WHERE id = ?`).run(v1)
    expect(() => service.withdraw(id, 't-1', v1)).toThrow(/only submitted/)
  })

  it('throws DemoNotFoundError for unknown demo', () => {
    const { service } = makeService()
    expect(() => service.saveDraft('missing', 't-1', baseDoc())).toThrow(DemoNotFoundError)
  })
})