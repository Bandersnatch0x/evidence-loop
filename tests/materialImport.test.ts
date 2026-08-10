// @vitest-environment node

/**
 * T15 材料 → 草稿题 · 教师校对闸门。
 *
 * 断言的四件事（ADR-0001 / PRD 验收）：
 *   1. 生成物 provenance = llm_inference，且生成不写题库；
 *   2. 未确认草稿不可作答 / 不可布置（硬闸门，assessment-ref → 422）；
 *   3. API 返回结构符合契约（gateNotice / drafts / question）；
 *   4. 整条 LLM 路径不碰任何 score / evidence / attempt。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createDraftQuestionGenerator,
  MaterialImportGateError,
  MaterialImportOwnershipError,
  MaterialImportService,
  MaterialImportStore,
  TemplateDraftQuestionGenerator,
  TEMPLATE_DRAFT_COUNT,
  TEMPLATE_GENERATOR_MODEL,
  tryHandleMaterialImportRoute,
  type MaterialImportRouteContext
} from '../server/materialImport'
import { isAnswerReady } from '../shared/materialImport'
import type { DraftQuestion } from '../shared/materialImport'
import { QuestionBankService } from '../server/questionbank/QuestionBankService'
import { QuestionStore } from '../server/questionbank/QuestionStore'
import type { SessionUser } from '../server/auth/SessionProvider'

const TEACHER = 'teacher-material-alpha'
const OTHER = 'teacher-material-beta'
const BANK = 'bank-material-1'
const FIXED_NOW = () => new Date('2026-08-07T09:00:00.000Z')

const MATERIAL = [
  '一元一次方程是只含有一个未知数，且未知数次数为 1 的整式方程。',
  '解方程的基本步骤：去分母、去括号、移项、合并同类项、系数化为一。',
  '例：2(x+1)=6，去括号得 2x+2=6，移项得 2x=4，故 x=2。'
].join('\n')

function makeService(environment: NodeJS.ProcessEnv = {}) {
  const database = new Database(':memory:')
  const store = new MaterialImportStore({ database })
  const questions = new QuestionStore({ database })
  const bank = new QuestionBankService({ store: questions, now: FIXED_NOW })
  const service = new MaterialImportService({
    store,
    questionBank: bank,
    generator: new TemplateDraftQuestionGenerator(),
    now: FIXED_NOW,
    environment
  })
  return { service, store, bank, questions }
}

async function createJob(service: MaterialImportService, teacherId = TEACHER) {
  return service.createJob({
    teacherId,
    questionBankId: BANK,
    subject: 'math',
    rawText: MATERIAL
  })
}

/** 教师补全答案后确认（模板草稿刻意留空答案）。 */
function confirmWithAnswer(
  service: MaterialImportService,
  draft: DraftQuestion,
  teacherId = TEACHER
) {
  const payload =
    draft.payload.questionType === 'choice'
      ? { kind: 'choice', correctOptionIds: ['B'] }
      : { kind: 'fill_blank', acceptedAnswers: ['x=2'] }
  return service.confirmDraft(draft.id, teacherId, { payload })
}

// ---------------------------------------------------------------------------
// 1. 生成：provenance = llm_inference，且不写题库
// ---------------------------------------------------------------------------

describe('材料 → 草稿题生成 (T15)', () => {
  it('模板降级固定产出 2 条草稿，全部标 llm_inference', async () => {
    const { service } = makeService()
    const view = await createJob(service)

    expect(view.drafts).toHaveLength(TEMPLATE_DRAFT_COUNT)
    expect(view.job.degraded).toBe(true)
    expect(view.job.generatorModel).toBe(TEMPLATE_GENERATOR_MODEL)
    for (const draft of view.drafts) {
      expect(draft.provenance.kind).toBe('llm_inference')
      expect(draft.status).toBe('draft')
      expect(draft.confirmedQuestionId).toBeUndefined()
    }
  })

  it('生成不写题库：createJob 之后题库仍为空', async () => {
    const { service, bank } = makeService()
    await createJob(service)
    expect(bank.list(TEACHER, { questionBankId: BANK })).toHaveLength(0)
  })

  it('只落原文 sha256，不落全文', async () => {
    const { service } = makeService()
    const view = await createJob(service)
    expect(view.job.rawTextHash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(view.job)).not.toContain('一元一次方程')
  })

  it('模板草稿答案为空 → isAnswerReady 为 false', async () => {
    const { service } = makeService()
    const view = await createJob(service)
    for (const draft of view.drafts) {
      expect(isAnswerReady(draft.payload)).toBe(false)
    }
  })

  it('无 LLM key 时工厂返回模板降级生成器', () => {
    expect(createDraftQuestionGenerator({}).degraded).toBe(true)
    expect(
      createDraftQuestionGenerator({
        LLM_API_KEY: 'k',
        LLM_BASE_URL: 'https://example.invalid/v1',
        LLM_MODEL: 'm'
      }).degraded
    ).toBe(true)
  })

  it('材料过短被拒', async () => {
    const { service } = makeService()
    await expect(
      service.createJob({
        teacherId: TEACHER,
        questionBankId: BANK,
        subject: 'math',
        rawText: '太短'
      })
    ).rejects.toThrow(/过短/)
  })
})

// ---------------------------------------------------------------------------
// 2. 校对闸门：未确认不可入库 / 不可布置
// ---------------------------------------------------------------------------

describe('教师校对闸门 (T15)', () => {
  it('未填答案的草稿不可确认', async () => {
    const { service, bank } = makeService()
    const view = await createJob(service)
    const draft = view.drafts[0]!

    expect(() => service.confirmDraft(draft.id, TEACHER)).toThrow(
      MaterialImportGateError
    )
    expect(bank.list(TEACHER, { questionBankId: BANK })).toHaveLength(0)
  })

  it('未确认草稿不可用于测评（resolveAssessmentQuestionId 抛闸门错误）', async () => {
    const { service } = makeService()
    const view = await createJob(service)
    const draft = view.drafts[0]!

    expect(service.isDraftAssessable(draft)).toBe(false)
    expect(() => service.resolveAssessmentQuestionId(draft.id, TEACHER)).toThrow(
      MaterialImportGateError
    )
  })

  it('教师补全答案确认后才入库，且 provenance 升级为 teacher_annotation', async () => {
    const { service, bank } = makeService()
    const view = await createJob(service)
    const draft = view.drafts[0]!

    const result = confirmWithAnswer(service, draft)

    expect(result.draft.status).toBe('confirmed')
    expect(result.draft.provenance.kind).toBe('teacher_annotation')
    expect(result.question.id).toBe(result.draft.confirmedQuestionId)
    // 答案权威：authored_key + 教师 ID，不是 LLM。
    expect(result.question.source).toBe('authored_key')
    expect(result.question.authorId).toBe(TEACHER)
    expect(bank.list(TEACHER, { questionBankId: BANK })).toHaveLength(1)
    expect(service.resolveAssessmentQuestionId(draft.id, TEACHER)).toBe(
      result.question.id
    )
  })

  it('确认状态写入失败时回滚已创建的正式题', async () => {
    const { service, store, bank } = makeService()
    const view = await createJob(service)
    const draft = view.drafts[0]!
    const saveDraft = store.saveDraft.bind(store)
    vi.spyOn(store, 'saveDraft').mockImplementation((candidate) => {
      if (candidate.status === 'confirmed') {
        throw new Error('simulated confirmation write failure')
      }
      saveDraft(candidate)
    })

    expect(() => confirmWithAnswer(service, draft)).toThrow(
      /simulated confirmation write failure/
    )
    expect(bank.list(TEACHER, { questionBankId: BANK })).toHaveLength(0)
    expect(store.getDraft(draft.id)?.status).toBe('draft')
  })

  it('丢弃草稿不产生任何 Question，且此后不可确认', async () => {
    const { service, bank } = makeService()
    const view = await createJob(service)
    const draft = view.drafts[1]!

    const discarded = service.discardDraft(draft.id, TEACHER)
    expect(discarded.draft.status).toBe('discarded')
    expect(bank.list(TEACHER, { questionBankId: BANK })).toHaveLength(0)
    expect(() => confirmWithAnswer(service, draft)).toThrow(
      MaterialImportGateError
    )
  })

  it('重复确认被拒（不产生第二条题库题）', async () => {
    const { service, bank } = makeService()
    const view = await createJob(service)
    const draft = view.drafts[0]!

    confirmWithAnswer(service, draft)
    expect(() => confirmWithAnswer(service, draft)).toThrow(
      MaterialImportGateError
    )
    expect(bank.list(TEACHER, { questionBankId: BANK })).toHaveLength(1)
  })

  it('批量确认只放行已填答案的草稿，其余回报跳过原因', async () => {
    const { service, bank } = makeService()
    const view = await createJob(service)
    const [first, second] = view.drafts as [DraftQuestion, DraftQuestion]

    service.patchDraft(first.id, TEACHER, {
      payload: { kind: 'choice', correctOptionIds: ['A'] }
    })
    const batch = service.confirmBatch(view.job.id, TEACHER)

    expect(batch.confirmed).toHaveLength(1)
    expect(batch.questions).toHaveLength(1)
    expect(batch.skipped).toEqual([
      { draftId: second.id, reason: '未填答案' }
    ])
    expect(batch.job.status).toBe('partially_confirmed')
    expect(bank.list(TEACHER, { questionBankId: BANK })).toHaveLength(1)
  })

  it('跨教师访问被拒', async () => {
    const { service } = makeService()
    const view = await createJob(service)
    expect(() => service.getDraft(view.drafts[0]!.id, OTHER)).toThrow(
      MaterialImportOwnershipError
    )
    expect(() => service.getJobView(view.job.id, OTHER)).toThrow(
      MaterialImportOwnershipError
    )
  })
})

// ---------------------------------------------------------------------------
// 3. HTTP 层：返回结构 + 权限 + 422
// ---------------------------------------------------------------------------

interface TestServer {
  url: string
  close: () => Promise<void>
}

const servers: TestServer[] = []

afterEach(async () => {
  while (servers.length > 0) await servers.pop()?.close()
})

function startServer(
  service: MaterialImportService,
  user: SessionUser
): Promise<TestServer> {
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
    const context: MaterialImportRouteContext = {
      materialImportService: service,
      user
    }
    void tryHandleMaterialImportRoute(
      request,
      response,
      requestUrl,
      context
    ).then((handled) => {
      if (!handled) {
        response.writeHead(404).end('not mine')
      }
    })
  })
  return new Promise((resolveServer) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      const entry: TestServer = {
        url: `http://127.0.0.1:${String(port)}`,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => {
              done()
            })
          })
      }
      servers.push(entry)
      resolveServer(entry)
    })
  })
}

function teacherUser(userId = TEACHER): SessionUser {
  return { userId, role: 'teacher', displayName: 'T' }
}

describe('材料导入 HTTP 端点 (T15)', () => {
  it('POST 创建任务返回 201 + 草稿 + 闸门声明，且不入题库', async () => {
    const { service, bank } = makeService()
    const server = await startServer(service, teacherUser())

    const response = await fetch(`${server.url}/api/teacher/material-import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        questionBankId: BANK,
        subject: 'math',
        rawText: MATERIAL
      })
    })
    const body = (await response.json()) as {
      job: { id: string; status: string }
      drafts: DraftQuestion[]
      gateNotice: string
      publishedToQuestionBank: boolean
      requiresTeacherConfirmation: boolean
    }

    expect(response.status).toBe(201)
    expect(body.job.status).toBe('generated')
    expect(body.drafts).toHaveLength(TEMPLATE_DRAFT_COUNT)
    expect(body.gateNotice).toContain('不可计分')
    expect(body.publishedToQuestionBank).toBe(false)
    expect(body.requiresTeacherConfirmation).toBe(true)
    expect(JSON.stringify(body)).not.toMatch(/"score"|"evidence"|"attemptId"/)
    expect(bank.list(TEACHER, { questionBankId: BANK })).toHaveLength(0)
  })

  it('未确认草稿请求 assessment-ref → 422', async () => {
    const { service } = makeService()
    const view = await createJob(service)
    const server = await startServer(service, teacherUser())

    const response = await fetch(
      `${server.url}/api/teacher/material-import/drafts/${view.drafts[0]!.id}/assessment-ref`
    )
    const body = (await response.json()) as {
      error: string
      usableForAssessment: boolean
    }

    expect(response.status).toBe(422)
    expect(body.usableForAssessment).toBe(false)
    expect(body.error).toContain('未经教师校对确认')
  })

  it('PATCH 修正 + POST 确认 → 200，随后 assessment-ref 返回 questionId', async () => {
    const { service } = makeService()
    const view = await createJob(service)
    const draftId = view.drafts[0]!.id
    const server = await startServer(service, teacherUser())
    const base = `${server.url}/api/teacher/material-import/drafts/${draftId}`

    const patched = await fetch(base, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stem: '2(x+1)=6 的解是？' })
    })
    expect(patched.status).toBe(200)

    const confirmed = await fetch(`${base}/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        payload: { kind: 'choice', correctOptionIds: ['B'] }
      })
    })
    const confirmBody = (await confirmed.json()) as {
      draft: DraftQuestion
      question: { id: string; source: string; authorId: string }
    }
    expect(confirmed.status).toBe(200)
    expect(confirmBody.draft.provenance.kind).toBe('teacher_annotation')
    expect(confirmBody.question.source).toBe('authored_key')
    expect(confirmBody.question.authorId).toBe(TEACHER)

    const ref = await fetch(`${base}/assessment-ref`)
    const refBody = (await ref.json()) as { questionId: string }
    expect(ref.status).toBe(200)
    expect(refBody.questionId).toBe(confirmBody.question.id)
  })

  it('缺答案确认 → 422 且带闸门声明', async () => {
    const { service } = makeService()
    const view = await createJob(service)
    const server = await startServer(service, teacherUser())

    const response = await fetch(
      `${server.url}/api/teacher/material-import/drafts/${view.drafts[0]!.id}/confirm`,
      { method: 'POST' }
    )
    const body = (await response.json()) as { error: string; gateNotice: string }
    expect(response.status).toBe(422)
    expect(body.error).toContain('答案权威')
    expect(body.gateNotice).toContain('llm_inference')
  })

  it('学生角色一律 403', async () => {
    const { service } = makeService()
    const server = await startServer(service, {
      userId: 'student-1',
      role: 'student',
      displayName: 'S'
    })
    const response = await fetch(`${server.url}/api/teacher/material-import`)
    expect(response.status).toBe(403)
  })

  it('别人的任务 → 403，未知草稿 → 404，非本模块路径 → false', async () => {
    const { service } = makeService()
    const view = await createJob(service)
    const server = await startServer(service, teacherUser(OTHER))

    const forbidden = await fetch(
      `${server.url}/api/teacher/material-import/${view.job.id}`
    )
    expect(forbidden.status).toBe(403)

    const missing = await fetch(
      `${server.url}/api/teacher/material-import/drafts/dq_missing`
    )
    expect(missing.status).toBe(404)

    const other = await fetch(`${server.url}/api/health`)
    expect(await other.text()).toBe('not mine')
  })
})

// ---------------------------------------------------------------------------
// 4. 铁律：LLM 路径不碰计分
// ---------------------------------------------------------------------------

describe('ADR-0001 边界 (T15)', () => {
  const moduleFiles = [
    'server/materialImport/DraftQuestionGenerator.ts',
    'server/materialImport/MaterialImportService.ts',
    'server/materialImport/MaterialImportStore.ts',
    'server/materialImport/materialImportRoutes.ts'
  ]

  it('材料导入模块不 import 任何计分 / 掌握度 / Runner 模块', () => {
    for (const file of moduleFiles) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8')
      const imports = source.match(/from '[^']+'/g) ?? []
      for (const specifier of imports) {
        expect(
          /runner|mastery|review|scoring|evaluation|attempt/i.test(specifier)
        ).toBe(false)
      }
    }
  })

  it('0012 迁移不含 score / evidence / attempt 字段', () => {
    const raw = readFileSync(
      resolve(process.cwd(), 'server/db/migrations/0012_material_import.sql'),
      'utf8'
    )
    // 只看 DDL 本身：注释里可以解释「为什么没有这些列」。
    const sql = raw.replace(/--[^\n]*/g, '')
    expect(/\bscore\b/i.test(sql)).toBe(false)
    expect(/\bevidence\b/i.test(sql)).toBe(false)
    expect(/\battempt\b/i.test(sql)).toBe(false)
  })

  it('草稿存的是 llm_inference provenance，永不为 evidence', async () => {
    const { service, store } = makeService()
    const view = await createJob(service)
    const stored = store.getDraft(view.drafts[0]!.id)
    expect(stored?.provenance.kind).toBe('llm_inference')

    confirmWithAnswer(service, view.drafts[0]!)
    const after = store.getDraft(view.drafts[0]!.id)
    expect(after?.provenance.kind).toBe('teacher_annotation')
  })
})
