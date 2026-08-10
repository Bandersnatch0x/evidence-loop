// @vitest-environment node

/**
 * T22 媒体/转写 → 闪卡草稿 · 教师校对闸门。
 *
 * 断言的四件事（ADR-0001 / PRD 验收）：
 *   1. 生成物 provenance = llm_inference，且生成不写题库；
 *   2. 正面溯源红线：LLM 编造材料外概念的 front 被剔除，模板 front 恒可溯源；
 *   3. 未确认草稿不可作答 / 不可布置（硬闸门，assessment-ref → 422）；
 *   4. 原文只落 sha256，不落全文（PII 收敛）；LLM 路径不碰计分表。
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createFlashcardDraftGenerator,
  FlashcardDraftGateError,
  FlashcardDraftService,
  FlashcardDraftStore,
  isWebVtt,
  parseWebVtt,
  pickTermCandidates,
  TEMPLATE_FLASHCARD_COUNT,
  TEMPLATE_FLASHCARD_MODEL,
  tryHandleFlashcardDraftRoute,
  type FlashcardDraftRouteContext
} from '../server/flashcardDraft'
import {
  isFlashcardReady,
  verifyFrontIsGrounded,
  type FlashcardDraft
} from '../shared/flashcardDraft'
import { QuestionBankService } from '../server/questionbank/QuestionBankService'
import { QuestionStore } from '../server/questionbank/QuestionStore'
import type { SessionUser } from '../server/auth/SessionProvider'

const TEACHER = 'teacher-flashcard-alpha'
const OTHER = 'teacher-flashcard-beta'
const BANK = 'bank-flashcard-1'
const FIXED_NOW = () => new Date('2026-08-07T09:00:00.000Z')

/** 50+ 字的课堂转写样例（> MIN_RAW_TEXT_CHARS=20）。 */
const TRANSCRIPT = [
  '今天这节课我们讲一元一次方程。',
  '一元一次方程是只含有一个未知数，且未知数次数为 1 的整式方程。',
  '解方程的基本步骤：去分母、去括号、移项、合并同类项、系数化为一。',
  '例：2(x+1)=6，去括号得 2x+2=6，移项得 2x=4，故 x=2。',
  '这个例子里 x=2 就是方程的解，代入验证两边相等。'
].join('\n')

function makeService(environment: NodeJS.ProcessEnv = {}) {
  const database = new Database(':memory:')
  const store = new FlashcardDraftStore({ database })
  const questions = new QuestionStore({ database })
  const bank = new QuestionBankService({ store: questions, now: FIXED_NOW })
  const service = new FlashcardDraftService({
    store,
    questionBank: bank,
    generator: createFlashcardDraftGenerator({ ...environment, LLM_API_KEY: '' }),
    now: FIXED_NOW,
    environment
  })
  return { service, store, bank, questions }
}

async function createJob(service: FlashcardDraftService, teacherId = TEACHER) {
  return service.createJob({
    teacherId,
    questionBankId: BANK,
    subject: 'math',
    rawText: TRANSCRIPT,
    noStudentSpeechDeclaration: true
  })
}

/** 教师补全背面解释后确认（模板草稿刻意留空 back）。 */
function confirmWithBack(
  service: FlashcardDraftService,
  draft: FlashcardDraft,
  teacherId = TEACHER
) {
  return service.confirmFlashcard(draft.id, teacherId, {
    back: '只含一个未知数且未知数次数为 1 的整式方程'
  })
}

function startServer(
  service: FlashcardDraftService,
  user: SessionUser
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
    const context: FlashcardDraftRouteContext = {
      flashcardDraft: service,
      user
    }
    void tryHandleFlashcardDraftRoute(
      request,
      response,
      requestUrl,
      context
    ).then((handled) => {
      if (!handled) response.writeHead(404).end('not mine')
    })
  })
  return new Promise((resolveServer) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      const entry = {
        url: `http://127.0.0.1:${String(port)}`,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done())
          })
      }
      servers.push(entry)
      resolveServer(entry)
    })
  })
}

const servers: Array<{ close: () => Promise<void> }> = []

afterEach(async () => {
  while (servers.length > 0) await servers.pop()?.close()
})

function teacherUser(userId = TEACHER): SessionUser {
  return { userId, role: 'teacher', displayName: 'T' }
}

// ---------------------------------------------------------------------------
// 1. 生成：provenance = llm_inference，且不写题库
// ---------------------------------------------------------------------------

describe('媒体/转写 → 闪卡草稿生成 (T22)', () => {
  it('无 LLM key 时模板降级固定产出 2 张，全部标 llm_inference 且 back 留空', async () => {
    const { service } = makeService()
    const view = await createJob(service)

    expect(view.job.degraded).toBe(true)
    expect(view.job.generatorModel).toBe(TEMPLATE_FLASHCARD_MODEL)
    expect(view.drafts).toHaveLength(TEMPLATE_FLASHCARD_COUNT)
    for (const draft of view.drafts) {
      expect(draft.provenance.kind).toBe('llm_inference')
      expect(draft.status).toBe('draft')
      expect(draft.back).toBe('')
      expect(draft.confirmedQuestionId).toBeUndefined()
    }
  })

  it('生成不写题库：createJob 之后题库仍为空', async () => {
    const { service, bank } = makeService()
    await createJob(service)
    expect(bank.list(TEACHER, { questionBankId: BANK })).toHaveLength(0)
  })

  it('原文只落 sha256，不落全文（PII 收敛）', async () => {
    const { service } = makeService()
    const view = await createJob(service)
    expect(view.job.rawTextHash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(view.job)).not.toContain('一元一次方程')
  })

  it('模板草稿 back 为空 → isFlashcardReady 为 false（闸门真实触发）', async () => {
    const { service } = makeService()
    const view = await createJob(service)
    for (const draft of view.drafts) {
      expect(isFlashcardReady(draft)).toBe(false)
    }
  })

  it('材料过短被拒', async () => {
    const { service } = makeService()
    await expect(
      service.createJob({
        teacherId: TEACHER,
        questionBankId: BANK,
        subject: 'math',
        rawText: '太短',
        noStudentSpeechDeclaration: true
      })
    ).rejects.toThrow(/过短/)
  })

  it('音频路径默认关闭（feature flag）', async () => {
    const { service } = makeService()
    await expect(
      service.createAudioJob({
        teacherId: TEACHER,
        questionBankId: BANK,
        subject: 'math',
        transcript: TRANSCRIPT,
        noStudentSpeechDeclaration: true,
        durationSeconds: 60
      })
    ).rejects.toThrow(/未开启/)
  })

  it('audioBase64 在无真实 STT 时拒绝（不编造转写）', async () => {
    const { service } = makeService({ FLASHCARD_AUDIO_ENABLED: 'true' })
    await expect(
      service.createAudioJob({
        teacherId: TEACHER,
        questionBankId: BANK,
        subject: 'math',
        audioBase64: 'AAAA',
        noStudentSpeechDeclaration: true,
        durationSeconds: 60
      })
    ).rejects.toThrow(/真实 STT|transcript/)
  })
})

// ---------------------------------------------------------------------------
// 2. 正面溯源红线：LLM 不得编造材料外的概念
// ---------------------------------------------------------------------------

describe('正面溯源红线 (T22)', () => {
  it('front 是原文中的连续概念 → grounded', () => {
    expect(verifyFrontIsGrounded('一元一次方程', TRANSCRIPT)).toBe(true)
  })

  it('front 是材料外编造的概念 → 不通过', () => {
    expect(verifyFrontIsGrounded('量子纠缠', TRANSCRIPT)).toBe(false)
    expect(verifyFrontIsGrounded('黑格尔辩证法', TRANSCRIPT)).toBe(false)
  })

  it('模板 front 直接抽取原文 → 恒可溯源', () => {
    const candidates = pickTermCandidates(TRANSCRIPT, 2)
    expect(candidates.length).toBeGreaterThan(0)
    for (const candidate of candidates) {
      expect(verifyFrontIsGrounded(candidate.term, TRANSCRIPT)).toBe(true)
    }
  })

  it('WebVTT 字幕可解析为纯文本', () => {
    const vtt = [
      'WEBVTT',
      '',
      '00:00:00.000 --> 00:00:03.000',
      '今天我们讲一元一次方程。',
      '',
      '00:00:03.000 --> 00:00:08.000',
      '它只含有一个未知数。'
    ].join('\n')
    expect(isWebVtt(vtt)).toBe(true)
    const parsed = parseWebVtt(vtt)
    expect(parsed.cueCount).toBe(2)
    expect(parsed.text).toContain('一元一次方程')
  })
})

// ---------------------------------------------------------------------------
// 3. 校对闸门：未确认不可入库 / 不可布置
// ---------------------------------------------------------------------------

describe('教师校对闸门 (T22)', () => {
  it('未填 back 的草稿不可确认（答案权威只能来自教师）', async () => {
    const { service, bank } = makeService()
    const view = await createJob(service)
    const draft = view.drafts[0]!

    expect(() => service.confirmFlashcard(draft.id, TEACHER)).toThrow(
      FlashcardDraftGateError
    )
    expect(bank.list(TEACHER, { questionBankId: BANK })).toHaveLength(0)
  })

  it('未确认草稿不可用于测评（resolveAssessmentQuestionId 抛闸门错误）', async () => {
    const { service } = makeService()
    const view = await createJob(service)
    const draft = view.drafts[0]!

    expect(service.isFlashcardAssessable(draft)).toBe(false)
    expect(() => service.resolveAssessmentQuestionId(draft.id, TEACHER)).toThrow(
      FlashcardDraftGateError
    )
  })

  it('教师补全 back 确认后才入库，provenance 升级为 teacher_annotation', async () => {
    const { service, bank } = makeService()
    const view = await createJob(service)
    const draft = view.drafts[0]!

    const result = confirmWithBack(service, draft)

    expect(result.flashcard.status).toBe('confirmed')
    expect(result.flashcard.provenance.kind).toBe('teacher_annotation')
    expect(result.question.id).toBe(result.flashcard.confirmedQuestionId)
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
    const saveFlashcard = store.saveFlashcard.bind(store)
    vi.spyOn(store, 'saveFlashcard').mockImplementation((candidate) => {
      if (candidate.status === 'confirmed') {
        throw new Error('simulated confirmation write failure')
      }
      saveFlashcard(candidate)
    })

    expect(() => confirmWithBack(service, draft)).toThrow(
      /simulated confirmation write failure/
    )
    expect(bank.list(TEACHER, { questionBankId: BANK })).toHaveLength(0)
    expect(store.getFlashcard(draft.id)?.status).toBe('draft')
  })

  it('丢弃草稿不产生任何 Question，且此后不可确认', async () => {
    const { service, bank } = makeService()
    const view = await createJob(service)
    const draft = view.drafts[1]!

    const discarded = service.discardFlashcard(draft.id, TEACHER)
    expect(discarded.flashcard.status).toBe('discarded')
    expect(bank.list(TEACHER, { questionBankId: BANK })).toHaveLength(0)
    expect(() => confirmWithBack(service, draft)).toThrow(
      FlashcardDraftGateError
    )
  })

  it('归属校验：其他教师不可读、不可确认他人草稿', async () => {
    const { service } = makeService()
    const view = await createJob(service)
    const draft = view.drafts[0]!

    expect(() => service.getFlashcard(draft.id, OTHER)).toThrow(/Forbidden/)
    expect(() => confirmWithBack(service, draft, OTHER)).toThrow(/Forbidden/)
  })
})

// ---------------------------------------------------------------------------
// 4. HTTP 端点
// ---------------------------------------------------------------------------

describe('闪卡草稿 HTTP 端点 (T22)', () => {
  it('字幕入口缺少无学生发言声明时拒绝生成', async () => {
    const { service } = makeService()
    const server = await startServer(service, teacherUser())
    const response = await fetch(
      `${server.url}/api/teacher/flashcard-drafts`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          questionBankId: BANK,
          subject: 'math',
          rawText: TRANSCRIPT
        })
      }
    )

    expect(response.status).toBe(400)
  })

  it('POST 创建任务返回 201 + 草稿 + 闸门声明，且不入题库', async () => {
    const { service, bank } = makeService()
    const server = await startServer(service, teacherUser())

    const response = await fetch(`${server.url}/api/teacher/flashcard-drafts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        questionBankId: BANK,
        subject: 'math',
        rawText: TRANSCRIPT,
        noStudentSpeechDeclaration: true
      })
    })
    const body = (await response.json()) as {
      job: { id: string; status: string }
      drafts: FlashcardDraft[]
      gateNotice: string
      publishedToQuestionBank: boolean
      requiresTeacherConfirmation: boolean
    }
    expect(response.status).toBe(201)
    expect(body.job.status).toBe('generated')
    expect(body.drafts).toHaveLength(TEMPLATE_FLASHCARD_COUNT)
    expect(body.gateNotice).toContain('llm_inference')
    expect(body.publishedToQuestionBank).toBe(false)
    expect(body.requiresTeacherConfirmation).toBe(true)
    expect(bank.list(TEACHER, { questionBankId: BANK })).toHaveLength(0)
  })

  it('未确认草稿的 assessment-ref → 422（硬闸门，不是提示）', async () => {
    const { service } = makeService()
    const server = await startServer(service, teacherUser())
    const view = await createJob(service)
    const draft = view.drafts[0]!

    const response = await fetch(
      `${server.url}/api/teacher/flashcard-drafts/flashcards/${draft.id}/assessment-ref`
    )
    expect(response.status).toBe(422)
  })

  it('确认后 assessment-ref → 200 + questionId', async () => {
    const { service } = makeService()
    const server = await startServer(service, teacherUser())
    const view = await createJob(service)
    const draft = view.drafts[0]!
    const result = confirmWithBack(service, draft)

    const response = await fetch(
      `${server.url}/api/teacher/flashcard-drafts/flashcards/${draft.id}/assessment-ref`
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as { questionId: string }
    expect(body.questionId).toBe(result.question.id)
  })

  it('学生身份访问 → 403', async () => {
    const { service } = makeService()
    const server = await startServer(service, {
      userId: 'student-flashcard-1',
      role: 'student',
      displayName: 'S',
      studentId: 'student-flashcard-1'
    })
    const response = await fetch(`${server.url}/api/teacher/flashcard-drafts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        questionBankId: BANK,
        subject: 'math',
        rawText: TRANSCRIPT
      })
    })
    expect(response.status).toBe(403)
  })

  it('音频端点未开启 → 501', async () => {
    const { service } = makeService()
    const server = await startServer(service, teacherUser())
    const response = await fetch(
      `${server.url}/api/teacher/flashcard-drafts/audio`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          questionBankId: BANK,
          subject: 'math',
          transcript: TRANSCRIPT,
          noStudentSpeechDeclaration: true,
          durationSeconds: 60
        })
      }
    )
    expect(response.status).toBe(501)
  })
})
