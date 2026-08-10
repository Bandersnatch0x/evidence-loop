// @vitest-environment node

import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import {
  AGENT_CATALOG,
  type AgentCatalogEntry,
  type AgentId
} from '../shared/agentCatalog'
import { handleTransparencyApi } from '../server/transparency/transparencyRoutes'

/**
 * T17 契约测试 — Agent 编队目录是产品叙事的单一事实源，透明度页 / 只读 API /
 * 口播脚本都引用它。这里只测外部行为（数据形状 + 铁律不变量 + API 响应），
 * 不测渲染细节。
 *
 * 核心不变量（ADR-0001 / CONTEXT「评分事实只来自 Runner 产出的 Evidence」）：
 *   touchesScore === true  ⇒  llmAllowed === false
 */

const EXPECTED_IDS: AgentId[] = [
  'scoring',
  'diagnosis',
  'tutoring',
  'assignment',
  'advisory'
]

function findAgent(id: AgentId): AgentCatalogEntry {
  const entry = AGENT_CATALOG.find((agent) => agent.id === id)
  if (!entry) throw new Error(`catalog is missing agent: ${id}`)
  return entry
}

describe('T17 agent catalog: shape', () => {
  it('exposes exactly the five product agents with unique ids', () => {
    expect(AGENT_CATALOG).toHaveLength(5)
    expect(AGENT_CATALOG.map((agent) => agent.id)).toEqual(EXPECTED_IDS)
    expect(new Set(AGENT_CATALOG.map((agent) => agent.id)).size).toBe(5)
  })

  it('every entry carries non-empty id / name / internalModule and boolean flags', () => {
    for (const agent of AGENT_CATALOG) {
      expect(agent.id.length, `${agent.id}.id`).toBeGreaterThan(0)
      expect(agent.name.trim().length, `${agent.id}.name`).toBeGreaterThan(0)
      expect(
        agent.internalModule.trim().length,
        `${agent.id}.internalModule`
      ).toBeGreaterThan(0)
      expect(typeof agent.touchesScore, `${agent.id}.touchesScore`).toBe('boolean')
      expect(typeof agent.llmAllowed, `${agent.id}.llmAllowed`).toBe('boolean')
    }
  })

  it('every entry declares non-empty inputs / outputs / prohibitions', () => {
    for (const agent of AGENT_CATALOG) {
      for (const facet of ['inputs', 'outputs', 'prohibitions'] as const) {
        const values = agent[facet]
        expect(Array.isArray(values), `${agent.id}.${facet}`).toBe(true)
        expect(values.length, `${agent.id}.${facet} must not be empty`).toBeGreaterThan(0)
        for (const value of values) {
          expect(typeof value, `${agent.id}.${facet} entry type`).toBe('string')
          expect(
            value.trim().length,
            `${agent.id}.${facet} has a blank entry`
          ).toBeGreaterThan(0)
        }
      }
    }
  })

  it('declares the documented internal module split (no new runtime)', () => {
    expect(findAgent('scoring').internalModule).toBe('RunnerRegistry + Rubric')
    expect(findAgent('tutoring').internalModule).toBe('Tutoring / Socratic')
    expect(findAgent('advisory').internalModule).toContain('Advisory')
  })
})

describe('T17 agent catalog: iron rule contract', () => {
  it('touchesScore === true implies llmAllowed === false for every entry', () => {
    const violations = AGENT_CATALOG.filter(
      (agent) => agent.touchesScore && agent.llmAllowed
    ).map((agent) => `${agent.id} (${agent.internalModule})`)

    expect(
      violations,
      violations.length === 0
        ? ''
        : [
            'ADR-0001 违规：碰分数的 Agent 不得允许 LLM。',
            '评分事实只来自 Runner 产出的 Evidence，LLM 不得改分。违规条目：',
            violations.join(', ')
          ].join('\n')
    ).toEqual([])
  })

  it('the scoring agent is the only score-touching agent and is LLM-free', () => {
    const scoreTouching = AGENT_CATALOG.filter((agent) => agent.touchesScore)
    expect(scoreTouching.map((agent) => agent.id)).toEqual(['scoring'])
    expect(findAgent('scoring').llmAllowed).toBe(false)
  })

  it('tutoring and advisory may use LLM but never touch the score', () => {
    expect(findAgent('tutoring').llmAllowed).toBe(true)
    expect(findAgent('tutoring').touchesScore).toBe(false)
    expect(findAgent('advisory').touchesScore).toBe(false)
  })
})

/** Minimal ServerResponse double — captures status + JSON body. */
function createResponseDouble() {
  const captured: { statusCode?: number; body?: unknown } = {}
  const response = {
    writeHead(statusCode: number) {
      captured.statusCode = statusCode
      return response
    },
    end(payload?: string) {
      captured.body = payload === undefined ? undefined : JSON.parse(payload)
    }
  }
  return { captured, response: response as unknown as ServerResponse }
}

function createRequestDouble(method: string): IncomingMessage {
  return { method } as IncomingMessage
}

describe('T17 GET /api/transparency/agents', () => {
  it('returns the full five-entry catalog plus the iron rule', () => {
    const { captured, response } = createResponseDouble()
    const handled = handleTransparencyApi(
      createRequestDouble('GET'),
      response,
      '/api/transparency/agents'
    )

    expect(handled).toBe(true)
    expect(captured.statusCode).toBe(200)
    const body = captured.body as {
      agents: AgentCatalogEntry[]
      ironRule: string
    }
    expect(body.agents).toHaveLength(5)
    expect(body.agents.map((agent) => agent.id)).toEqual(EXPECTED_IDS)
    expect(body.ironRule).toContain('零 LLM')
    const scoring = body.agents.find((agent) => agent.id === 'scoring')
    expect(scoring?.touchesScore).toBe(true)
    expect(scoring?.llmAllowed).toBe(false)
  })

  it('ignores unrelated paths and rejects non-GET methods', () => {
    const passthrough = createResponseDouble()
    expect(
      handleTransparencyApi(
        createRequestDouble('GET'),
        passthrough.response,
        '/api/health'
      )
    ).toBe(false)
    expect(passthrough.captured.statusCode).toBeUndefined()

    const mutation = createResponseDouble()
    expect(
      handleTransparencyApi(
        createRequestDouble('POST'),
        mutation.response,
        '/api/transparency/agents'
      )
    ).toBe(true)
    expect(mutation.captured.statusCode).toBe(405)
  })
})
