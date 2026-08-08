import type { EvaluationResult } from '../../../shared/contracts'
import { DEFAULT_EVIDENCE_PROVENANCE } from '../../../shared/contracts'

/**
 * P2-2 透明度页演示用证据流 fixture。
 *
 * 客户端无 GET /api/evaluations/:id 端点，无法取历史完整 EvaluationResult，
 * 故透明度页用此真实感 fixture 展示"证据如何变成分数"的概念。数据结构与
 * 真实评估一致（EvidenceItem / DimensionResult / score），讲述一条清晰的
 * 归约故事：空序列边界证据失败 -> 拉低功能正确性维度 -> 部分得分。
 */
export const demoEvaluationFlow: EvaluationResult = {
  id: 'eval-flow-demo',
  assignmentId: 'python-average',
  attempt: 1,
  createdAt: '2026-08-08T08:00:00.000Z',
  status: 'completed',
  score: 67,
  summary: '空序列边界未处理，拉低功能正确性维度。',
  evidence: [
    {
      id: 'empty-input',
      kind: 'test',
      label: '空序列边界',
      dimensionId: 'correctness',
      visibility: 'hidden',
      state: 'failed',
      weight: 20,
      expected: '0',
      actual: 'ZeroDivisionError',
      message: '空列表路径没有返回约定结果',
      source: 'test_case'
    },
    {
      id: 'normal-input',
      kind: 'test',
      label: '正常输入',
      dimensionId: 'correctness',
      visibility: 'public',
      state: 'passed',
      weight: 30,
      message: '正常列表计算正确',
      source: 'test_case'
    },
    {
      id: 'large-input',
      kind: 'test',
      label: '大数精度',
      dimensionId: 'correctness',
      visibility: 'public',
      state: 'passed',
      weight: 10,
      message: '大数求和精度无损失',
      source: 'test_case'
    }
  ],
  dimensions: [
    {
      id: 'correctness',
      label: '功能正确性',
      description: '测试结果',
      maxScore: 60,
      earnedScore: 40,
      state: 'failed',
      evidenceIds: ['empty-input', 'normal-input', 'large-input']
    }
  ],
  diagnoses: [],
  trace: [],
  mastery: [],
  feedbackSource: 'local-policy',
  provenance: DEFAULT_EVIDENCE_PROVENANCE
}
