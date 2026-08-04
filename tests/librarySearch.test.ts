// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { openMemoryDatabase } from '../server/db/memorySchema'
import { DemonstrationService } from '../server/demonstration/DemonstrationService'
import { ReviewService } from '../server/demonstration/ReviewService'
import { ReferenceService } from '../server/demonstration/ReferenceService'
import { DerivationService } from '../server/demonstration/DerivationService'
import { LibrarySearchService } from '../server/demonstration/LibrarySearchService'
import { handleLibraryApi } from '../server/demonstration/libraryRoutes'
import { parseSceneDocument } from '../server/demonstration/sceneDocumentSchema'
import type { IncomingMessage, ServerResponse } from 'node:http'

const baseDoc = () =>
  parseSceneDocument({
    documentMeta: { sceneFormatVersion: '1.0' },
    geometry3D: [{ id: 'box1', kind: 'box' }]
  })

const DEFAULT_META = {
  title: '演示',
  description: '演示说明',
  subject: 'physics',
  grade: 'high',
  format: 'scene',
  space: '3d',
  behavior: 'static'
}

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
  const service = new DemonstrationService({ db })
  const review = new ReviewService({ db })
  const refs = new ReferenceService({ db })
  const derive = new DerivationService({ db })
  const library = new LibrarySearchService(db)
  return { db, service, review, refs, derive, library }
}

interface PublishOpts {
  title?: string
  description?: string
  subject?: string
  grade?: string
  kpIds?: string[]
  format?: string
  space?: string
  behavior?: string
  coverBlobHash?: string
}

function publish(
  env: ReturnType<typeof makeEnv>,
  owner: string,
  opts: PublishOpts = {}
): { demoId: string; versionId: string } {
  const meta: Record<string, unknown> = {
    title: opts.title ?? '演示',
    description: opts.description ?? '演示说明',
    subject: opts.subject ?? 'physics',
    grade: opts.grade ?? 'high',
    kpIds: opts.kpIds ?? [],
    format: opts.format ?? 'scene',
    space: opts.space ?? '3d',
    behavior: opts.behavior ?? 'static'
  }
  if (opts.coverBlobHash) meta.coverBlobHash = opts.coverBlobHash
  const demoId = env.service.createDemonstration(owner, meta)
  env.service.saveDraft(demoId, owner, baseDoc())
  const versionId = env.service.submit(demoId, owner, {
    classification: String(meta.subject),
    license: 'CC-BY-4.0',
    aiDisclosure: 'none'
  })
  env.review.approve('reviewer-1', versionId)
  return { demoId, versionId }
}

describe('LibrarySearchService — discovery', () => {
  it('only surfaces the LATEST approved version per demo (older hidden)', () => {
    const env = makeEnv()
    // Same demo publishes v1 then v2 — only v2 may surface.
    const demo = env.service.createDemonstration('teacher-1', {
      title: '光合作用',
      description: 'd',
      subject: 'biology',
      grade: 'high',
      format: 'scene',
      space: '3d',
      behavior: 'static',
      kpIds: []
    })
    env.service.saveDraft(demo, 'teacher-1', baseDoc())
    env.service.submit(demo, 'teacher-1', { classification: 'biology', license: 'CC-BY-4.0', aiDisclosure: 'none' })
    env.review.approve('reviewer-1', env.service.listVersions(demo)[0]!.id)
    // v2
    env.service.updateMeta(demo, 'teacher-1', {
      title: '光合作用 v2',
      description: 'd',
      subject: 'biology',
      grade: 'high',
      format: 'scene',
      space: '3d',
      behavior: 'static',
      kpIds: []
    })
    env.service.saveDraft(demo, 'teacher-1', baseDoc())
    const v2 = env.service.submit(demo, 'teacher-1', { classification: 'biology', license: 'CC-BY-4.0', aiDisclosure: 'none' })
    env.review.approve('reviewer-1', v2)
    const r = env.library.search({})
    expect(r.total).toBe(1)
    expect(r.items[0]?.title).toBe('光合作用 v2')
    expect(r.items[0]?.versionSeq).toBe(2)
  })

  it('search ranks title matches above description matches', () => {
    const env = makeEnv()
    publish(env, 'teacher-1', { title: '光合作用原理', subject: 'biology' })
    publish(env, 'teacher-1', { title: '细胞呼吸', description: '光合作用与呼吸作用对比', subject: 'biology' })
    const r = env.library.search({ q: '光合作用' })
    expect(r.items[0]?.title).toBe('光合作用原理')
  })

  it('filters by subject + space + license facets', () => {
    const env = makeEnv()
    publish(env, 'teacher-1', { title: '3D 模型', subject: 'physics', space: '3d' })
    publish(env, 'teacher-1', { title: '2D 动画', subject: 'physics', space: '2d', behavior: 'animation' })
    publish(env, 'teacher-1', { title: '化学', subject: 'chemistry', space: '3d' })
    const r = env.library.search({ filters: { subject: 'physics', space: '3d' } })
    expect(r.total).toBe(1)
    expect(r.items[0]?.title).toBe('3D 模型')
  })

  it('filters by kp id', () => {
    const env = makeEnv()
    publish(env, 'teacher-1', { title: 'A', kpIds: ['kp.bio.genetics'] })
    publish(env, 'teacher-1', { title: 'B', kpIds: ['kp.phy.mech'] })
    const r = env.library.search({ filters: { kp: 'kp.bio.genetics' } })
    expect(r.total).toBe(1)
    expect(r.items[0]?.title).toBe('A')
  })

  it('sorts by citation count when sort=citations', () => {
    const env = makeEnv()
    const a = publish(env, 'teacher-1', { title: 'A' })
    publish(env, 'teacher-1', { title: 'B' })
    env.refs.setReferences('teacher-1', 'teacher', {
      questionId: 'q-1',
      entries: [{ demoVersionId: a.versionId, role: 'primary' }]
    })
    const r = env.library.search({ sort: 'citations' })
    expect(r.items[0]?.title).toBe('A')
    expect(r.items[0]?.citationCount).toBe(1)
  })

  it('relevance sort puts cited high-relevance first, citations tiebreak', () => {
    const env = makeEnv()
    const a = publish(env, 'teacher-1', { title: '牛顿定律实验', subject: 'physics' })
    publish(env, 'teacher-1', { title: '牛顿第二定律', subject: 'physics' })
    env.refs.setReferences('teacher-1', 'teacher', {
      questionId: 'q-1',
      entries: [{ demoVersionId: a.versionId, role: 'primary' }]
    })
    const r = env.library.search({ q: '牛顿' })
    // Both hit '牛顿' in title (score 3); a has 1 citation → a first (tiebreak).
    expect(r.items[0]?.title).toBe('牛顿定律实验')
    expect(r.items[0]?.citationCount).toBe(1)
  })

  it('excludes soft-deleted demos', () => {
    const env = makeEnv()
    const { demoId } = publish(env, 'teacher-1', { title: '将删除' })
    env.service.softDelete(demoId, 'teacher-1')
    const r = env.library.search({})
    expect(r.items.some((i) => i.id === demoId)).toBe(false)
  })

  it('results carry metadata only, no playback content', () => {
    const env = makeEnv()
    publish(env, 'teacher-1', { title: '无内容', coverBlobHash: 'c'.repeat(64) })
    const r = env.library.search({})
    const card = r.items[0]!
    expect(card.title).toBe('无内容')
    expect(card.coverBlobHash).toBe('c'.repeat(64))
    // No document/snapshot content in the card.
    expect(((card as unknown) as Record<string, unknown>).document).toBeUndefined()
    expect(((card as unknown) as Record<string, unknown>).snapshotDocumentJson).toBeUndefined()
  })

  it('facets list distinct values from published content', () => {
    const env = makeEnv()
    publish(env, 'teacher-1', { title: 'A', subject: 'physics', space: '3d' })
    publish(env, 'teacher-1', { title: 'B', subject: 'biology', space: '2d' })
    const f = env.library.facets()
    expect(f.subject).toEqual(['biology', 'physics'])
    expect(f.space).toEqual(['2d', '3d'])
    expect(f.license).toContain('CC-BY-4.0')
  })

  it('paginates with limit/offset', () => {
    const env = makeEnv()
    publish(env, 'teacher-1', { title: 'A' })
    publish(env, 'teacher-1', { title: 'B' })
    publish(env, 'teacher-1', { title: 'C' })
    const page1 = env.library.search({ limit: 2, offset: 0 })
    const page2 = env.library.search({ limit: 2, offset: 2 })
    expect(page1.items.length).toBe(2)
    expect(page2.items.length).toBe(1)
    expect(page1.total).toBe(3)
  })

  it('filters by license (version attribute)', () => {
    const env = makeEnv()
    publish(env, 'teacher-1', { title: '自由' })
    // Second one with a different license via direct submit.
    const demo = env.service.createDemonstration('teacher-1', {
      title: '受限',
      description: 'd',
      subject: 'physics',
      grade: 'high',
      format: 'scene',
      space: '3d',
      behavior: 'static',
      kpIds: []
    })
    env.service.saveDraft(demo, 'teacher-1', baseDoc())
    const v = env.service.submit(demo, 'teacher-1', { classification: 'physics', license: 'CC-BY-NC-SA-4.0', aiDisclosure: 'none' })
    env.review.approve('reviewer-1', v)
    const r = env.library.search({ filters: { license: 'CC-BY-NC-SA-4.0' } })
    expect(r.total).toBe(1)
    expect(r.items[0]?.title).toBe('受限')
  })

  it('empty library returns empty result', () => {
    const env = makeEnv()
    const r = env.library.search({})
    expect(r.total).toBe(0)
    expect(r.items).toEqual([])
    expect(env.library.facets()).toEqual({
      subject: [],
      grade: [],
      format: [],
      space: [],
      behavior: [],
      license: []
    })
  })

  it('derived works surface with source=derived', () => {
    const env = makeEnv()
    const src = publish(env, 'teacher-1', { title: '原作' })
    const { demoId } = env.derive.deriveFrom('teacher-2', src.demoId, src.versionId)
    env.service.updateMeta(demoId, 'teacher-2', { ...DEFAULT_META, title: '衍生' })
    env.service.saveDraft(demoId, 'teacher-2', baseDoc())
    const v = env.service.submit(demoId, 'teacher-2', { classification: 'physics', license: 'CC-BY-4.0', aiDisclosure: 'none' })
    env.review.approve('reviewer-1', v)
    const r = env.library.search({})
    const derived = r.items.find((i) => i.title === '衍生')
    expect(derived?.source).toBe('derived')
  })

  it('card carries authorId (owner) and health', () => {
    const env = makeEnv()
    publish(env, 'teacher-1', { title: '作者' })
    const r = env.library.search({})
    const card = r.items[0]!
    expect(card.authorId).toBe('teacher-1')
    expect(card.health).toBe('healthy')
    expect(card.versionSeq).toBe(1)
  })
})

describe('libraryRoutes — mounted discovery contract', () => {
  function capture(): { response: ServerResponse; status: () => number; body: () => unknown } {
    let status = 0
    let body = ''
    const response = {
      writeHead: (code: number) => { status = code },
      end: (chunk?: unknown) => { body = typeof chunk === 'string' ? chunk : JSON.stringify(chunk ?? '') }
    } as unknown as ServerResponse
    return { response, status: () => status, body: () => JSON.parse(body) as unknown }
  }

  it('serves approved library cards through GET /api/library', () => {
    const env = makeEnv()
    publish(env, 'teacher-1', { title: '磁场演示', subject: 'physics' })
    const out = capture()
    const handled = handleLibraryApi(
      { method: 'GET' } as IncomingMessage,
      out.response,
      '/api/library',
      new URL('http://localhost/api/library?q=磁场&subject=physics'),
      { db: env.db, getUserId: () => 'teacher-1' }
    )
    expect(handled).toBe(true)
    expect(out.status()).toBe(200)
    expect((out.body() as { items: Array<{ title: string }> }).items[0]?.title).toBe('磁场演示')
  })

  it('rejects anonymous library reads', () => {
    const env = makeEnv()
    const out = capture()
    handleLibraryApi(
      { method: 'GET' } as IncomingMessage,
      out.response,
      '/api/library',
      new URL('http://localhost/api/library'),
      { db: env.db, getUserId: () => null }
    )
    expect(out.status()).toBe(401)
  })
})