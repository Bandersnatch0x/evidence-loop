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

function makeAgent(): EvaluationAgent {
  return new EvaluationAgent({
    assignments: createAssignmentRegistry(),
    knowledge: createKnowledgeBase(),
    runners: createRunnerRegistry(stubCodeRunner),
    feedback: new LocalFeedbackGenerator()
  })
}

describe('VSEPR assignments · end-to-end integration', () => {
  const agent = makeAgent()

  describe('chem-vsepr-methane (CH4 → tetrahedral)', () => {
    it('registers as fill_blank chemistry and routes via ObjectiveValidator', () => {
      const a = createAssignmentRegistry().get('chem-vsepr-methane')
      expect(a).toBeDefined()
      expect(a!.questionType).toBe('fill_blank')
      expect(a!.language).toBe('chemistry')
    })

    it('scores 100 for "tetrahedral" (English)', async () => {
      const result = await agent.evaluate({
        assignmentId: 'chem-vsepr-methane',
        code: 'tetrahedral'
      })
      expect(result.status).toBe('completed')
      expect(result.score).toBe(100)
    })

    it('scores 100 for "正四面体" (Chinese, case-insensitive accepted)', async () => {
      const result = await agent.evaluate({
        assignmentId: 'chem-vsepr-methane',
        code: '正四面体'
      })
      expect(result.score).toBe(100)
    })

    it('scores 100 for "TETRAHEDRAL" (uppercase, case-insensitive)', async () => {
      const result = await agent.evaluate({
        assignmentId: 'chem-vsepr-methane',
        code: 'TETRAHEDRAL'
      })
      expect(result.score).toBe(100)
    })

    it('scores 0 for "square planar" (wrong shape)', async () => {
      const result = await agent.evaluate({
        assignmentId: 'chem-vsepr-methane',
        code: 'square planar'
      })
      expect(result.score).toBe(0)
      const ev = result.evidence.find((e) => e.id === 'answer-match')
      expect(ev?.state).toBe('failed')
      const correctness = result.dimensions.find((d) => d.id === 'correctness')
      expect(correctness?.state).toBe('failed')
    })
  })

  describe('chem-vsepr-water (H2O → bent)', () => {
    it('scores 100 for "bent"', async () => {
      const result = await agent.evaluate({
        assignmentId: 'chem-vsepr-water',
        code: 'bent'
      })
      expect(result.score).toBe(100)
    })

    it('scores 100 for "V形" (Chinese synonym)', async () => {
      const result = await agent.evaluate({
        assignmentId: 'chem-vsepr-water',
        code: 'V形'
      })
      expect(result.score).toBe(100)
    })

    it('scores 0 for "linear" (wrong shape)', async () => {
      const result = await agent.evaluate({
        assignmentId: 'chem-vsepr-water',
        code: 'linear'
      })
      expect(result.score).toBe(0)
    })
  })
})
