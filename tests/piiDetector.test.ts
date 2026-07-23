// @vitest-environment node

import { describe, expect, it } from 'vitest'
import type { EvaluationResult } from '../shared/contracts'
import {
  assertNoPII,
  detectEvaluationPII,
  findPIIInText,
  PIIError
} from '../server/pii/PIIDetector'

function baseEvaluation(
  overrides: Partial<EvaluationResult> = {}
): EvaluationResult {
  return {
    id: 'eval_test',
    assignmentId: 'python-average',
    attempt: 1,
    createdAt: new Date().toISOString(),
    status: 'completed',
    score: 80,
    summary: '当前得分 80 分，1 项证据未通过。优先处理薄弱点后重新提交验证。',
    evidence: [
      {
        id: 'basic-average',
        kind: 'test',
        label: '常规平均分',
        dimensionId: 'correctness',
        visibility: 'public',
        state: 'passed',
        weight: 20,
        expected: '90',
        actual: '90',
        message: '常规分数列表计算正确'
      }
    ],
    dimensions: [],
    diagnoses: [],
    trace: [],
    mastery: [],
    feedbackSource: 'local-policy',
    provenance: {
      kind: 'evidence',
      evidenceIds: ['basic-average'],
      algorithm: 'simple.v1'
    },
    ...overrides
  }
}

describe('PIIDetector', () => {
  it('rejects summary that contains a Chinese name', () => {
    const evaluation = baseEvaluation({
      // Trailing punctuation keeps the CJK-boundary name match (张三).
      summary: '学生张三，本轮得分为 80 分，请关注空列表边界。'
    })

    expect(() => detectEvaluationPII(evaluation)).toThrow(PIIError)
    try {
      detectEvaluationPII(evaluation)
    } catch (error) {
      expect(error).toBeInstanceOf(PIIError)
      if (error instanceof PIIError) {
        expect(error.message).toMatch(/summary/)
        expect(error.message).toMatch(/中文姓名/)
        expect(error.matches[0]?.kind).toBe('chinese_name')
        expect(error.matches[0]?.field).toBe('summary')
      }
    }
  })

  it('rejects rejectionReason that contains a phone number', () => {
    const evaluation = baseEvaluation({
      status: 'rejected',
      rejectionReason: '运行失败，请联系 13812345678 获取帮助',
      summary: '运行器未能完成本轮验证。'
    })

    expect(() => detectEvaluationPII(evaluation)).toThrow(PIIError)
    try {
      detectEvaluationPII(evaluation)
    } catch (error) {
      expect(error).toBeInstanceOf(PIIError)
      if (error instanceof PIIError) {
        expect(error.message).toMatch(/rejectionReason/)
        expect(error.message).toMatch(/手机号/)
        expect(error.matches.some((match) => match.kind === 'phone')).toBe(true)
      }
    }
  })

  it('rejects evidence[].actual that contains an email', () => {
    const evaluation = baseEvaluation({
      evidence: [
        {
          id: 'basic-average',
          kind: 'test',
          label: '常规平均分',
          dimensionId: 'correctness',
          visibility: 'public',
          state: 'failed',
          weight: 20,
          expected: '90',
          actual: '联系 student@school.edu.cn 查看详情',
          message: '输出不符合预期'
        }
      ]
    })

    expect(() => detectEvaluationPII(evaluation)).toThrow(PIIError)
    try {
      detectEvaluationPII(evaluation)
    } catch (error) {
      expect(error).toBeInstanceOf(PIIError)
      if (error instanceof PIIError) {
        expect(error.message).toMatch(/evidence\[0\]\.actual/)
        expect(error.message).toMatch(/邮箱/)
        expect(error.matches[0]?.kind).toBe('email')
      }
    }
  })

  it('rejects free-form text that contains a student id (20xxxxxx)', () => {
    const matches = findPIIInText(
      'summary',
      '学号 20241201 对应的提交未通过边界用例。'
    )
    expect(matches.some((match) => match.kind === 'student_id')).toBe(true)
    expect(matches[0]?.snippet).toBe('20241201')

    expect(() =>
      assertNoPII('transcript', '我的学号是 20190567')
    ).toThrow(PIIError)
  })

  it('reports the line number inside a multi-line field', () => {
    const evaluation = baseEvaluation({
      summary: '第一行正常说明。\n第二行也正常。\n第三行：李明，需要补交。'
    })

    try {
      detectEvaluationPII(evaluation)
      expect.unreachable('expected PIIError')
    } catch (error) {
      expect(error).toBeInstanceOf(PIIError)
      if (error instanceof PIIError) {
        expect(error.message).toMatch(/第 3 行/)
        expect(error.matches[0]?.line).toBe(3)
      }
    }
  })

  it('does not false-positive on normal score/count values or clean feedback', () => {
    // score / attempt stay unscanned; clean educational Chinese must pass.
    const evaluation = baseEvaluation({
      score: 100,
      attempt: 3,
      summary:
        '全部可验证证据通过，当前得分 100 分，比上一轮提高 20 分。'
        + '本轮已完成任务闭环，可进入下一项能力训练。',
      evidence: [
        {
          id: 'empty-input',
          kind: 'test',
          label: '空列表',
          dimensionId: 'correctness',
          visibility: 'public',
          state: 'passed',
          weight: 20,
          expected: '0',
          actual: '0',
          message: '空列表返回 0'
        },
        {
          id: 'basic-average',
          kind: 'test',
          label: '常规平均分',
          dimensionId: 'correctness',
          visibility: 'public',
          state: 'passed',
          weight: 20,
          expected: '90',
          actual: '90',
          message: '常规分数列表计算正确'
        }
      ]
    })

    expect(() => detectEvaluationPII(evaluation)).not.toThrow()
    // Numeric-looking scores must not be treated as student ids / phones.
    expect(findPIIInText('score', '100')).toEqual([])
    expect(findPIIInText('count', '3')).toEqual([])
    expect(findPIIInText('score', '80')).toEqual([])
  })

  it('covers all four PII kinds in isolation', () => {
    expect(findPIIInText('summary', '张三').map((m) => m.kind)).toContain(
      'chinese_name'
    )
    expect(findPIIInText('summary', '13900001111').map((m) => m.kind)).toContain(
      'phone'
    )
    expect(
      findPIIInText('summary', 'a@b.com').map((m) => m.kind)
    ).toContain('email')
    expect(
      findPIIInText('summary', '20190001').map((m) => m.kind)
    ).toContain('student_id')
  })
})
