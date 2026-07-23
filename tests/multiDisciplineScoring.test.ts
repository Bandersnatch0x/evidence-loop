// @vitest-environment node

/**
 * Ticket 032 integration: each question type routes through RunnerRegistry →
 * validator → EvaluationAgent scoring (and essay advisory).
 */

import { describe, expect, it } from 'vitest'
import { AdvisoryService } from '../server/advisory/AdvisoryService'
import { createAssignmentRegistry } from '../server/data/assignments'
import { createKnowledgeBase } from '../server/data/knowledge'
import { EvaluationAgent } from '../server/domain/EvaluationAgent'
import { LocalFeedbackGenerator } from '../server/domain/feedback'
import { createRunnerRegistry } from '../server/runner/RunnerRegistry'
import type { CodeRunner, RunnerResult } from '../server/runner/types'

/** Code path must stay wired; other types use real validators. */
class StubCodeRunner implements CodeRunner {
  public readonly name = 'stub-code'

  public run(): Promise<RunnerResult> {
    return Promise.resolve({
      status: 'completed',
      durationMs: 1,
      evidence: [
        { id: 'basic-average', state: 'passed', actual: '90', message: 'ok' },
        { id: 'decimal-average', state: 'passed', actual: '80', message: 'ok' },
        { id: 'negative-average', state: 'passed', actual: '0', message: 'ok' },
        { id: 'empty-input', state: 'passed', actual: '0', message: 'ok' },
        { id: 'single-score', state: 'passed', actual: '86', message: 'ok' },
        { id: 'required-function', state: 'passed', message: 'ok' },
        { id: 'no-side-effects', state: 'passed', message: 'ok' },
        { id: 'focused-function', state: 'passed', message: 'ok' }
      ]
    })
  }
}

function createAgent(): EvaluationAgent {
  return new EvaluationAgent({
    assignments: createAssignmentRegistry(),
    knowledge: createKnowledgeBase(),
    runners: createRunnerRegistry(new StubCodeRunner()),
    feedback: new LocalFeedbackGenerator(),
    advisory: new AdvisoryService()
  })
}

describe('multi-discipline scoring loop (ticket 032)', () => {
  const registry = createAssignmentRegistry()

  it('lists every demo assignment for GET /api/assignments surface', () => {
    const ids = registry.list().map((item) => item.id).sort()
    // Ticket 031 expanded to 9 subjects; keep original demos and require the
    // multi-discipline set as a subset so this suite stays backward-compatible.
    const required = [
      'chem-water-formation',
      'choice-algebra-simplify',
      'essay-perseverance-growth',
      'expression-perfect-square',
      'fill-blank-water-formula',
      'numeric-ohm-law',
      'python-average',
      'choice-english-present-perfect',
      'fill-blank-biology-mitochondria',
      'choice-politics-basic-rights',
      'choice-history-opium-war',
      'numeric-geography-tropic',
      'essay-history-source-analysis',
      'essay-politics-social-rules'
    ].sort()
    expect(ids).toEqual(expect.arrayContaining(required))
    expect(ids.length).toBeGreaterThanOrEqual(required.length)
  })

  it('registers all question types on the production RunnerRegistry', () => {
    const runners = createRunnerRegistry(new StubCodeRunner())
    for (const type of [
      'code',
      'choice',
      'fill_blank',
      'numeric',
      'expression',
      'chem_equation',
      'essay'
    ] as const) {
      expect(runners.has(type)).toBe(true)
    }
  })

  it('choice: correct answer scores full, wrong answer fails with diagnosis path', async () => {
    const agent = createAgent()
    const pass = await agent.evaluate({
      assignmentId: 'choice-algebra-simplify',
      code: 'B'
    })
    expect(pass.status).toBe('completed')
    expect(pass.score).toBe(100)
    expect(pass.evidence[0]?.state).toBe('passed')
    expect(pass.evidence[0]?.id).toBe('answer-match')

    const fail = await agent.evaluate({
      assignmentId: 'choice-algebra-simplify',
      code: 'A'
    })
    expect(fail.status).toBe('completed')
    expect(fail.score).toBe(0)
    expect(fail.evidence[0]?.state).toBe('failed')
    expect(fail.evidence[0]?.message).toContain('不一致')
  })

  it('fill_blank: accepted answer full score; wrong fails', async () => {
    const agent = createAgent()
    const pass = await agent.evaluate({
      assignmentId: 'fill-blank-water-formula',
      code: 'H2O'
    })
    expect(pass.score).toBe(100)
    expect(pass.evidence[0]?.state).toBe('passed')

    const fail = await agent.evaluate({
      assignmentId: 'fill-blank-water-formula',
      code: 'H2O2'
    })
    expect(fail.score).toBe(0)
    expect(fail.evidence[0]?.state).toBe('failed')
  })

  it('numeric: value within tolerance full score; wrong fails', async () => {
    const agent = createAgent()
    const pass = await agent.evaluate({
      assignmentId: 'numeric-ohm-law',
      code: '24'
    })
    expect(pass.score).toBe(100)
    expect(pass.evidence[0]?.state).toBe('passed')

    const fail = await agent.evaluate({
      assignmentId: 'numeric-ohm-law',
      code: '12'
    })
    expect(fail.score).toBe(0)
    expect(fail.evidence[0]?.state).toBe('failed')
  })

  it('expression: CAS-equivalent full score; unequal fails with cas-final evidence', async () => {
    const agent = createAgent()
    const pass = await agent.evaluate({
      assignmentId: 'expression-perfect-square',
      code: 'x^2+2*x+1'
    })
    expect(pass.status).toBe('completed')
    expect(pass.score).toBe(100)
    const cas = pass.evidence.find((item) => item.id === 'cas-final')
    expect(cas?.state).toBe('passed')

    const fail = await agent.evaluate({
      assignmentId: 'expression-perfect-square',
      code: 'x^2+1'
    })
    expect(fail.score).toBe(0)
    expect(fail.evidence.find((item) => item.id === 'cas-final')?.state).toBe(
      'failed'
    )
  })

  it('chem_equation: balanced equation full score; unbalanced fails', async () => {
    const agent = createAgent()
    const pass = await agent.evaluate({
      assignmentId: 'chem-water-formation',
      code: '2H2+O2=2H2O'
    })
    expect(pass.score).toBe(100)
    expect(pass.evidence[0]?.id).toBe('cas_check')
    expect(pass.evidence[0]?.state).toBe('passed')

    const fail = await agent.evaluate({
      assignmentId: 'chem-water-formation',
      code: 'H2+O2=H2O'
    })
    expect(fail.score).toBe(0)
    expect(fail.evidence[0]?.state).toBe('failed')
    expect(fail.evidence[0]?.message.length).toBeGreaterThan(0)
  })

  it('essay: well-structured earns objective score + advisory; weak text scores lower without advisory scores', async () => {
    const agent = createAgent()
    const pass = await agent.evaluate({
      assignmentId: 'essay-perseverance-growth',
      code: registry.get('essay-perseverance-growth')?.demoVariants.find(
        (item) => item.id === 'well-structured'
      )?.code ?? ''
    })
    expect(pass.status).toBe('completed')
    expect(pass.score).toBe(100)
    expect(pass.advisory).toBeDefined()
    expect(pass.advisory?.length).toBeGreaterThan(0)
    for (const suggestion of pass.advisory ?? []) {
      expect(suggestion.provenance.kind).toBe('llm_inference')
      expect(suggestion.requiresTeacherConfirmation).toBe(true)
      // Structural: AdvisorySuggestion has no score field — runtime guard
      expect('score' in suggestion).toBe(false)
      expect('weight' in suggestion).toBe(false)
    }
    expect(pass.trace.some((step) => step.tool === 'advisory.suggest')).toBe(
      true
    )

    const fail = await agent.evaluate({
      assignmentId: 'essay-perseverance-growth',
      code: registry.get('essay-perseverance-growth')?.demoVariants.find(
        (item) => item.id === 'missing-structure'
      )?.code ?? ''
    })
    expect(fail.status).toBe('completed')
    expect(fail.score).toBeLessThan(100)
    expect(fail.score).toBeLessThan(pass.score)
    expect(fail.evidence.some((item) => item.state === 'failed')).toBe(true)
    // Advisory still produced (coaching), never as score
    expect(fail.advisory?.length).toBeGreaterThan(0)
  })

  it('code path remains available (python-average still routes and scores)', async () => {
    const agent = createAgent()
    const result = await agent.evaluate({
      assignmentId: 'python-average',
      code: 'def calculate_average(scores):\n    return 0 if not scores else sum(scores)/len(scores)'
    })
    expect(result.status).toBe('completed')
    expect(result.score).toBe(100)
    expect(result.advisory).toBeUndefined()
  })

  it('criteria conceptIds reference real knowledge-point seed ids for non-code demos', () => {
    const seedIds = new Set([
      'kp.math.algebra.simplify',
      'kp.chemistry.matter.atom_structure',
      'kp.physics.electricity.ohm_law',
      'kp.chemistry.reaction.equation_balance',
      'kp.chinese.writing.argumentative',
      'kp.chinese.language.characters'
    ])
    for (const id of [
      'choice-algebra-simplify',
      'fill-blank-water-formula',
      'numeric-ohm-law',
      'expression-perfect-square',
      'chem-water-formation',
      'essay-perseverance-growth'
    ]) {
      const assignment = registry.get(id)
      expect(assignment).toBeDefined()
      for (const criterion of assignment?.criteria ?? []) {
        expect(seedIds.has(criterion.conceptId)).toBe(true)
      }
    }
  })
})
