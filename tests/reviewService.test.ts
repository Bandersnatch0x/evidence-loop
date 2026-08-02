// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { openMemoryDatabase } from '../server/db/memorySchema'
import { DemonstrationService } from '../server/demonstration/DemonstrationService'
import {
  ReviewerNotAuthorizedError,
  ReviewService,
  ReviewStateError
} from '../server/demonstration/ReviewService'
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
  const service = new DemonstrationService({ db })
  const review = new ReviewService({ db })
  return { db, service, review }
}

function submitDemo(env: ReturnType<typeof makeEnv>, demoId: string): string {
  env.service.saveDraft(demoId, 'teacher-1', baseDoc())
  return env.service.submit(demoId, 'teacher-1', {
    classification: 'physics',
    license: 'CC-BY-4.0',
    aiDisclosure: 'none'
  })
}

describe('ReviewService — review state machine', () => {
  it('reviewer sees submitted versions in the queue', () => {
    const env = makeEnv()
    const demo = env.service.createDemonstration('teacher-1', DEFAULT_META)
    submitDemo(env, demo)
    const q = env.review.queue()
    expect(q.length).toBe(1)
    expect(q[0]?.demonstrationId).toBe(demo)
  })

  it('non-reviewer is refused', () => {
    const env = makeEnv()
    const demo = env.service.createDemonstration('teacher-1', DEFAULT_META)
    const v = submitDemo(env, demo)
    expect(() => env.review.approve('teacher-1', v)).toThrow(ReviewerNotAuthorizedError)
  })

  it('approve moves submitted → approved and becomes current published', () => {
    const env = makeEnv()
    const demo = env.service.createDemonstration('teacher-1', DEFAULT_META)
    const v = submitDemo(env, demo)
    env.review.approve('reviewer-1', v)
    const row = env.db.prepare('SELECT status FROM demonstration_versions WHERE id = ?').get(v) as { status: string } | undefined
    expect(row?.status).toBe('approved')
    expect(env.review.currentPublishedVersion(demo)?.id).toBe(v)
  })

  it('approval changes status ONLY — snapshot content untouched', () => {
    const env = makeEnv()
    const demo = env.service.createDemonstration('teacher-1', DEFAULT_META)
    const v = submitDemo(env, demo)
    const before = env.db.prepare('SELECT snapshot_document_json FROM demonstration_versions WHERE id = ?').get(v) as { snapshot_document_json: string } | undefined
    env.review.approve('reviewer-1', v)
    const after = env.db.prepare('SELECT snapshot_document_json FROM demonstration_versions WHERE id = ?').get(v) as { snapshot_document_json: string } | undefined
    expect(after?.snapshot_document_json).toBe(before?.snapshot_document_json)
  })

  it('reject moves submitted → rejected with reason; draft stays editable', () => {
    const env = makeEnv()
    const demo = env.service.createDemonstration('teacher-1', DEFAULT_META)
    const v = submitDemo(env, demo)
    env.review.reject('reviewer-1', v, '版权信息缺失')
    const row = env.db.prepare('SELECT status, reviewer_note FROM demonstration_versions WHERE id = ?').get(v) as { status: string; reviewer_note: string | null } | undefined
    expect(row?.status).toBe('rejected')
    expect(row?.reviewer_note).toBe('版权信息缺失')
    // Draft still editable → new round = new version.
    const v2 = submitDemo(env, demo)
    expect(v2).not.toBe(v)
  })

  it('rejects approving a non-submitted version', () => {
    const env = makeEnv()
    const demo = env.service.createDemonstration('teacher-1', DEFAULT_META)
    const v = submitDemo(env, demo)
    env.review.approve('reviewer-1', v)
    expect(() => env.review.approve('reviewer-1', v)).toThrow(ReviewStateError)
  })

  it('newer approved version becomes current; older stays approved (fixed refs keep playing)', () => {
    const env = makeEnv()
    const demo = env.service.createDemonstration('teacher-1', DEFAULT_META)
    const v1 = submitDemo(env, demo)
    env.review.approve('reviewer-1', v1)
    // Teacher edits + submits again → v2.
    env.service.saveDraft(demo, 'teacher-1', baseDoc())
    const v2 = submitDemo(env, demo)
    env.review.approve('reviewer-1', v2)
    expect(env.review.currentPublishedVersion(demo)?.id).toBe(v2)
    const v1row = env.db.prepare('SELECT status FROM demonstration_versions WHERE id = ?').get(v1) as { status: string } | undefined
    expect(v1row?.status).toBe('approved') // old version still approved for fixed refs
  })

  it('a reviewer cannot approve their own work', () => {
    const env = makeEnv()
    // reviewer-1 is BOTH a reviewer and the author of a demo.
    const demo = env.service.createDemonstration('reviewer-1', DEFAULT_META)
    env.service.saveDraft(demo, 'reviewer-1', baseDoc())
    const v = env.service.submit(demo, 'reviewer-1', {
      classification: 'x',
      license: 'CC-BY-4.0',
      aiDisclosure: 'none'
    })
    expect(() => env.review.approve('reviewer-1', v)).toThrow(/cannot approve their own/)
  })

  it('queue excludes versions of soft-deleted demonstrations', () => {
    const env = makeEnv()
    const demo = env.service.createDemonstration('teacher-1', DEFAULT_META)
    submitDemo(env, demo)
    env.service.softDelete(demo, 'teacher-1')
    expect(env.review.queue().length).toBe(0)
  })

  it('reviewer forced takedown hides the demo identity', () => {
    const env = makeEnv()
    const demo = env.service.createDemonstration('teacher-1', DEFAULT_META)
    submitDemo(env, demo)
    env.review.takedown('reviewer-1', demo, '版权侵权')
    const row = env.db.prepare('SELECT deleted_at FROM teaching_demonstrations WHERE id = ?').get(demo) as { deleted_at: string | null } | undefined
    expect(row?.deleted_at).toBeTruthy()
  })

  it('author takedown hides the demo identity', () => {
    const env = makeEnv()
    const demo = env.service.createDemonstration('teacher-1', DEFAULT_META)
    env.service.takedown(demo, 'teacher-1')
    const row = env.db.prepare('SELECT deleted_at FROM teaching_demonstrations WHERE id = ?').get(demo) as { deleted_at: string | null } | undefined
    expect(row?.deleted_at).toBeTruthy()
  })
})