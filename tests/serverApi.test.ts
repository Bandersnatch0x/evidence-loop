// @vitest-environment node

import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createEvidenceLoopServer } from '../server/index'

describe('evaluation HTTP API', () => {
  let server: Awaited<ReturnType<typeof createEvidenceLoopServer>>
  let baseUrl: string

  beforeEach(async () => {
    server = await createEvidenceLoopServer({ dataFile: ':memory:' })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${String(address.port)}`
  })

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
  })

  it('returns 400 for malformed JSON', async () => {
    const response = await fetch(`${baseUrl}/api/evaluations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{invalid'
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Malformed JSON request body'
    })
  })

  it('returns 413 when the request body exceeds the limit', async () => {
    const response = await fetch(`${baseUrl}/api/evaluations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        assignmentId: 'python-average',
        code: 'x'.repeat(260 * 1024)
      })
    })

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Request body is too large'
    })
  })

  it('handles the browser favicon request without a console error', async () => {
    const response = await fetch(`${baseUrl}/favicon.ico`)

    expect(response.status).toBe(204)
  })

  it('stores and lists evaluations in memory without touching disk', async () => {
    const first = await fetch(`${baseUrl}/api/evaluations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        assignmentId: 'python-average',
        code: 'def calculate_average(scores):\n    return sum(scores) / len(scores)'
      })
    })

    expect(first.status).toBe(201)
    const firstBody = await first.json() as {
      id: string
      score: number
      attempt: number
      status: string
    }
    expect(firstBody.status).toBe('completed')
    expect(firstBody.score).toBe(80)
    expect(firstBody.attempt).toBe(1)

    const second = await fetch(`${baseUrl}/api/evaluations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        assignmentId: 'python-average',
        code:
          'def calculate_average(scores):\n    if not scores:\n        return 0\n\n    return sum(scores) / len(scores)',
        previousEvaluationId: firstBody.id
      })
    })

    expect(second.status).toBe(201)
    const secondBody = await second.json() as {
      score: number
      attempt: number
      scoreDelta?: number
      previousScore?: number
    }
    expect(secondBody.score).toBe(100)
    expect(secondBody.attempt).toBe(2)
    expect(secondBody.previousScore).toBe(80)
    expect(secondBody.scoreDelta).toBe(20)

    const list = await fetch(`${baseUrl}/api/evaluations?assignmentId=python-average`)
    expect(list.status).toBe(200)
    const history = await list.json() as Array<{ attempt: number; score: number }>
    expect(history).toHaveLength(2)
    expect(history.map((item) => item.score).sort((a, b) => a - b)).toEqual([80, 100])
  })
})
