// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { createAssignmentRegistry } from '../server/data/assignments'
import { createKnowledgeBase } from '../server/data/knowledge'
import { EvaluationAgent } from '../server/domain/EvaluationAgent'
import { LocalFeedbackGenerator } from '../server/domain/feedback'
import type { CodeRunner, RunnerResult } from '../server/runner/types'

class StubRunner implements CodeRunner {
  public constructor(private readonly result: RunnerResult) {}

  public run(): Promise<RunnerResult> {
    return Promise.resolve(this.result)
  }
}

describe('EvaluationAgent', () => {
  it('turns failed execution evidence into a scored, actionable learning loop', async () => {
    const runner = new StubRunner({
      status: 'completed',
      durationMs: 34,
      evidence: [
        {
          id: 'basic-average',
          state: 'passed',
          actual: '90',
          message: '常规分数列表计算正确'
        },
        {
          id: 'decimal-average',
          state: 'passed',
          actual: '80',
          message: '小数分数计算正确'
        },
        {
          id: 'negative-average',
          state: 'passed',
          actual: '0',
          message: '含负数数据计算正确'
        },
        {
          id: 'empty-input',
          state: 'failed',
          actual: 'ZeroDivisionError',
          message: '空列表触发了除零错误'
        },
        {
          id: 'single-score',
          state: 'passed',
          actual: '86',
          message: '单元素列表计算正确'
        },
        {
          id: 'required-function',
          state: 'passed',
          message: '函数签名存在'
        },
        {
          id: 'no-side-effects',
          state: 'passed',
          message: '未发现输入输出副作用'
        },
        {
          id: 'focused-function',
          state: 'passed',
          message: '函数结构保持聚焦'
        }
      ]
    })

    const agent = new EvaluationAgent({
      assignments: createAssignmentRegistry(),
      knowledge: createKnowledgeBase(),
      runner,
      feedback: new LocalFeedbackGenerator()
    })

    const result = await agent.evaluate({
      assignmentId: 'python-average',
      code: 'def calculate_average(scores):\n    return sum(scores) / len(scores)'
    })

    expect(result.status).toBe('completed')
    expect(result.score).toBe(80)
    expect(result.diagnoses[0]).toMatchObject({
      conceptId: 'empty-sequence',
      severity: 'high'
    })
    expect(result.intervention).toMatchObject({
      conceptId: 'empty-sequence',
      title: '先封住空序列路径'
    })
    expect(result.trace.map((step) => step.tool)).toEqual([
      'assignment.retrieve',
      'python.safe-runner',
      'rubric.score',
      'knowledge.retrieve',
      'feedback.compose'
    ])
  })

  it('compares a new attempt against previous evidence without changing rubric truth', async () => {
    const runner = new StubRunner({
      status: 'completed',
      durationMs: 21,
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
    const agent = new EvaluationAgent({
      assignments: createAssignmentRegistry(),
      knowledge: createKnowledgeBase(),
      runner,
      feedback: new LocalFeedbackGenerator()
    })

    const result = await agent.evaluate(
      {
        assignmentId: 'python-average',
        code: 'def calculate_average(scores):\n    return 0 if not scores else sum(scores) / len(scores)'
      },
      {
        id: 'previous',
        assignmentId: 'python-average',
        attempt: 1,
        createdAt: '2026-07-22T00:00:00.000Z',
        status: 'completed',
        score: 80,
        summary: '上一轮',
        evidence: [],
        dimensions: [],
        diagnoses: [],
        trace: [],
        mastery: [],
        feedbackSource: 'local-policy'
      }
    )

    expect(result.score).toBe(100)
    expect(result.previousScore).toBe(80)
    expect(result.scoreDelta).toBe(20)
    expect(result.attempt).toBe(2)
    expect(result.intervention).toBeUndefined()
  })
})
