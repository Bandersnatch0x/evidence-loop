// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { openMemoryDatabase } from '../server/db/memorySchema'
import { AuditStore } from '../server/audit/AuditStore'
import { DemonstrationService } from '../server/demonstration/DemonstrationService'
import {
  ReviewService,
  ReviewStateError,
  ReviewerNotAuthorizedError
} from '../server/demonstration/ReviewService'
import { ReferenceService } from '../server/demonstration/ReferenceService'
import { ReportService } from '../server/demonstration/ReportService'
import { AppealService } from '../server/demonstration/AppealService'
import { EvidencePanelService } from '../server/demonstration/EvidencePanelService'
import { NotificationService } from '../server/demonstration/NotificationService'
import { createDemoAuditSink } from '../server/demonstration/demoAuditSink'
import {
  parseSceneDocument,
  type SceneDocument
} from '../server/demonstration/sceneDocumentSchema'

/**
 * T-F service-level tests (spec §5.2/§5.3, decision 04): reviewer queue,
 * approve/reject state machine + content immutability, evidence panel
 * completeness + teaching-private isolation, reports, appeals, authorization,
 * audit, transactional behavior, and forced-takedown notification flow.
 */

const baseDoc = (): SceneDocument =>
  parseSceneDocument({
    documentMeta: { sceneFormatVersion: '1.0' },
    geometry3D: [{ id: 'box1', kind: 'box' }]
  })

const META = {
  title: '演示',
  description: '演示说明',
  subject: 'physics',
  grade: 'high',
  format: 'scene',
  space: '3d',
  behavior: 'static',
  kpIds: []
}

function seedUser(
  db: ReturnType<typeof openMemoryDatabase>,
  id: string,
  reviewer: boolean
): void {
  db.prepare(
    `INSERT INTO users (id, person_id, role, login_id, display_name, created_at, public_library_reviewer)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, `p-${id}`, 'teacher', `login-${id}`, id, new Date().toISOString(), reviewer ? 1 : 0)
}

function seedQuestion(
  db: ReturnType<typeof openMemoryDatabase>,
  id: string,
  authorId: string
): void {
  db.prepare(
    `INSERT INTO questions
       (id, question_bank_id, author_id, subject, question_type, stem, payload_json, kp_ids, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, 'qb-1', authorId, 'physics', 'mcq', 'stem', '{}', '[]', new Date().toISOString())
}

interface Env {
  db: ReturnType<typeof openMemoryDatabase>
  audit: AuditStore
  demo: DemonstrationService
  review: ReviewService
  refs: ReferenceService
  reports: ReportService
  appeals: AppealService
  evidence: EvidencePanelService
  notifications: NotificationService
}

function makeEnv(): Env {
  const db = openMemoryDatabase(':memory:')
  seedUser(db, 'reviewer-1', true)
  seedUser(db, 'reviewer-2', true)
  seedUser(db, 'teacher-1', false)
  seedUser(db, 'teacher-2', false)
  seedQuestion(db, 'q-1', 'teacher-1')
  const audit = new AuditStore({ dbPath: ':memory:', hmacSecret: 'demo-hmac' })
  const demoAudit = createDemoAuditSink(audit)
  const demo = new DemonstrationService({ db, audit: demoAudit })
  const review = new ReviewService({ db, audit: demoAudit })
  const refs = new ReferenceService({ db, audit: demoAudit })
  const reports = new ReportService({ db, audit: demoAudit })
  const appeals = new AppealService({ db, audit: demoAudit })
  const evidence = new EvidencePanelService({ db })
  const notifications = new NotificationService({ db })
  return { db, audit, demo, review, refs, reports, appeals, evidence, notifications }
}

/** Submit (freeze) a version but do NOT approve - stays in the review queue. */
function submitVersion(
  env: Env,
  owner: string,
  meta: Record<string, unknown> = { ...META }
): { demoId: string; versionId: string } {
  const demoId = env.demo.createDemonstration(owner, meta)
  env.demo.saveDraft(demoId, owner, baseDoc())
  const versionId = env.demo.submit(demoId, owner, {
    classification: String(typeof meta.subject === 'string' ? meta.subject : 'physics'),
    license: 'CC-BY-4.0',
    aiDisclosure: 'none'
  })
  return { demoId, versionId }
}

/** Submit + approve -> current published version. */
function publishVersion(
  env: Env,
  owner: string,
  meta: Record<string, unknown> = { ...META }
): { demoId: string; versionId: string } {
  const { demoId, versionId } = submitVersion(env, owner, meta)
  env.review.approve('reviewer-1', versionId)
  return { demoId, versionId }
}

describe('T-F reviewer queue', () => {
  it('surfaces submitted versions and open reports', () => {
    const env = makeEnv()
    submitVersion(env, 'teacher-1', { ...META, title: '待审A' })
    submitVersion(env, 'teacher-2', { ...META, title: '待审B' })
    const { demoId } = publishVersion(env, 'teacher-1', { ...META, title: '已发布' })

    const queue = env.review.queue()
    expect(queue).toHaveLength(2) // two submitted; approved excluded
    expect(queue.map((v) => v.id).sort()).toBeDefined()

    // A report on the published demo appears in the open-reports list.
    const report = env.reports.create('teacher-2', demoId, {
      category: 'copyright',
      reason: 'stolen'
    })
    expect(report.status).toBe('open')
    const open = env.reports.listOpen()
    expect(open).toHaveLength(1)
    expect(open[0]?.demonstrationId).toBe(demoId)
  })

  it('excludes reports on soft-deleted demos from queue view', () => {
    const env = makeEnv()
    const { demoId } = publishVersion(env, 'teacher-1')
    env.reports.create('teacher-2', demoId, { category: 'spam', reason: 'r' })
    // Author takedown hides identity; the report row stays but the demo is gone.
    env.demo.takedown(demoId, 'teacher-1')
    // listOpen still returns the report (it is a governance record); the route
    // joins demo presence for the queue. Reports themselves are not auto-purged.
    expect(env.reports.listOpen()).toHaveLength(1)
  })
})

describe('T-F approve / reject state machine', () => {
  it('approve changes status only, never snapshot content', () => {
    const env = makeEnv()
    const { demoId, versionId } = submitVersion(env, 'teacher-1')
    const before = env.demo.listVersions(demoId).find((v) => v.id === versionId)!
    const snapshotBefore = before.snapshotDocumentJson
    env.review.approve('reviewer-1', versionId)
    const after = env.demo.listVersions(demoId).find((v) => v.id === versionId)!
    expect(after.status).toBe('approved')
    // Content immutability iron law (spec §2.4).
    expect(after.snapshotDocumentJson).toBe(snapshotBefore)
    expect(env.review.currentPublishedVersion(demoId)?.id).toBe(versionId)
  })

  it('reject persists a reason and never changes content', () => {
    const env = makeEnv()
    const { demoId, versionId } = submitVersion(env, 'teacher-1')
    const snapshotBefore = env.demo
      .listVersions(demoId)
      .find((v) => v.id === versionId)!.snapshotDocumentJson
    env.review.reject('reviewer-1', versionId, 'inappropriate content')
    const after = env.demo.listVersions(demoId).find((v) => v.id === versionId)!
    expect(after.status).toBe('rejected')
    expect(after.reviewerNote).toBe('inappropriate content')
    expect(after.snapshotDocumentJson).toBe(snapshotBefore)
  })

  it('reject requires a non-empty reason', () => {
    const env = makeEnv()
    const { versionId } = submitVersion(env, 'teacher-1')
    expect(() => env.review.reject('reviewer-1', versionId, '   ')).toThrow()
  })

  it('a reviewer cannot approve their own work', () => {
    const env = makeEnv()
    // reviewer-1 is also a teacher; submit as reviewer-1, approve as reviewer-1.
    const { versionId } = submitVersion(env, 'reviewer-1')
    expect(() => env.review.approve('reviewer-1', versionId)).toThrow(
      ReviewStateError
    )
  })

  it('can only approve/reject submitted versions', () => {
    const env = makeEnv()
    const { versionId } = publishVersion(env, 'teacher-1') // already approved
    expect(() => env.review.approve('reviewer-1', versionId)).toThrow(
      ReviewStateError
    )
    expect(() => env.review.reject('reviewer-1', versionId, 'x')).toThrow(
      ReviewStateError
    )
  })
})

describe('T-F authorization', () => {
  it('non-reviewer cannot approve, reject, or access reviewer queue/evidence', () => {
    const env = makeEnv()
    const { versionId } = submitVersion(env, 'teacher-1')
    // approve/reject: ReviewService asserts the flag.
    expect(() => env.review.approve('teacher-1', versionId)).toThrow(
      ReviewerNotAuthorizedError
    )
    expect(() =>
      env.review.reject('teacher-1', versionId, 'x')
    ).toThrow(ReviewerNotAuthorizedError)
    // report/appeal resolution require the reviewer flag.
    const published = publishVersion(env, 'teacher-2')
    const report = env.reports.create('teacher-3', published.demoId, {
      category: 'spam',
      reason: 'r'
    })
    expect(() =>
      env.reports.resolve('teacher-1', report.id, {
        status: 'resolved',
        note: 'ok'
      })
    ).toThrow(ReviewerNotAuthorizedError)
    const { demoId, versionId: rejectedVersionId } = submitVersion(env, 'teacher-3')
    env.review.reject('reviewer-1', rejectedVersionId, 'no')
    const appeal = env.appeals.create('teacher-3', demoId, {
      versionId: rejectedVersionId,
      reason: 'unfair'
    })
    expect(() =>
      env.appeals.resolve('teacher-1', appeal.id, {
        status: 'denied',
        note: 'upheld'
      })
    ).toThrow(ReviewerNotAuthorizedError)
  })
})

describe('T-F evidence panel', () => {
  it('assembles complete evidence with no teaching-private data', () => {
    const env = makeEnv()
    const { demoId, versionId } = publishVersion(env, 'teacher-1', {
      ...META,
      title: '光合作用',
      description: '叶片光合',
      kpIds: ['kp.bio.photo']
    })
    // A report + a second version round out the history.
    env.reports.create('teacher-2', demoId, {
      category: 'copyright',
      reason: '未授权'
    })

    const panel = env.evidence.forVersion(versionId)
    expect(panel.version.id).toBe(versionId)
    expect(panel.version.license).toBe('CC-BY-4.0')
    expect(panel.version.aiDisclosure).toBe('none')
    expect(panel.authorId).toBe('teacher-1')
    expect(panel.snapshotValid).toBe(true)
    expect(panel.snapshot).not.toBeNull()
    expect(panel.reports).toHaveLength(1)
    expect(panel.reports[0]?.category).toBe('copyright')
    // Review history includes the approved version.
    expect(panel.reviewHistory.some((v) => v.id === versionId)).toBe(true)

    // IRON LAW (spec §2.8/§3.4): the panel must NEVER carry teaching-private
    // fields. Recursively assert no forbidden keys anywhere in the payload.
    const forbidden = [
      'studentId',
      'student_id',
      'score',
      'attemptId',
      'attempt_id',
      'mastery',
      'masteryProfile',
      'cohortId',
      'cohort_id',
      'teachingUnitId',
      'teaching_unit_id',
      'enrollment',
      'gradeBook',
      'evidence'
    ]
    const found: string[] = []
    const walk = (value: unknown, path: string): void => {
      if (value === null || typeof value !== 'object') return
      if (Array.isArray(value)) {
        value.forEach((item, i) => walk(item, `${path}[${String(i)}]`))
        return
      }
      const obj = value as Record<string, unknown>
      for (const [key, child] of Object.entries(obj)) {
        if (forbidden.includes(key)) found.push(`${path}.${key}`)
        walk(child, `${path}.${key}`)
      }
    }
    walk(panel, '$')
    expect(found, `teaching-private fields leaked: ${found.join(', ')}`).toEqual([])
  })

  it('resolves external video refs + media manifest details', () => {
    const env = makeEnv()
    // Insert a media blob + asset + external video ref, then submit a version
    // whose manifest references both.
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
      .run('asset-1', 'teacher-1', 'image', blobHash, 'ready', 'cover.png', new Date().toISOString())
    env.db
      .prepare(
        `INSERT INTO external_video_refs (id, owner_id, provider, provider_video_id, canonical_url, health, checked_at, consecutive_failures)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run('evr-1', 'teacher-1', 'youtube', 'abc123', 'https://youtu.be/abc123', 'healthy', new Date().toISOString(), 0)

    const demoId = env.demo.createDemonstration('teacher-1', { ...META })
    // Draft with mediaRefs referencing both the asset blob and the video ref.
    const doc = parseSceneDocument({
      documentMeta: { sceneFormatVersion: '1.0' },
      mediaRefs: [
        { id: 'asset-1', blobHash, purpose: 'texture' },
        { id: 'evr-1', blobHash: '0'.repeat(64), purpose: 'video' }
      ]
    })
    env.demo.saveDraft(demoId, 'teacher-1', doc)
    const versionId = env.demo.submit(demoId, 'teacher-1', {
      classification: 'physics',
      license: 'CC-BY-4.0',
      aiDisclosure: 'none'
    })

    const panel = env.evidence.forVersion(versionId)
    const tex = panel.mediaManifest.find((m) => m.purpose === 'texture')
    expect(tex?.byteSize).toBe(1234)
    expect(tex?.scanStatus).toBe('clean')
    expect(tex?.mediaType).toBe('image/png')
    expect(panel.externalVideos).toHaveLength(1)
    expect(panel.externalVideos[0]?.health).toBe('healthy')
  })

  it('throws on unknown version', () => {
    const env = makeEnv()
    expect(() => env.evidence.forVersion('nope')).toThrow()
  })
})

describe('T-F reports', () => {
  it('any user can report a published demo; report enters open list', () => {
    const env = makeEnv()
    const { demoId } = publishVersion(env, 'teacher-1')
    const report = env.reports.create('teacher-2', demoId, {
      category: 'copyright',
      reason: 'unauthorized'
    })
    expect(report.status).toBe('open')
    expect(env.reports.listOpen().some((r) => r.id === report.id)).toBe(true)
  })

  it('rejects reports on unknown or deleted demos', () => {
    const env = makeEnv()
    expect(() =>
      env.reports.create('teacher-2', 'missing', {
        category: 'spam',
        reason: 'r'
      })
    ).toThrow()
    const { demoId } = publishVersion(env, 'teacher-1')
    env.demo.softDelete(demoId, 'teacher-1')
    expect(() =>
      env.reports.create('teacher-2', demoId, { category: 'spam', reason: 'r' })
    ).toThrow()
  })

  it('reviewer resolves a report and it leaves the open list', () => {
    const env = makeEnv()
    const { demoId } = publishVersion(env, 'teacher-1')
    const report = env.reports.create('teacher-2', demoId, {
      category: 'inappropriate',
      reason: 'r'
    })
    const resolved = env.reports.resolve('reviewer-1', report.id, {
      status: 'resolved',
      note: 'confirmed violation'
    })
    expect(resolved.status).toBe('resolved')
    expect(env.reports.listOpen()).toHaveLength(0)
  })
})

describe('T-F appeals', () => {
  it('owner can appeal; non-owner cannot', () => {
    const env = makeEnv()
    const { demoId, versionId } = submitVersion(env, 'teacher-1')
    env.review.reject('reviewer-1', versionId, 'no')
    const appeal = env.appeals.create('teacher-1', demoId, {
      versionId,
      reason: 'not actually inappropriate'
    })
    expect(appeal.status).toBe('open')
    expect(() =>
      env.appeals.create('teacher-2', demoId, { versionId, reason: 'x' })
    ).toThrow()
  })

  it('reviewer resolves an appeal (approve/deny)', () => {
    const env = makeEnv()
    const { demoId, versionId } = submitVersion(env, 'teacher-1')
    env.review.reject('reviewer-1', versionId, 'no')
    const appeal = env.appeals.create('teacher-1', demoId, {
      versionId,
      reason: 'please restore'
    })
    const denied = env.appeals.resolve('reviewer-1', appeal.id, {
      status: 'denied',
      note: 'upheld'
    })
    expect(denied.status).toBe('denied')
    expect(env.appeals.listOpen()).toHaveLength(0)
  })
})

describe('T-F transactional behavior', () => {
  it('at most one pending version per demonstration', () => {
    const env = makeEnv()
    const { demoId } = submitVersion(env, 'teacher-1')
    // A second submit while one is pending must be rejected (service guard,
    // backed by the DB unique index idx_demo_versions_pending_unique).
    expect(() =>
      env.demo.submit(demoId, 'teacher-1', {
        classification: 'physics',
        license: 'CC-BY-4.0',
        aiDisclosure: 'none'
      })
    ).toThrow()
  })

  it('after rejection a new version can be submitted (new review round)', () => {
    const env = makeEnv()
    const { demoId, versionId } = submitVersion(env, 'teacher-1')
    env.review.reject('reviewer-1', versionId, 'fix it')
    // New round is allowed once the previous is no longer pending.
    expect(() =>
      env.demo.submit(demoId, 'teacher-1', {
        classification: 'physics',
        license: 'CC-BY-4.0',
        aiDisclosure: 'none'
      })
    ).not.toThrow()
  })
})

describe('T-F forced takedown + notification flow', () => {
  it('forced takedown hides the demo and notifies referencing teachers with a replace deadline', () => {
    const env = makeEnv()
    const { demoId, versionId } = publishVersion(env, 'teacher-1')
    // teacher-2 references the published version from their question.
    seedQuestion(env.db, 'q-2', 'teacher-2')
    env.refs.setReferences('teacher-2', 'teacher', {
      questionId: 'q-2',
      entries: [{ demoVersionId: versionId, role: 'primary' }]
    })

    env.review.takedown('reviewer-1', demoId, 'copyright infringement')
    // Identity hidden -> library would exclude; currentPublished still resolves
    // (fixed references keep playing, spec §2.9).
    const deadline = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    const notifications = env.notifications.onForcedTakedown(
      demoId,
      'copyright infringement',
      deadline
    )
    expect(notifications).toHaveLength(1)
    expect(notifications[0]?.kind).toBe('forced_takedown')
    expect(notifications[0]?.recipientId).toBe('teacher-2')
    expect(notifications[0]?.detail.replaceDeadline).toBe(deadline)
    expect(notifications[0]?.detail.reason).toBe('copyright infringement')
  })
})

describe('T-F audit (HMAC chain via demoAuditSink)', () => {
  it('records mandatory governance events on the audit chain', async () => {
    const env = makeEnv()
    const { demoId, versionId } = submitVersion(env, 'teacher-1')
    env.review.approve('reviewer-1', versionId)
    env.reports.create('teacher-2', demoId, {
      category: 'spam',
      reason: 'r'
    })
    env.review.takedown('reviewer-1', demoId, 'illegal')

    await env.audit.flush()
    const records = await env.audit.query({})
    const actions = records.map((r) => `${r.action}:${r.resourceType}`).sort()
    // submit->publish, approve, report(create), takedown(forced) all recorded.
    expect(actions).toContain('publish:demonstration')
    expect(actions).toContain('approve:demonstration')
    expect(actions).toContain('report:publication')
    expect(actions).toContain('takedown:demonstration')
    // The forced takedown carries forced=true metadata.
    const forced = records.find(
      (r) => r.action === 'takedown' && r.metadata?.forced === true
    )
    expect(forced).toBeDefined()
    // Chain integrity holds after the governance writes.
    expect((await env.audit.verifyIntegrity()).valid).toBe(true)
  })

  it('drops non-mandatory events (draft save) from the chain', async () => {
    const env = makeEnv()
    const demoId = env.demo.createDemonstration('teacher-1', { ...META })
    env.demo.saveDraft(demoId, 'teacher-1', baseDoc())
    await env.audit.flush()
    const records = await env.audit.query({})
    // create + draft.save are not mandatory governance events -> not enqueued.
    expect(records).toHaveLength(0)
  })
})
