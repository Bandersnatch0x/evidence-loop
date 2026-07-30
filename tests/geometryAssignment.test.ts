// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { createAssignmentRegistry } from '../server/data/assignments'
import { createKnowledgeBase } from '../server/data/knowledge'
import { EvaluationAgent } from '../server/domain/EvaluationAgent'
import { LocalFeedbackGenerator } from '../server/domain/feedback'
import { createRunnerRegistry } from '../server/runner/RunnerRegistry'
import type { CodeRunner } from '../server/runner/types'

// Minimal stub code runner — geometry routes to GeometryRunner, not this.
const stubCodeRunner: CodeRunner = {
  name: 'python-stub',
  run() {
    return Promise.resolve({ status: 'completed', durationMs: 0, evidence: [] })
  }
}

const assignment = createAssignmentRegistry().get('cube-section')
if (!assignment) {
  throw new Error('cube-section assignment not registered')
}

function makeAgent(): EvaluationAgent {
  return new EvaluationAgent({
    assignments: createAssignmentRegistry(),
    knowledge: createKnowledgeBase(),
    runners: createRunnerRegistry(stubCodeRunner),
    feedback: new LocalFeedbackGenerator()
  })
}

describe('cube-section · end-to-end integration', () => {
  const agent = makeAgent()

  it('routes geometry assignment through registry → evaluator → scored dimensions', async () => {
    const result = await agent.evaluate({
      assignmentId: 'cube-section',
      code: 'A,B,C,D'
    })
    expect(result.status).toBe('completed')
    // Two correctness criteria at weight 50 each → full score 100.
    expect(result.score).toBe(100)
  })

  it('gives full score for a coplanar convex quadrilateral (bottom face)', async () => {
    const result = await agent.evaluate({
      assignmentId: 'cube-section',
      code: 'A,B,C,D'
    })
    expect(result.score).toBe(100)
    const correctness = result.dimensions.find((d) => d.id === 'correctness')
    expect(correctness?.state).toBe('passed')
    expect(correctness?.earnedScore).toBe(100)
  })

  it('gives full score for a triangular section (3 vertices always planar+convex)', async () => {
    const result = await agent.evaluate({
      assignmentId: 'cube-section',
      code: 'A,B,C'
    })
    expect(result.score).toBe(100)
  })

  it('loses score when vertex count exceeds 6 (shape-vertices fails)', async () => {
    const result = await agent.evaluate({
      assignmentId: 'cube-section',
      code: 'A,B,C,D,E,F,G'
    })
    // shape-vertices weight 50 fails → score 50 (shape-convex may still pass).
    expect(result.score).toBeLessThan(100)
    const shapeVertices = result.evidence.find((e) => e.id === 'shape-vertices')
    expect(shapeVertices?.state).toBe('failed')
  })

  it('blocks all correctness criteria on invalid vertex ids', async () => {
    const result = await agent.evaluate({
      assignmentId: 'cube-section',
      code: 'A,X,Y'
    })
    expect(result.status).toBe('completed')
    const correctness = result.dimensions.find((d) => d.id === 'correctness')
    // Invalid ids → blocked, not failed (correctness never reached evaluation).
    expect(correctness?.state).toBe('blocked')
    expect(result.score).toBe(0)
  })

  it('keeps render dimension earnedScore=0 and never contributes to score', async () => {
    const result = await agent.evaluate({
      assignmentId: 'cube-section',
      code: 'A,B,C,D'
    })
    const render = result.dimensions.find((d) => d.id === 'render')
    expect(render).toBeDefined()
    expect(render?.earnedScore).toBe(0)
    // render-artifact is weight=0 audit-only — even when passed, no score contribution.
    const renderArtifact = result.evidence.find((e) => e.id === 'render-artifact')
    expect(renderArtifact?.state).toBe('passed')
    expect(renderArtifact?.weight).toBe(0)
  })

  it('does not let render-artifact pollute correctness state', async () => {
    // Wrong submission: invalid ids block correctness. render-artifact is also blocked,
    // but render dimension is maxScore=0 so its state must not drag correctness.
    const result = await agent.evaluate({
      assignmentId: 'cube-section',
      code: 'A,X,Y'
    })
    const correctness = result.dimensions.find((d) => d.id === 'correctness')
    const render = result.dimensions.find((d) => d.id === 'render')
    expect(correctness?.state).toBe('blocked')
    // Render dimension is isolated: its blocked state stays in its own dimension.
    expect(render?.state).toBe('blocked')
    expect(render?.earnedScore).toBe(0)
  })

  it('records render-artifact audit params in evidence actual', async () => {
    const result = await agent.evaluate({
      assignmentId: 'cube-section',
      code: 'A,B,C,D'
    })
    const renderArtifact = result.evidence.find((e) => e.id === 'render-artifact')
    const parsed = JSON.parse(renderArtifact?.actual ?? '{}') as {
      projection?: string
      vertexIds?: string[]
      sampleCount?: number
    }
    expect(parsed.projection).toBe('isometric')
    expect(parsed.vertexIds).toEqual(['A', 'B', 'C', 'D'])
    expect(parsed.sampleCount).toBe(200)
  })
})
