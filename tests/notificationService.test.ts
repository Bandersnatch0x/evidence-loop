// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { openMemoryDatabase } from '../server/db/memorySchema'
import { DemonstrationService } from '../server/demonstration/DemonstrationService'
import { ReviewService } from '../server/demonstration/ReviewService'
import { ReferenceService } from '../server/demonstration/ReferenceService'
import { NotificationService } from '../server/demonstration/NotificationService'
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

function seedQuestion(db: ReturnType<typeof openMemoryDatabase>, id: string, authorId: string): void {
  db.prepare(
    `INSERT INTO questions
       (id, question_bank_id, author_id, subject, question_type, stem, payload_json, kp_ids, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, 'qb-1', authorId, 'physics', 'mcq', 'stem', '{}', '[]', new Date().toISOString())
}

function makeEnv() {
  const db = openMemoryDatabase(':memory:')
  seedUser(db, 'reviewer-1', true)
  seedUser(db, 'teacher-1', false)
  seedUser(db, 'teacher-2', false)
  seedQuestion(db, 'q-1', 'teacher-1')
  seedQuestion(db, 'q-2', 'teacher-2')
  const service = new DemonstrationService({ db })
  const review = new ReviewService({ db })
  const refs = new ReferenceService({ db })
  const notify = new NotificationService({ db })
  return { db, service, review, refs, notify }
}

function published(env: ReturnType<typeof makeEnv>, label = 'demo'): { demoId: string; versionId: string } {
  const demoId = env.service.createDemonstration('teacher-1', { ...DEFAULT_META, title: label })
  env.service.saveDraft(demoId, 'teacher-1', baseDoc())
  const versionId = env.service.submit(demoId, 'teacher-1', {
    classification: 'physics',
    license: 'CC-BY-4.0',
    aiDisclosure: 'none'
  })
  env.review.approve('reviewer-1', versionId)
  return { demoId, versionId }
}

describe('NotificationService — event triggers', () => {
  it('new_version notifies referencing teachers by question', () => {
    const env = makeEnv()
    const src = published(env, 'source')
    env.refs.setReferences('teacher-1', 'teacher', {
      questionId: 'q-1',
      entries: [{ demoVersionId: src.versionId, role: 'primary' }]
    })
    const notifications = env.notify.onNewVersion(src.versionId, 'new-version-1')
    expect(notifications.length).toBe(1)
    expect(notifications[0]?.kind).toBe('new_version')
    expect(notifications[0]?.recipientId).toBe('teacher-1')
    expect(notifications[0]?.detail.newVersionId).toBe('new-version-1')
  })

  it('new_version notifies every referencing teacher, not just owners', () => {
    const env = makeEnv()
    const src = published(env, 'source')
    env.refs.setReferences('teacher-1', 'teacher', {
      questionId: 'q-1',
      entries: [{ demoVersionId: src.versionId, role: 'primary' }]
    })
    env.refs.setReferences('teacher-2', 'teacher', {
      questionId: 'q-2',
      entries: [{ demoVersionId: src.versionId, role: 'primary' }]
    })
    const notifications = env.notify.onNewVersion(src.versionId, 'v2')
    expect(notifications.length).toBe(2)
    expect(new Set(notifications.map((n) => n.recipientId))).toEqual(new Set(['teacher-1', 'teacher-2']))
  })

  it('source_unavailable notifies all referencing teachers of all versions', () => {
    const env = makeEnv()
    const src = published(env, 'source')
    env.refs.setReferences('teacher-1', 'teacher', {
      questionId: 'q-1',
      entries: [{ demoVersionId: src.versionId, role: 'primary' }]
    })
    const notifications = env.notify.onSourceUnavailable(src.demoId)
    expect(notifications.length).toBe(1)
    expect(notifications[0]?.kind).toBe('source_unavailable')
    expect(notifications[0]?.detail.sourceDemoId).toBe(src.demoId)
  })

  it('forced_takedown carries reason + replace deadline', () => {
    const env = makeEnv()
    const src = published(env, 'source')
    env.refs.setReferences('teacher-1', 'teacher', {
      questionId: 'q-1',
      entries: [{ demoVersionId: src.versionId, role: 'primary' }]
    })
    const notifications = env.notify.onForcedTakedown(src.demoId, '版权侵权', '2026-08-15')
    expect(notifications[0]?.kind).toBe('forced_takedown')
    expect(notifications[0]?.detail.reason).toBe('版权侵权')
    expect(notifications[0]?.detail.replaceDeadline).toBe('2026-08-15')
  })

  it('no references → no notifications', () => {
    const env = makeEnv()
    const src = published(env, 'source')
    expect(env.notify.onNewVersion(src.versionId, 'v2')).toEqual([])
    expect(env.notify.onSourceUnavailable(src.demoId)).toEqual([])
  })
})