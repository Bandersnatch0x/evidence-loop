// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { createAssignmentRegistry } from '../server/data/assignments'
import { createKnowledgeBase } from '../server/data/knowledge'
import { EvaluationAgent } from '../server/domain/EvaluationAgent'
import { LocalFeedbackGenerator } from '../server/domain/feedback'
import { createRunnerRegistry } from '../server/runner/RunnerRegistry'
import type { CodeRunner } from '../server/runner/types'

const stubCodeRunner: CodeRunner = {
  name: 'python-stub',
  run() {
    return Promise.resolve({ status: 'completed', durationMs: 0, evidence: [] })
  }
}

const assignment = createAssignmentRegistry().get('physics-projectile-xy')
if (!assignment) {
  throw new Error('physics-projectile-xy assignment not registered')
}

function makeAgent(): EvaluationAgent {
  return new EvaluationAgent({
    assignments: createAssignmentRegistry(),
    knowledge: createKnowledgeBase(),
    runners: createRunnerRegistry(stubCodeRunner),
    feedback: new LocalFeedbackGenerator()
  })
}

describe('physics-projectile-xy · end-to-end integration', () => {
  const agent = makeAgent()

  it('registers and routes via expression runner with answers spec', () => {
    expect(assignment.questionType).toBe('expression')
    expect(assignment.language).toBe('physics')
  })

  it('scores 100 for both components correct', async () => {
    const result = await agent.evaluate({
      assignmentId: 'physics-projectile-xy',
      code: 'x = v0*cos(theta)*t\ny = v0*sin(theta)*t - 0.5*g*t^2'
    })
    expect(result.status).toBe('completed')
    expect(result.score).toBe(100)
    expect(result.evidence.find((e) => e.id === 'cas-x')?.state).toBe('passed')
    expect(result.evidence.find((e) => e.id === 'cas-y')?.state).toBe('passed')
  })

  it('scores 50 when only y is correct (x wrong)', async () => {
    const result = await agent.evaluate({
      assignmentId: 'physics-projectile-xy',
      code: 'x = v0*sin(theta)*t\ny = v0*sin(theta)*t - 0.5*g*t^2'
    })
    expect(result.score).toBe(50)
    expect(result.evidence.find((e) => e.id === 'cas-x')?.state).toBe('failed')
    expect(result.evidence.find((e) => e.id === 'cas-y')?.state).toBe('passed')
    // correctness dimension is failed (one criterion failed → dimension failed)
    const correctness = result.dimensions.find((d) => d.id === 'correctness')
    expect(correctness?.state).toBe('failed')
    expect(correctness?.earnedScore).toBe(50)
  })

  it('blocks missing y component (score 50, y blocked)', async () => {
    const result = await agent.evaluate({
      assignmentId: 'physics-projectile-xy',
      code: 'x = v0*cos(theta)*t'
    })
    expect(result.evidence.find((e) => e.id === 'cas-x')?.state).toBe('passed')
    expect(result.evidence.find((e) => e.id === 'cas-y')?.state).toBe('blocked')
    // x passed (50) + y blocked (0) → score 50, correctness dimension blocked
    expect(result.score).toBe(50)
    const correctness = result.dimensions.find((d) => d.id === 'correctness')
    expect(correctness?.state).toBe('blocked')
  })

  it('blocks both on garbage submission (score 0)', async () => {
    const result = await agent.evaluate({
      assignmentId: 'physics-projectile-xy',
      code: '@@@not equations@@@'
    })
    expect(result.score).toBe(0)
    expect(result.evidence.find((e) => e.id === 'cas-x')?.state).toBe('blocked')
    expect(result.evidence.find((e) => e.id === 'cas-y')?.state).toBe('blocked')
  })
})
