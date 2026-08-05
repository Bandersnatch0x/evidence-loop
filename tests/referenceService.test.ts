// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { openMemoryDatabase } from '../server/db/memorySchema'
import { DemonstrationService } from '../server/demonstration/DemonstrationService'
import { ReviewService } from '../server/demonstration/ReviewService'
import {
  MAX_SUPPLEMENTARY,
  ReferenceService,
  ReferenceValidationError
} from '../server/demonstration/ReferenceService'
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
  ).run(id, 'qb-1', authorId, 'physics', 'mcq', 'test stem', '{}', '[]', new Date().toISOString())
}

function makeEnv() {
  const db = openMemoryDatabase(':memory:')
  seedUser(db, 'reviewer-1', true)
  seedUser(db, 'teacher-1', false)
  seedUser(db, 'teacher-2', false)
  seedQuestion(db, 'q-1', 'teacher-1')
  seedQuestion(db, 'q-2', 'teacher-2')
  seedQuestion(db, 'q-seed', 'seed')
  const service = new DemonstrationService({ db })
  const review = new ReviewService({ db })
  const refs = new ReferenceService({ db })
  return { db, service, review, refs }
}

/** Create + submit + approve a demo version, returning its version id. */
function published(env: ReturnType<typeof makeEnv>, label = 'demo'): string {
  const demo = env.service.createDemonstration('teacher-1', { ...DEFAULT_META, title: label })
  env.service.saveDraft(demo, 'teacher-1', baseDoc())
  const v = env.service.submit(demo, 'teacher-1', {
    classification: 'physics',
    license: 'CC-BY-4.0',
    aiDisclosure: 'none'
  })
  env.review.approve('reviewer-1', v)
  return v
}

describe('ReferenceService — bind/validate/order', () => {
  it('binds a primary + supplementary references to a question', () => {
    const env = makeEnv()
    const v1 = published(env, 'a')
    const v2 = published(env, 'b')
    env.refs.setReferences('teacher-1', 'teacher', {
      questionId: 'q-1',
      entries: [
        { demoVersionId: v1, role: 'primary' },
        { demoVersionId: v2, role: 'supplementary' }
      ]
    })
    const list = env.refs.listReferences('q-1', 'question')
    expect(list.length).toBe(2)
    expect(list[0]?.role).toBe('primary')
    expect(list[1]?.role).toBe('supplementary')
  })

  it('rejects a second primary reference', () => {
    const env = makeEnv()
    const v1 = published(env, 'a')
    const v2 = published(env, 'b')
    expect(() =>
      env.refs.setReferences('teacher-1', 'teacher', {
        questionId: 'q-1',
        entries: [
          { demoVersionId: v1, role: 'primary' },
          { demoVersionId: v2, role: 'primary' }
        ]
      })
    ).toThrow(ReferenceValidationError)
  })

  it(`rejects more than ${MAX_SUPPLEMENTARY} supplementary references`, () => {
    const env = makeEnv()
    const versions = Array.from({ length: MAX_SUPPLEMENTARY + 1 }, (_, i) => published(env, `d${i}`))
    expect(() =>
      env.refs.setReferences('teacher-1', 'teacher', {
        questionId: 'q-1',
        entries: versions.map((v) => ({
          demoVersionId: v,
          role: 'supplementary'
        }))
      })
    ).toThrow(ReferenceValidationError)
  })

  it('rejects binding a non-approved version', () => {
    const env = makeEnv()
    const demo = env.service.createDemonstration('teacher-1', DEFAULT_META)
    env.service.saveDraft(demo, 'teacher-1', baseDoc())
    const v = env.service.submit(demo, 'teacher-1', {
      classification: 'x',
      license: 'CC-BY-4.0',
      aiDisclosure: 'none'
    })
    // v is submitted, not approved.
    expect(() =>
      env.refs.setReferences('teacher-1', 'teacher', {
        questionId: 'q-1',
        entries: [{ demoVersionId: v, role: 'primary' }]
      })
    ).toThrow(/not approved/)
  })

  it('rejects binding another teacher\'s private question', () => {
    const env = makeEnv()
    const v = published(env)
    expect(() =>
      env.refs.setReferences('teacher-1', 'teacher', {
        questionId: 'q-2', // owned by teacher-2
        entries: [{ demoVersionId: v, role: 'primary' }]
      })
    ).toThrow(/another teacher/)
  })

  it('allows binding a seed (public) question from any teacher', () => {
    const env = makeEnv()
    const v = published(env)
    env.refs.setReferences('teacher-1', 'teacher', {
      questionId: 'q-seed',
      entries: [{ demoVersionId: v, role: 'primary' }]
    })
    expect(env.refs.listReferences('q-seed', 'question').length).toBe(1)
  })

  it('rejects students binding', () => {
    const env = makeEnv()
    const v = published(env)
    expect(() =>
      env.refs.setReferences('student-1', 'student', {
        questionId: 'q-1',
        entries: [{ demoVersionId: v, role: 'primary' }]
      })
    ).toThrow(ReferenceValidationError)
  })

  it('rejects duplicate demo version ids in one set', () => {
    const env = makeEnv()
    const v = published(env)
    expect(() =>
      env.refs.setReferences('teacher-1', 'teacher', {
        questionId: 'q-1',
        entries: [
          { demoVersionId: v, role: 'primary' },
          { demoVersionId: v, role: 'supplementary' }
        ]
      })
    ).toThrow(/duplicate/)
  })

  it('full-replace clears previous bindings', () => {
    const env = makeEnv()
    const v1 = published(env, 'a')
    const v2 = published(env, 'b')
    env.refs.setReferences('teacher-1', 'teacher', {
      questionId: 'q-1',
      entries: [{ demoVersionId: v1, role: 'primary' }]
    })
    env.refs.setReferences('teacher-1', 'teacher', {
      questionId: 'q-1',
      entries: [{ demoVersionId: v2, role: 'primary' }]
    })
    const list = env.refs.listReferences('q-1', 'question')
    expect(list.length).toBe(1)
    expect(list[0]?.demoVersionId).toBe(v2)
  })

  it('binds to a KP (no question side)', () => {
    const env = makeEnv()
    const v = published(env)
    env.refs.setReferences('teacher-1', 'teacher', {
      kpId: 'kp.physics.mechanics',
      entries: [{ demoVersionId: v, role: 'primary' }]
    })
    const list = env.refs.listReferences('kp.physics.mechanics', 'kp')
    expect(list.length).toBe(1)
  })

  it('rejects binding an OLDER approved version (only current published accepts new refs)', () => {
    const env = makeEnv()
    // Same demo publishes v1 then v2 → v1 approved but stale.
    const demo = env.service.createDemonstration('teacher-1', { ...DEFAULT_META, title: 'demo' })
    env.service.saveDraft(demo, 'teacher-1', baseDoc())
    const v1 = env.service.submit(demo, 'teacher-1', {
      classification: 'physics',
      license: 'CC-BY-4.0',
      aiDisclosure: 'none'
    })
    env.review.approve('reviewer-1', v1)
    env.service.saveDraft(demo, 'teacher-1', baseDoc())
    const v2 = env.service.submit(demo, 'teacher-1', {
      classification: 'physics',
      license: 'CC-BY-4.0',
      aiDisclosure: 'none'
    })
    env.review.approve('reviewer-1', v2)
    // v1 is still approved but no longer current for its demo.
    expect(() =>
      env.refs.setReferences('teacher-1', 'teacher', {
        questionId: 'q-1',
        entries: [{ demoVersionId: v1, role: 'primary' }]
      })
    ).toThrow(/not the current published/)
  })

  it('removeReference rejects another teacher removing a private question reference', () => {
    const env = makeEnv()
    const v = published(env)
    env.refs.setReferences('teacher-1', 'teacher', {
      questionId: 'q-1',
      entries: [{ demoVersionId: v, role: 'primary' }]
    })
    const list = env.refs.listReferences('q-1', 'question')
    expect(() => env.refs.removeReference('teacher-2', 'teacher', list[0]!.id)).toThrow(/another teacher/)
  })

  it('removeReference works for the binding teacher', () => {
    const env = makeEnv()
    const v = published(env)
    env.refs.setReferences('teacher-1', 'teacher', {
      questionId: 'q-1',
      entries: [{ demoVersionId: v, role: 'primary' }]
    })
    const list = env.refs.listReferences('q-1', 'question')
    env.refs.removeReference('teacher-1', 'teacher', list[0]!.id)
    expect(env.refs.listReferences('q-1', 'question').length).toBe(0)
  })
})

describe('ReferenceService — student assignment resolution (reference-first)', () => {
  /** Create a migration-map preset demo + guard row for a question. */
  function migratePreset(env: ReturnType<typeof makeEnv>, questionId: string): string {
    const demo = env.service.createDemonstration('seed', { ...DEFAULT_META, title: `预设 ${questionId}` })
    env.service.saveDraft(demo, 'seed', baseDoc())
    const v = env.service.submit(demo, 'seed', {
      classification: 'physics',
      license: 'CC-BY-4.0',
      aiDisclosure: 'none'
    })
    env.db.prepare(`UPDATE demonstration_versions SET status = 'approved' WHERE id = ?`).run(v)
    env.db.prepare(
      `INSERT INTO visualization_migration_map (question_id, demo_id, version_id, migrated_at)
       VALUES (?, ?, ?, ?)`
    ).run(questionId, demo, v, new Date().toISOString())
    return v
  }

  it('returns an empty list when no references or migration exist', () => {
    const env = makeEnv()
    expect(env.refs.listStudentReferencesForAssignment('q-1')).toEqual([])
    // Seed-prefixed candidate also resolves nothing.
    expect(env.refs.listStudentReferencesForAssignment('python-average')).toEqual([])
  })

  it('explicit references win over migration mapping', () => {
    const env = makeEnv()
    const explicit = published(env, 'explicit')
    migratePreset(env, 'q-1')
    env.refs.setReferences('teacher-1', 'teacher', {
      questionId: 'q-1',
      entries: [{ demoVersionId: explicit, role: 'primary' }]
    })
    const refs = env.refs.listStudentReferencesForAssignment('q-1')
    expect(refs).toHaveLength(1)
    expect(refs[0]?.role).toBe('primary')
    expect(refs[0]?.source).toBe('mine')
    expect(refs[0]?.versionId).toBe(explicit)
    expect(refs[0]?.title).toBe('explicit')
    expect(refs[0]?.authorName).toBe('teacher-1')
  })

  it('falls back to the migration mapping when no explicit reference exists', () => {
    const env = makeEnv()
    migratePreset(env, 'q-1')
    const refs = env.refs.listStudentReferencesForAssignment('q-1')
    expect(refs).toHaveLength(1)
    expect(refs[0]?.role).toBe('primary')
    expect(refs[0]?.source).toBe('public')
    expect(refs[0]?.health).toBe('healthy')
    expect(refs[0]?.title).toContain('预设')
  })

  it('prefers the seed:<id> candidate over the bare assignment id', () => {
    const env = makeEnv()
    migratePreset(env, 'seed:demo-1')
    // Bare id has no mapping; seed candidate resolves.
    const refs = env.refs.listStudentReferencesForAssignment('demo-1')
    expect(refs).toHaveLength(1)
    expect(refs[0]?.source).toBe('public')
  })

  it('marks a soft-deleted demo source as unavailable while keeping the ref playable', () => {
    const env = makeEnv()
    migratePreset(env, 'q-1')
    const mapped = env.db
      .prepare(`SELECT demo_id FROM visualization_migration_map WHERE question_id = ?`)
      .get('q-1') as { demo_id: string }
    env.db.prepare(`UPDATE teaching_demonstrations SET deleted_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), mapped.demo_id)
    const refs = env.refs.listStudentReferencesForAssignment('q-1')
    expect(refs[0]?.health).toBe('unavailable')
    expect(refs[0]?.versionId).toBeTruthy()
  })
})

describe('ReferenceService — student KP resolution (知识点页)', () => {
  it('returns references bound to a knowledge point', () => {
    const env = makeEnv()
    const v = published(env, 'kp demo')
    env.refs.setReferences('teacher-1', 'teacher', {
      kpId: 'kp.physics.mechanics',
      entries: [{ demoVersionId: v, role: 'primary' }]
    })
    const refs = env.refs.listStudentReferencesForKp('kp.physics.mechanics')
    expect(refs).toHaveLength(1)
    expect(refs[0]?.role).toBe('primary')
    expect(refs[0]?.versionId).toBe(v)
    expect(refs[0]?.title).toBe('kp demo')
    expect(refs[0]?.source).toBe('mine')
    expect(refs[0]?.health).toBe('healthy')
  })

  it('returns an empty list for an unknown KP', () => {
    const env = makeEnv()
    expect(env.refs.listStudentReferencesForKp('kp.unknown')).toEqual([])
  })

  it('returns an empty list for an empty KP id', () => {
    const env = makeEnv()
    expect(env.refs.listStudentReferencesForKp('')).toEqual([])
    expect(env.refs.listStudentReferencesForKp('   ')).toEqual([])
  })

  it('orders primary before supplementary', () => {
    const env = makeEnv()
    const primary = published(env, 'primary')
    const supp = published(env, 'supp')
    env.refs.setReferences('teacher-1', 'teacher', {
      kpId: 'kp.1',
      entries: [
        { demoVersionId: primary, role: 'primary' },
        { demoVersionId: supp, role: 'supplementary' }
      ]
    })
    const refs = env.refs.listStudentReferencesForKp('kp.1')
    expect(refs[0]?.role).toBe('primary')
    expect(refs[1]?.role).toBe('supplementary')
  })
})