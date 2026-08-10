// @vitest-environment node
/**
 * Direct tests for handleEvaluationApi — the C1 extraction's testable seam.
 * Fakes the store/agent/audit so the handler is exercised without booting
 * the full server (the serverApi suite covers it end-to-end; these pin the
 * seam contract directly).
 */
import { describe, expect, it, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleEvaluationApi } from '../server/domain/evaluationRoutes'
import type { EvaluationRouteContext } from '../server/domain/evaluationRoutes'
import type { EvaluationResult } from '../shared/contracts'
import { AuditStore } from '../server/audit/AuditStore'

function makeResponse(): {
  response: ServerResponse
  status: () => number
  body: () => unknown
} {
  let statusCode = 0
  let payload = ''
  const res = {
    writeHead: (code: number) => {
      statusCode = code
    },
    end: (data: string) => {
      payload = data
    }
  } as unknown as ServerResponse
  return {
    response: res,
    status: () => statusCode,
    body: () => (payload ? (JSON.parse(payload) as unknown) : undefined)
  }
}

function makeGetRequest(): IncomingMessage {
  return {
    method: 'GET',
    headers: {}
  } as unknown as IncomingMessage
}

function makePostRequest(body: unknown): IncomingMessage {
  const json = JSON.stringify(body)
  return {
    method: 'POST',
    headers: { 'content-length': String(Buffer.byteLength(json)) },
    [Symbol.asyncIterator]() {
      let done = false
      return {
        next(): Promise<IteratorResult<Buffer>> {
          if (done) return Promise.resolve({ done: true, value: undefined })
          done = true
          return Promise.resolve({ done: false, value: Buffer.from(json) })
        }
      }
    }
  } as unknown as IncomingMessage
}

function fakeEvaluation(overrides: Partial<EvaluationResult> = {}): EvaluationResult {
  return {
    id: 'eval-1',
    assignmentId: 'a1',
    attempt: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'completed',
    score: 80,
    summary: 'ok',
    evidence: [{ id: 'e1', kind: 'test', label: 'pass', dimensionId: 'd1', visibility: 'public', state: 'passed', weight: 1, message: 'ok', source: 'test_case' }],
    dimensions: [],
    diagnoses: [],
    trace: [],
    mastery: [],
    feedbackSource: 'local-policy',
    provenance: { kind: 'evidence', evidenceIds: ['e1'], algorithm: 'simple.v1' },
    ...overrides
  }
}

interface Spies {
  list: ReturnType<typeof vi.fn>
  save: ReturnType<typeof vi.fn>
  evaluate: ReturnType<typeof vi.fn>
  recomputeMastery: ReturnType<typeof vi.fn>
  applyReview: ReturnType<typeof vi.fn>
}

function fakeContext(): { context: EvaluationRouteContext; spies: Spies } {
  const list = vi.fn().mockResolvedValue([])
  const get = vi.fn().mockResolvedValue(undefined)
  const latest = vi.fn().mockResolvedValue(undefined)
  const save = vi.fn().mockResolvedValue(undefined)
  const del = vi.fn().mockResolvedValue(true)
  const getAttempt = vi.fn().mockResolvedValue(undefined)
  const saveAttempt = vi.fn().mockResolvedValue(undefined)
  const evaluate = vi.fn().mockResolvedValue(fakeEvaluation())
  const recomputeMastery = vi.fn().mockResolvedValue(undefined)
  const applyReview = vi.fn().mockReturnValue([])
  const projectAttempt = vi.fn().mockResolvedValue(undefined)
  const audit = new AuditStore({ dbPath: ':memory:', hmacSecret: 'eval-handler-hmac' })

  const context: EvaluationRouteContext = {
    store: { list, get, latest, save, delete: del, getAttempt, saveAttempt } as never,
    agent: { evaluate },
    runnerName: 'test-runner',
    audit,
    mastery: { recomputeFromEvaluation: recomputeMastery },
    review: { applyFromEvaluation: applyReview },
    evidenceProjector: { projectAttempt },
    user: { userId: 'student-1', role: 'student', displayName: 'S1', studentId: 'student-1' }
  }
  return { context, spies: { list, save, evaluate, recomputeMastery, applyReview } }
}

describe('handleEvaluationApi', () => {
  it('returns false for non-evaluation paths (dispatcher fallthrough)', async () => {
    const { context } = fakeContext()
    const { response } = makeResponse()
    const handled = await handleEvaluationApi(
      makeGetRequest(),
      response,
      new URL('http://localhost/api/cohort'),
      context
    )
    expect(handled).toBe(false)
  })

  it('GET /api/evaluations scopes history to the student and audits success', async () => {
    const { context, spies } = fakeContext()
    spies.list.mockResolvedValue([
      { id: 'h1', assignmentId: 'a1', score: 90, status: 'completed', attempt: 1 }
    ] as never)
    const { response, status, body } = makeResponse()

    const handled = await handleEvaluationApi(
      makeGetRequest(),
      response,
      new URL('http://localhost/api/evaluations'),
      context
    )

    expect(handled).toBe(true)
    expect(spies.list).toHaveBeenCalledWith({ assignmentId: undefined, studentId: 'student-1' })
    expect(status()).toBe(200)
    expect(body()).toEqual([
      { id: 'h1', assignmentId: 'a1', score: 90, status: 'completed', attempt: 1 }
    ])
  })

  it('POST /api/evaluations rejects an invalid body with 400', async () => {
    const { context, spies } = fakeContext()
    const { response, status } = makeResponse()

    const handled = await handleEvaluationApi(
      makePostRequest({ code: 'x' }),
      response,
      new URL('http://localhost/api/evaluations'),
      context
    )

    expect(handled).toBe(true)
    expect(status()).toBe(400)
    expect(spies.evaluate).not.toHaveBeenCalled()
  })

  it('POST /api/evaluations evaluates, persists, and returns 201', async () => {
    const evalResult = fakeEvaluation({ score: 100 })
    const { context, spies } = fakeContext()
    spies.evaluate.mockResolvedValue(evalResult)
    const { response, status, body } = makeResponse()

    const handled = await handleEvaluationApi(
      makePostRequest({ assignmentId: 'a1', code: 'def f(): pass' }),
      response,
      new URL('http://localhost/api/evaluations'),
      context
    )

    expect(handled).toBe(true)
    expect(spies.evaluate).toHaveBeenCalled()
    expect(spies.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'eval-1', studentId: 'student-1' }))
    expect(spies.recomputeMastery).toHaveBeenCalledWith(expect.objectContaining({ id: 'eval-1' }))
    expect(spies.applyReview).toHaveBeenCalled()
    expect(status()).toBe(201)
    expect((body() as EvaluationResult).score).toBe(100)
  })

  it('logs achievement sync failures without failing the evaluation', async () => {
    const { context } = fakeContext()
    const syncError = new Error('achievement store unavailable')
    context.achievements = {
      sync: vi.fn().mockRejectedValue(syncError)
    }
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    const { response, status } = makeResponse()

    await handleEvaluationApi(
      makePostRequest({ assignmentId: 'a1', code: 'def f(): pass' }),
      response,
      new URL('http://localhost/api/evaluations'),
      context
    )

    expect(status()).toBe(201)
    expect(consoleError).toHaveBeenCalledWith(
      'Achievement sync failed:',
      syncError
    )
    consoleError.mockRestore()
  })
})

describe('handleEvaluationApi GET /api/evaluations/:id (P2-2)', () => {
  it('returns the full evaluation for the owner', async () => {
    const { context } = fakeContext()
    const owned = fakeEvaluation({ id: 'eval-1', studentId: 'student-1' })
    ;(context.store.get as ReturnType<typeof vi.fn>).mockResolvedValue(owned)

    const { response, status, body } = makeResponse()
    const handled = await handleEvaluationApi(
      makeGetRequest(),
      response,
      new URL('http://localhost/api/evaluations/eval-1'),
      context
    )

    expect(handled).toBe(true)
    expect(status()).toBe(200)
    expect((body() as EvaluationResult).id).toBe('eval-1')
  })

  it('returns 404 when the evaluation does not exist', async () => {
    const { context } = fakeContext()
    ;(context.store.get as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)

    const { response, status } = makeResponse()
    const handled = await handleEvaluationApi(
      makeGetRequest(),
      response,
      new URL('http://localhost/api/evaluations/missing'),
      context
    )

    expect(handled).toBe(true)
    expect(status()).toBe(404)
  })

  it('denies a non-owner student viewing another student evaluation', async () => {
    const { context } = fakeContext()
    ;(context.store.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      fakeEvaluation({ id: 'eval-1', studentId: 'other-student' })
    )

    const { response, status } = makeResponse()
    const handled = await handleEvaluationApi(
      makeGetRequest(),
      response,
      new URL('http://localhost/api/evaluations/eval-1'),
      context
    )

    expect(handled).toBe(true)
    expect(status()).toBe(403)
  })
})
