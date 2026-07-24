// @vitest-environment node

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type {
  Attempt,
  EvaluationResult,
  Provenance,
  StandardSolution,
  TutoringMessage,
  TutoringResponse
} from '../shared/contracts'
import {
  countLowEffortStreak,
  createTutoringService,
  DialogueGenerator,
  ExplainGenerator,
  handleTutoringApi,
  HELP_ABUSE_THRESHOLD,
  SocraticGenerator,
  trimHistory,
  TutoringService
} from '../server/tutoring'
import { JsonAttemptStore } from '../server/store/AttemptStore'

function makeEvaluation(overrides: Partial<EvaluationResult> = {}): EvaluationResult {
  const provenance: Provenance = {
    kind: 'evidence',
    evidenceIds: ['ev-1'],
    algorithm: 'simple.v1'
  }
  return {
    id: 'eval-1',
    assignmentId: 'math-quad',
    attempt: 1,
    createdAt: '2026-07-24T00:00:00.000Z',
    status: 'completed',
    score: 40,
    summary: '部分证据未通过',
    evidence: [
      {
        id: 'ev-1',
        kind: 'answer_match',
        label: '展开结果',
        dimensionId: 'correctness',
        visibility: 'public',
        state: 'failed',
        weight: 60,
        expected: 'x^2+2x+1',
        actual: 'x^2+1',
        message: '交叉项 2x 缺失',
        source: 'test_case'
      },
      {
        id: 'ev-2',
        kind: 'answer_match',
        label: '格式',
        dimensionId: 'format',
        visibility: 'public',
        state: 'passed',
        weight: 40,
        message: '格式正确',
        source: 'test_case'
      }
    ],
    dimensions: [
      {
        id: 'correctness',
        label: '正确性',
        description: '结果正确',
        maxScore: 60,
        earnedScore: 0,
        state: 'failed',
        evidenceIds: ['ev-1']
      }
    ],
    diagnoses: [
      {
        conceptId: 'kp.math.expand',
        title: '完全平方展开',
        explanation: '交叉项漏写',
        severity: 'high',
        evidenceIds: ['ev-1']
      }
    ],
    trace: [],
    mastery: [],
    feedbackSource: 'local-policy',
    provenance,
    studentId: 'student-a',
    ...overrides
  }
}

function makeAttempt(mode: 'practice' | 'assessment', id = 'attempt-1'): Attempt {
  const result = makeEvaluation({ id })
  return {
    id,
    studentId: 'student-a',
    questionId: 'math-quad',
    teachingUnitId: 'tu-1',
    termId: 'term-1',
    mode,
    createdAt: result.createdAt,
    result
  }
}

const solution: StandardSolution = {
  content: '用完全平方公式：(x+1)^2 = x^2 + 2x + 1。',
  latex: 'x^2+2x+1',
  keyPoints: ['识别完全平方', '交叉项 2·x·1'],
  authorId: 'teacher-1',
  source: 'authored'
}

describe('ExplainGenerator (template / RAG)', () => {
  it('uses standard solution when present (RAG restate)', async () => {
    const gen = new ExplainGenerator(null)
    const attempt = makeAttempt('practice')
    const result = await gen.generate({
      context: {
        assignment: {
          id: 'math-quad',
          title: '完全平方',
          module: '代数',
          language: 'math',
          questionType: 'expression',
          estimatedMinutes: 10,
          status: 'ready',
          objective: '展开',
          scenario: '',
          requirements: [],
          constraints: [],
          functionSignature: '',
          rubric: [],
          demoVariants: [],
          criteria: [],
          runner: { kind: 'expression', expectedLatex: '(x+1)^2' }
        },
        score: attempt.result.score,
        evidence: attempt.result.evidence,
        diagnoses: attempt.result.diagnoses
      },
      mode: 'practice',
      solution
    })
    expect(result.source).toBe('local-policy')
    expect(result.content).toContain('完全平方')
    expect(result.content).toContain('标准解析')
    expect(result.disclaimer).toBeDefined()
  })

  it('degrades without solution', async () => {
    const gen = new ExplainGenerator(null)
    const attempt = makeAttempt('practice')
    const result = await gen.generate({
      context: {
        assignment: {
          id: 'math-quad',
          title: '完全平方',
          module: '代数',
          language: 'math',
          questionType: 'expression',
          estimatedMinutes: 10,
          status: 'ready',
          objective: '展开',
          scenario: '',
          requirements: [],
          constraints: [],
          functionSignature: '',
          rubric: [],
          demoVariants: [],
          criteria: [],
          runner: { kind: 'expression', expectedLatex: '(x+1)^2' }
        },
        score: 40,
        evidence: attempt.result.evidence,
        diagnoses: attempt.result.diagnoses
      },
      mode: 'practice'
    })
    expect(result.content).toContain('完全平方展开')
    expect(result.disclaimer).toMatch(/可能有误|仅供/)
  })
})

describe('SocraticGenerator (help-abuse + isomorphic)', () => {
  it('refuses after consecutive low-effort requests', async () => {
    const gen = new SocraticGenerator(null)
    const attempt = makeAttempt('practice')
    const ctx = {
      assignment: {
        id: 'math-quad',
        title: '完全平方',
        module: '代数',
        language: 'math' as const,
        questionType: 'expression' as const,
        estimatedMinutes: 10,
        status: 'ready' as const,
        objective: '展开',
        scenario: '',
        requirements: [],
        constraints: [],
        functionSignature: '',
        rubric: [],
        demoVariants: [],
        criteria: [],
        runner: { kind: 'expression' as const, expectedLatex: '(x+1)^2' }
      },
      score: 40,
      evidence: attempt.result.evidence,
      diagnoses: attempt.result.diagnoses
    }

    const result = await gen.generate({
      context: ctx,
      mode: 'practice',
      message: '提示',
      history: [
        { role: 'user', content: '提示' },
        { role: 'assistant', content: '先想想交叉项' },
        { role: 'user', content: '提示' },
        { role: 'assistant', content: '再试一步' }
      ],
      lowEffortStreak: HELP_ABUSE_THRESHOLD
    })
    expect(result.content).toMatch(/连续多次|卡在哪一步/)
  })

  it('countLowEffortStreak counts trailing user hints', () => {
    expect(
      countLowEffortStreak(
        [
          { role: 'user', content: '提示' },
          { role: 'assistant', content: '…' },
          { role: 'user', content: '答案' }
        ],
        '提示'
      )
    ).toBeGreaterThanOrEqual(2)
  })

  it('trimHistory keeps a rolling window', () => {
    const turns: Array<{ role: 'user' | 'assistant'; content: string }> =
      Array.from({ length: 10 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `t${String(i)}`
      }))
    expect(trimHistory(turns, 4)).toHaveLength(4)
    expect(trimHistory(turns, 4)[0]?.content).toBe('t6')
  })
})

describe('DialogueGenerator', () => {
  it('answers with template when LLM is offline', async () => {
    const gen = new DialogueGenerator(null)
    const attempt = makeAttempt('practice')
    const result = await gen.generate({
      context: {
        assignment: {
          id: 'math-quad',
          title: '完全平方',
          module: '代数',
          language: 'math',
          questionType: 'expression',
          estimatedMinutes: 10,
          status: 'ready',
          objective: '展开',
          scenario: '',
          requirements: [],
          constraints: [],
          functionSignature: '',
          rubric: [],
          demoVariants: [],
          criteria: [],
          runner: { kind: 'expression', expectedLatex: '(x+1)^2' }
        },
        score: 40,
        evidence: attempt.result.evidence,
        diagnoses: attempt.result.diagnoses
      },
      mode: 'practice',
      message: '为什么需要交叉项？',
      history: [{ role: 'user', content: '交叉项是什么' }],
      solution
    })
    expect(result.source).toBe('local-policy')
    expect(result.content.length).toBeGreaterThan(10)
    expect(result).not.toHaveProperty('score')
    expect(result).not.toHaveProperty('evidence')
  })
})

describe('TutoringService mode gates (D1)', () => {
  let store: JsonAttemptStore

  beforeEach(async () => {
    store = new JsonAttemptStore(':memory:')
    await store.saveAttempt(makeAttempt('practice', 'att-practice'))
    await store.saveAttempt(makeAttempt('assessment', 'att-assess'))
  })

  it('allows all three layers in practice mode', async () => {
    const service = new TutoringService({ store })
    const explain = await service.handle({
      attemptId: 'att-practice',
      mode: 'practice',
      layer: 'explain',
      solution
    })
    expect(explain.message.layer).toBe('explain')
    expect(explain.message.provenance.kind).toBe('llm_inference')
    expect(explain.message).not.toHaveProperty('score')
    expect(explain.message).not.toHaveProperty('evidence')

    const socratic = await service.handle({
      attemptId: 'att-practice',
      mode: 'practice',
      layer: 'socratic',
      message: '我卡在交叉项'
    })
    expect(socratic.message.layer).toBe('socratic')

    const dialogue = await service.handle({
      attemptId: 'att-practice',
      mode: 'practice',
      layer: 'dialogue',
      message: '交叉项怎么来的？'
    })
    expect(dialogue.message.layer).toBe('dialogue')
  })

  it('rejects socratic/dialogue in assessment mode', async () => {
    const service = createTutoringService(store)
    await expect(
      service.handle({
        attemptId: 'att-assess',
        mode: 'assessment',
        layer: 'socratic',
        message: '提示'
      })
    ).rejects.toThrow(/practice mode/)

    await expect(
      service.handle({
        attemptId: 'att-assess',
        mode: 'assessment',
        layer: 'dialogue',
        message: '为什么'
      })
    ).rejects.toThrow(/practice mode/)
  })

  it('allows explain after completed assessment submit', async () => {
    const service = createTutoringService(store)
    const explain = await service.handle({
      attemptId: 'att-assess',
      mode: 'assessment',
      layer: 'explain',
      solution
    })
    expect(explain.message.layer).toBe('explain')
    expect(explain.allowedMode).toBe('assessment')
  })

  it('rejects mode mismatch between client and attempt', async () => {
    const service = createTutoringService(store)
    await expect(
      service.handle({
        attemptId: 'att-practice',
        mode: 'assessment',
        layer: 'explain'
      })
    ).rejects.toThrow(/mode mismatch/)
  })

  it('stamps TutoringMessage as llm_inference never evidence', async () => {
    const service = createTutoringService(store)
    const { message } = await service.handle({
      attemptId: 'att-practice',
      mode: 'practice',
      layer: 'explain'
    })
    const msg: TutoringMessage = message
    expect(msg.provenance.kind).toBe('llm_inference')
    type Forbidden = Extract<keyof TutoringMessage, 'score' | 'evidence' | 'weight'>
    const noScoreChannel: Forbidden extends never ? true : false = true
    expect(noScoreChannel).toBe(true)
  })
})

describe('POST /api/tutoring/* HTTP', () => {
  let store: JsonAttemptStore
  let server: Server
  let baseUrl: string
  let closeServer: () => Promise<void>

  beforeEach(async () => {
    store = new JsonAttemptStore(':memory:')
    await store.saveAttempt(makeAttempt('practice', 'att-practice'))
    await store.saveAttempt(makeAttempt('assessment', 'att-assess'))
    const tutoring = createTutoringService(store)

    server = createServer((request, response) => {
      void (async () => {
        const url = new URL(
          request.url ?? '/',
          `http://${request.headers.host ?? 'localhost'}`
        )
        const handled = await handleTutoringApi(request, response, url, {
          tutoring,
          user: {
            userId: 'student-a',
            role: 'student',
            displayName: 'Student A',
            studentId: 'student-a'
          }
        })
        if (!handled) {
          response.writeHead(404)
          response.end('not tutoring')
        }
      })()
    })

    await new Promise<void>((resolvePromise) => {
      server.listen(0, '127.0.0.1', () => resolvePromise())
    })
    const address = server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${String(address.port)}`
    closeServer = () =>
      new Promise((resolvePromise, reject) => {
        server.close((error) => (error ? reject(error) : resolvePromise()))
      })
  })

  afterEach(async () => {
    await closeServer()
  })

  it('POST /api/tutoring/explain returns llm_inference message', async () => {
    const response = await fetch(`${baseUrl}/api/tutoring/explain`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        attemptId: 'att-practice',
        mode: 'practice',
        solution
      })
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as TutoringResponse
    expect(body.layer).toBe('explain')
    expect(body.message.provenance.kind).toBe('llm_inference')
    expect(body.message.content.length).toBeGreaterThan(10)
  })

  it('POST /api/tutoring/socratic rejects assessment', async () => {
    const response = await fetch(`${baseUrl}/api/tutoring/socratic`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        attemptId: 'att-assess',
        mode: 'assessment',
        message: '提示'
      })
    })
    expect(response.status).toBe(403)
  })

  it('POST /api/tutoring/dialogue works in practice', async () => {
    const response = await fetch(`${baseUrl}/api/tutoring/dialogue`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        attemptId: 'att-practice',
        mode: 'practice',
        message: '交叉项从哪来？',
        history: [{ role: 'user', content: '我不会展开' }]
      })
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as TutoringResponse
    expect(body.layer).toBe('dialogue')
    expect(body.message.role).toBe('assistant')
  })

  it('returns 404 for missing attempt', async () => {
    const response = await fetch(`${baseUrl}/api/tutoring/explain`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        attemptId: 'missing',
        mode: 'practice'
      })
    })
    expect(response.status).toBe(404)
  })
})


