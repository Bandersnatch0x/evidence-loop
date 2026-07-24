// @vitest-environment node

import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { MockSessionProvider } from '../server/auth/MockSessionProvider'
import {
  createOcrProvider,
  createQuestionSplitter,
  ImportDraftStore,
  ImportGateError,
  ImportService,
  IMPORT_PRIVACY_NOTICE,
  isOcrEgressAllowed,
  LocalHeuristicQuestionSplitter,
  MathpixProvider,
  MockOcrProvider,
  resolveOcrProviderName,
  tryHandleImportRoute
} from '../server/import'
import { QuestionBankService } from '../server/questionbank/QuestionBankService'
import { QuestionStore } from '../server/questionbank/QuestionStore'

const TEACHER = 'teacher-import-alpha'
const OTHER = 'teacher-import-beta'
const FIXED_NOW = () => new Date('2026-07-24T12:00:00.000Z')

const SAMPLE_PAPER = [
  '1. 化简 2(x+1) 等于？',
  'A. 2x+1',
  'B. 2x+2',
  'C. x+2',
  'D. 2x',
  '答案：B',
  '',
  '2. 计算 3+5 的结果。',
  '答案：8'
].join('\n')

function makeService(env: NodeJS.ProcessEnv = {}) {
  // Separate in-memory DBs are fine; both apply migrations independently.
  const store = new ImportDraftStore({ dbPath: ':memory:' })
  const questions = new QuestionStore({ dbPath: ':memory:' })
  const bank = new QuestionBankService({ store: questions, now: FIXED_NOW })
  const service = new ImportService({
    store,
    questionBank: bank,
    ocr: new MockOcrProvider(),
    splitter: new LocalHeuristicQuestionSplitter(),
    now: FIXED_NOW,
    environment: env
  })
  return { service, store, bank, questions }
}

describe('OCR provider switch (T10)', () => {
  it('defaults to mock', () => {
    expect(resolveOcrProviderName({})).toBe('mock')
  })

  it('createOcrProvider(mock) returns MockOcrProvider', () => {
    const provider = createOcrProvider({ OCR_PROVIDER: 'mock' })
    expect(provider.name).toBe('mock')
  })

  it('Mathpix requires OCR_ALLOW_EGRESS=true', () => {
    expect(() => new MathpixProvider({})).toThrow(/OCR_ALLOW_EGRESS/)
    expect(isOcrEgressAllowed({ OCR_ALLOW_EGRESS: 'true' })).toBe(true)
    expect(() => new MathpixProvider({ OCR_ALLOW_EGRESS: 'true' })).not.toThrow()
  })

  it('Mathpix skeleton still rejects recognize()', async () => {
    const provider = new MathpixProvider({ OCR_ALLOW_EGRESS: 'true' })
    await expect(
      provider.recognize({
        bytes: Buffer.from('x'),
        egressClass: 'L1'
      })
    ).rejects.toThrow(/skeleton/)
  })

  it('Mock OCR never egresses and returns fixture text', async () => {
    const provider = new MockOcrProvider()
    const result = await provider.recognize({
      bytes: Buffer.from('binary-image'),
      egressClass: 'L1'
    })
    expect(result.egressUsed).toBe(false)
    expect(result.text).toContain('化简')
  })
})

describe('LocalHeuristicQuestionSplitter', () => {
  it('splits numbered items into draft candidates with llm_inference provenance', async () => {
    const splitter = new LocalHeuristicQuestionSplitter()
    const items = await splitter.split({
      rawText: SAMPLE_PAPER,
      subject: 'math',
      sourceLabel: 'test'
    })
    expect(items.length).toBeGreaterThanOrEqual(2)
    expect(items[0]?.questionType).toBe('choice')
    expect(items[0]?.options?.length).toBe(4)
    expect(items[0]?.provenance.kind).toBe('llm_inference')
    expect(items[0]?.status === 'pending' || items[0]?.status === 'low_confidence').toBe(
      true
    )
    expect(items[1]?.questionType).toBe('numeric')
  })

  it('createQuestionSplitter stays local without LLM egress flags', () => {
    const splitter = createQuestionSplitter({})
    expect(splitter).toBeInstanceOf(LocalHeuristicQuestionSplitter)
  })
})

describe('ImportService D2 human gate', () => {
  let service: ImportService
  let bank: QuestionBankService
  let questions: QuestionStore
  let store: ImportDraftStore

  afterEach(() => {
    questions.close()
    store.close()
  })

  it('parseDocument creates pending_review draft and never writes questions', async () => {
    ;({ service, bank, questions, store } = makeService())
    const draft = await service.parseDocument({
      authorId: TEACHER,
      questionBankId: 'bank-import-1',
      subject: 'math',
      filename: 'paper.txt',
      rawText: SAMPLE_PAPER
    })

    expect(draft.status).toBe('pending_review')
    expect(draft.confirmedQuestionIds).toEqual([])
    expect(draft.privacyNotice).toContain('手写签名')
    expect(draft.egressClass).toBe('L1')
    expect(service.isUsableForAssessment(draft)).toBe(false)
    expect(bank.list(TEACHER)).toHaveLength(0)
    expect(draft.items.every((item) => item.provenance.kind === 'llm_inference')).toBe(
      true
    )
  })

  it('unconfirmed drafts cannot enter 测评态', async () => {
    ;({ service, bank, questions, store } = makeService())
    const draft = await service.parseDocument({
      authorId: TEACHER,
      questionBankId: 'bank-import-1',
      subject: 'math',
      filename: 'paper.txt',
      rawText: SAMPLE_PAPER
    })
    expect(service.isUsableForAssessment(draft)).toBe(false)
    expect(bank.list(TEACHER)).toHaveLength(0)
  })

  it('confirm promotes teacher-corrected items into QuestionBank as authored_key', async () => {
    ;({ service, bank, questions, store } = makeService())
    const draft = await service.parseDocument({
      authorId: TEACHER,
      questionBankId: 'bank-import-1',
      subject: 'math',
      filename: 'paper.txt',
      rawText: SAMPLE_PAPER
    })

    const result = service.confirmDraft({
      draftId: draft.id,
      authorId: TEACHER,
      items: [
        {
          index: 0,
          action: 'confirm',
          stem: '化简 2(x+1) 等于？（老师校对）',
          questionType: 'choice',
          payload: { kind: 'choice', correctOptionIds: ['B'] },
          kpIds: ['kp.math.algebra.simplify'],
          difficulty: 2
        },
        {
          index: 1,
          action: 'confirm',
          stem: '计算 3+5',
          questionType: 'numeric',
          payload: { kind: 'numeric', expected: 8, tolerance: 0 },
          kpIds: ['kp.math.arithmetic'],
          difficulty: 1
        }
      ]
    })

    expect(result.questions).toHaveLength(2)
    expect(result.draft.status).toBe('confirmed')
    expect(result.draft.confirmedQuestionIds).toHaveLength(2)
    expect(service.isUsableForAssessment(result.draft)).toBe(true)
    expect(bank.list(TEACHER)).toHaveLength(2)
    expect(result.questions[0]?.source).toBe('authored_key')
    expect(result.questions[0]?.stem).toContain('老师校对')
  })

  it('partial confirm + skip yields partially_confirmed', async () => {
    ;({ service, bank, questions, store } = makeService())
    const draft = await service.parseDocument({
      authorId: TEACHER,
      questionBankId: 'bank-import-1',
      subject: 'math',
      filename: 'paper.txt',
      rawText: SAMPLE_PAPER
    })

    const result = service.confirmDraft({
      draftId: draft.id,
      authorId: TEACHER,
      items: [
        {
          index: 0,
          action: 'confirm',
          stem: '化简 2(x+1)',
          questionType: 'choice',
          payload: { kind: 'choice', correctOptionIds: ['B'] },
          kpIds: ['kp.math.algebra.simplify'],
          difficulty: 2
        },
        { index: 1, action: 'skip' }
      ]
    })

    expect(result.draft.status).toBe('partially_confirmed')
    expect(result.questions).toHaveLength(1)
    expect(bank.list(TEACHER)).toHaveLength(1)
  })

  it('refuses confirm when teacher omits a valid answer payload', async () => {
    ;({ service, bank, questions, store } = makeService())
    const draft = await service.parseDocument({
      authorId: TEACHER,
      questionBankId: 'bank-import-1',
      subject: 'math',
      filename: 'paper.txt',
      rawText: '1. 空白题无答案'
    })
    // Explicit empty payload must fail validation at the gate (not silent publish).
    expect(() =>
      service.confirmDraft({
        draftId: draft.id,
        authorId: TEACHER,
        items: [
          {
            index: 0,
            action: 'confirm',
            stem: '空白题无答案',
            questionType: 'fill_blank',
            payload: { kind: 'fill_blank', acceptedAnswers: [] }
          }
        ]
      })
    ).toThrow(ImportGateError)
    expect(bank.list(TEACHER)).toHaveLength(0)
  })

  it('enforces teacher-private ownership on get/confirm', async () => {
    ;({ service, bank, questions, store } = makeService())
    const draft = await service.parseDocument({
      authorId: TEACHER,
      questionBankId: 'bank-import-1',
      subject: 'math',
      filename: 'paper.txt',
      rawText: SAMPLE_PAPER
    })
    expect(() => service.getDraft(draft.id, OTHER)).toThrow(/private/)
    expect(() =>
      service.confirmDraft({
        draftId: draft.id,
        authorId: OTHER,
        items: [{ index: 0, action: 'skip' }]
      })
    ).toThrow(/private/)
  })

  it('OCR image path uses MockOcrProvider and stays pending_review', async () => {
    ;({ service, bank, questions, store } = makeService())
    const draft = await service.parseDocument({
      authorId: TEACHER,
      questionBankId: 'bank-import-1',
      subject: 'math',
      filename: 'scan.png',
      bytes: Buffer.from('MOCK_OCR_TEXT:' + SAMPLE_PAPER),
      mimeType: 'image/png'
    })
    expect(draft.parseMethod).toBe('ocr')
    expect(draft.ocrProvider).toBe('mock')
    expect(draft.status).toBe('pending_review')
    expect(bank.list(TEACHER)).toHaveLength(0)
  })
})

describe('import HTTP routes', () => {
  it('POST parse → GET draft → POST confirm end-to-end', async () => {
    const questions = new QuestionStore({ dbPath: ':memory:' })
    const store = new ImportDraftStore({ dbPath: ':memory:' })
    const bank = new QuestionBankService({ store: questions, now: FIXED_NOW })
    const importService = new ImportService({
      store,
      questionBank: bank,
      ocr: new MockOcrProvider(),
      splitter: new LocalHeuristicQuestionSplitter(),
      now: FIXED_NOW
    })
    const sessions = new MockSessionProvider()
    // Force teacher role via header if Mock supports it; else resolve default.
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const user = sessions.resolve(req)
      // Demo mock may default to student — override for this suite by role header.
      const roleHeader = req.headers['x-demo-role']
      const effectiveUser =
        roleHeader === 'teacher'
          ? { ...user, role: 'teacher' as const, userId: TEACHER }
          : user
      void tryHandleImportRoute(req, res, url, {
        importService,
        user: effectiveUser
      }).then((handled) => {
        if (!handled) {
          res.writeHead(404)
          res.end('not found')
        }
      })
    })

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const { port } = server.address() as AddressInfo

    try {
      const parseRes = await fetch(`http://127.0.0.1:${String(port)}/api/import/parse`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-demo-role': 'teacher'
        },
        body: JSON.stringify({
          questionBankId: 'bank-http-1',
          subject: 'math',
          filename: 'unit.txt',
          rawText: SAMPLE_PAPER
        })
      })
      expect(parseRes.status).toBe(201)
      const parseBody = (await parseRes.json()) as {
        draft: { id: string; status: string }
        privacyNotice: string
        requiresTeacherConfirmation: boolean
      }
      expect(parseBody.requiresTeacherConfirmation).toBe(true)
      expect(parseBody.privacyNotice).toBe(IMPORT_PRIVACY_NOTICE)
      expect(parseBody.draft.status).toBe('pending_review')

      const getRes = await fetch(
        `http://127.0.0.1:${String(port)}/api/import/drafts/${parseBody.draft.id}`,
        { headers: { 'x-demo-role': 'teacher' } }
      )
      expect(getRes.status).toBe(200)
      const getBody = (await getRes.json()) as { usableForAssessment: boolean }
      expect(getBody.usableForAssessment).toBe(false)

      const confirmRes = await fetch(
        `http://127.0.0.1:${String(port)}/api/import/drafts/${parseBody.draft.id}/confirm`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-demo-role': 'teacher'
          },
          body: JSON.stringify({
            items: [
              {
                index: 0,
                action: 'confirm',
                stem: '化简 2(x+1)',
                questionType: 'choice',
                payload: { kind: 'choice', correctOptionIds: ['B'] },
                kpIds: ['kp.math.algebra.simplify'],
                difficulty: 2
              },
              { index: 1, action: 'skip' }
            ]
          })
        }
      )
      expect(confirmRes.status).toBe(200)
      const confirmBody = (await confirmRes.json()) as {
        questions: unknown[]
        usableForAssessment: boolean
        draft: { status: string }
      }
      expect(confirmBody.questions).toHaveLength(1)
      expect(confirmBody.usableForAssessment).toBe(true)
      expect(confirmBody.draft.status).toBe('partially_confirmed')
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      })
      questions.close()
      store.close()
    }
  })

  it('rejects non-teacher sessions with 403', async () => {
    const questions = new QuestionStore({ dbPath: ':memory:' })
    const store = new ImportDraftStore({ dbPath: ':memory:' })
    const bank = new QuestionBankService({ store: questions, now: FIXED_NOW })
    const importService = new ImportService({
      store,
      questionBank: bank,
      ocr: new MockOcrProvider(),
      splitter: new LocalHeuristicQuestionSplitter(),
      now: FIXED_NOW
    })
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      void tryHandleImportRoute(req, res, url, {
        importService,
        user: {
          userId: 'student-1',
          role: 'student',
          displayName: 'Stu',
          actorSource: 'demo'
        }
      }).then((handled) => {
        if (!handled) {
          res.writeHead(404)
          res.end()
        }
      })
    })
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const { port } = server.address() as AddressInfo
    try {
      const res = await fetch(`http://127.0.0.1:${String(port)}/api/import/parse`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          questionBankId: 'b',
          subject: 'math',
          filename: 'x.txt',
          rawText: '1. hi'
        })
      })
      expect(res.status).toBe(403)
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      })
      questions.close()
      store.close()
    }
  })
})
