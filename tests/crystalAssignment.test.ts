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

describe('Crystal structure assignments · end-to-end integration', () => {
  const agent = makeAgent()

  describe('chem-crystal-nacl (NaCl → 面心立方 / rock salt)', () => {
    it('registers as fill_blank chemistry', () => {
      const a = createAssignmentRegistry().get('chem-crystal-nacl')
      expect(a).toBeDefined()
      expect(a!.questionType).toBe('fill_blank')
      expect(a!.language).toBe('chemistry')
    })

    it('scores 100 for "面心立方" (Chinese)', async () => {
      const result = await agent.evaluate({
        assignmentId: 'chem-crystal-nacl',
        code: '面心立方'
      })
      expect(result.status).toBe('completed')
      expect(result.score).toBe(100)
    })

    it('scores 100 for "rock salt" (English synonym)', async () => {
      const result = await agent.evaluate({
        assignmentId: 'chem-crystal-nacl',
        code: 'rock salt'
      })
      expect(result.score).toBe(100)
    })

    it('scores 0 for "体心立方" (wrong structure)', async () => {
      const result = await agent.evaluate({
        assignmentId: 'chem-crystal-nacl',
        code: '体心立方'
      })
      expect(result.score).toBe(0)
      const ev = result.evidence.find((e) => e.id === 'answer-match')
      expect(ev?.state).toBe('failed')
    })
  })

  describe('chem-crystal-diamond (C → 金刚石 / diamond)', () => {
    it('scores 100 for "金刚石" (Chinese)', async () => {
      const result = await agent.evaluate({
        assignmentId: 'chem-crystal-diamond',
        code: '金刚石'
      })
      expect(result.score).toBe(100)
    })

    it('scores 100 for "diamond" (English)', async () => {
      const result = await agent.evaluate({
        assignmentId: 'chem-crystal-diamond',
        code: 'diamond'
      })
      expect(result.score).toBe(100)
    })

    it('scores 0 for "石墨" (graphite, wrong structure)', async () => {
      const result = await agent.evaluate({
        assignmentId: 'chem-crystal-diamond',
        code: '石墨'
      })
      expect(result.score).toBe(0)
      const ev = result.evidence.find((e) => e.id === 'answer-match')
      expect(ev?.state).toBe('failed')
    })
  })
})
