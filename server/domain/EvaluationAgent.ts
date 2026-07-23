import { randomUUID } from 'node:crypto'
import type {
  AdvisorySuggestion,
  Diagnosis,
  DimensionResult,
  EvaluateRequest,
  EvaluationResult,
  EvidenceItem,
  MasterySignal,
  Provenance,
  TraceStep
} from '../../shared/contracts'
import type { AdvisoryService } from '../advisory/AdvisoryService'
import type {
  AssignmentRegistry,
  ExecutableAssignment
} from '../data/assignments'
import type { KnowledgeBase } from '../data/knowledge'
import type { RunnerRegistry } from '../runner/RunnerRegistry'
import type { RunnerResult } from '../runner/types'
import type { FeedbackGenerator } from './feedback'

interface EvaluationAgentDependencies {
  assignments: AssignmentRegistry
  knowledge: KnowledgeBase
  /** Routes by assignment.questionType (ADR-0008). */
  runners: RunnerRegistry
  feedback: FeedbackGenerator
  /**
   * Subjective coaching for essay (ADR-0008). Optional so unit tests can omit
   * it; production always injects AdvisoryService.
   */
  advisory?: AdvisoryService
}

const severityRank = { high: 0, medium: 1, low: 2 } as const

export class EvaluationAgent {
  public constructor(private readonly dependencies: EvaluationAgentDependencies) {}

  public async evaluate(
    request: EvaluateRequest,
    previous?: EvaluationResult
  ): Promise<EvaluationResult> {
    const trace: TraceStep[] = []
    const assignment = this.timeSyncStep(
      trace,
      'retrieve-assignment',
      '读取任务与评分量规',
      'assignment.retrieve',
      () => this.dependencies.assignments.get(request.assignmentId)
    )

    if (!assignment) {
      throw new Error(`Unknown assignment: ${request.assignmentId}`)
    }

    const runnerResult = await this.timeAsyncStep(
      trace,
      'run-submission',
      '在受限环境运行提交',
      'python.safe-runner',
      () =>
        this.dependencies.runners.run({
          assignment,
          submission: request.code,
          // Legacy alias kept so registry-routed code runners remain dual-readable.
          code: request.code
        })
    )

    if (runnerResult.status !== 'completed') {
      return this.createInterruptedResult(
        assignment,
        runnerResult,
        trace,
        previous
      )
    }

    const evidence = this.timeSyncStep(
      trace,
      'score-rubric',
      '将运行证据映射到量规',
      'rubric.score',
      () => this.mapEvidence(assignment, runnerResult)
    )
    const score = evidence.reduce(
      (total, item) => total + (item.state === 'passed' ? item.weight : 0),
      0
    )
    const dimensions = this.scoreDimensions(assignment, evidence)

    const diagnoses = this.timeSyncStep(
      trace,
      'retrieve-knowledge',
      '匹配薄弱概念与训练策略',
      'knowledge.retrieve',
      () => this.createDiagnoses(assignment, evidence)
    )
    const intervention = diagnoses[0]
      ? this.dependencies.knowledge.get(diagnoses[0].conceptId)?.intervention
      : undefined
    const feedback = await this.timeAsyncStep(
      trace,
      'compose-feedback',
      '生成受证据约束的反馈',
      'feedback.compose',
      () =>
        this.dependencies.feedback.generate({
          assignment,
          score,
          previousScore: previous?.score,
          evidence,
          diagnoses,
          intervention
        })
    )

    // Essay only: subjective dimensions stay out of the score (ADR-0008).
    const advisory = await this.maybeComposeAdvisory(
      assignment,
      request.code,
      trace
    )

    const evaluationId = `eval_${randomUUID()}`
    const provenance: Provenance = {
      kind: 'evidence',
      evidenceIds: evidence.map((item) => item.id),
      algorithm: 'simple.v1'
    }

    return {
      id: evaluationId,
      assignmentId: assignment.id,
      attempt: (previous?.attempt ?? 0) + 1,
      createdAt: new Date().toISOString(),
      status: 'completed',
      score,
      previousScore: previous?.score,
      scoreDelta: previous ? score - previous.score : undefined,
      summary: feedback.summary,
      evidence,
      dimensions,
      diagnoses,
      intervention,
      ...(advisory !== undefined ? { advisory } : {}),
      trace,
      mastery: this.createMastery(assignment, evidence),
      feedbackSource: feedback.source,
      provenance
    }
  }

  private async maybeComposeAdvisory(
    assignment: ExecutableAssignment,
    submission: string,
    trace: TraceStep[]
  ): Promise<AdvisorySuggestion[] | undefined> {
    if (assignment.questionType !== 'essay') {
      return undefined
    }
    const service = this.dependencies.advisory
    if (!service) {
      return undefined
    }

    return this.timeAsyncStep(
      trace,
      'compose-advisory',
      '生成作文主观建议（不入分）',
      'advisory.suggest',
      () => service.suggest({ submission, assignment })
    )
  }

  private mapEvidence(
    assignment: ExecutableAssignment,
    runnerResult: RunnerResult
  ): EvidenceItem[] {
    const byId = new Map(runnerResult.evidence.map((item) => [item.id, item]))

    return assignment.criteria.map((criterion) => {
      const runnerEvidence = byId.get(criterion.id)
      const state = runnerEvidence?.state ?? 'blocked'
      const contextualMessage =
        state === 'passed'
          ? criterion.passedMessage
          : `${criterion.failedMessage}${runnerEvidence?.message ? `：${runnerEvidence.message}` : ''}`

      return {
        id: criterion.id,
        kind: criterion.kind,
        label: criterion.label,
        dimensionId: criterion.dimensionId,
        visibility: criterion.visibility,
        state,
        weight: criterion.weight,
        expected: criterion.expected,
        actual: runnerEvidence?.actual,
        message: contextualMessage,
        conceptId: criterion.conceptId
      }
    })
  }

  private scoreDimensions(
    assignment: ExecutableAssignment,
    evidence: EvidenceItem[]
  ): DimensionResult[] {
    return assignment.rubric.map((dimension) => {
      const dimensionEvidence = evidence.filter(
        (item) => item.dimensionId === dimension.id
      )
      const earnedScore = dimensionEvidence.reduce(
        (total, item) => total + (item.state === 'passed' ? item.weight : 0),
        0
      )
      const hasFailure = dimensionEvidence.some((item) => item.state === 'failed')
      const hasBlocked = dimensionEvidence.some((item) => item.state === 'blocked')

      return {
        ...dimension,
        earnedScore,
        state: hasFailure ? 'failed' : hasBlocked ? 'blocked' : 'passed',
        evidenceIds: dimensionEvidence.map((item) => item.id)
      }
    })
  }

  private createDiagnoses(
    assignment: ExecutableAssignment,
    evidence: EvidenceItem[]
  ): Diagnosis[] {
    const failedConcepts = new Map<string, string[]>()

    for (const item of evidence) {
      if (item.state === 'passed' || !item.conceptId) continue
      failedConcepts.set(item.conceptId, [
        ...(failedConcepts.get(item.conceptId) ?? []),
        item.id
      ])
    }

    return [...failedConcepts.entries()]
      .map(([conceptId, evidenceIds]) => {
        const entry = this.dependencies.knowledge.get(conceptId)
        if (!entry) return undefined
        const failedWeight = assignment.criteria
          .filter(
            (criterion) =>
              criterion.conceptId === conceptId &&
              evidenceIds.includes(criterion.id)
          )
          .reduce((total, criterion) => total + criterion.weight, 0)

        return {
          ...entry.diagnosis,
          evidenceIds,
          failedWeight
        }
      })
      .filter(
        (item): item is Diagnosis & { failedWeight: number } => item !== undefined
      )
      .sort(
        (left, right) =>
          severityRank[left.severity] - severityRank[right.severity] ||
          right.failedWeight - left.failedWeight
      )
      .map((item) => ({
        conceptId: item.conceptId,
        title: item.title,
        explanation: item.explanation,
        severity: item.severity,
        evidenceIds: item.evidenceIds
      }))
  }

  private createMastery(
    assignment: ExecutableAssignment,
    evidence: EvidenceItem[]
  ): MasterySignal[] {
    const conceptIds = [...new Set(assignment.criteria.map((item) => item.conceptId))]

    return conceptIds.map((conceptId) => {
      const conceptEvidence = evidence.filter(
        (item) => item.conceptId === conceptId
      )
      const passedCount = conceptEvidence.filter(
        (item) => item.state === 'passed'
      ).length
      const label = this.dependencies.knowledge.get(conceptId)?.label ?? conceptId

      return {
        conceptId,
        label,
        level:
          passedCount === conceptEvidence.length
            ? 'demonstrated'
            : passedCount > 0
              ? 'developing'
              : 'needs-work',
        evidenceCount: conceptEvidence.length
      }
    })
  }

  private createInterruptedResult(
    assignment: ExecutableAssignment,
    runnerResult: RunnerResult,
    trace: TraceStep[],
    previous?: EvaluationResult
  ): EvaluationResult {
    trace.push({
      id: 'score-rubric',
      label: '将运行证据映射到量规',
      tool: 'rubric.score',
      status: 'skipped',
      summary: '运行器未完成，未计算分数',
      durationMs: 0
    })

    return {
      id: `eval_${randomUUID()}`,
      assignmentId: assignment.id,
      attempt: (previous?.attempt ?? 0) + 1,
      createdAt: new Date().toISOString(),
      status: runnerResult.status,
      score: 0,
      previousScore: previous?.score,
      scoreDelta: previous ? -previous.score : undefined,
      summary: runnerResult.reason ?? '运行器未能完成本轮验证。',
      evidence: [],
      dimensions: assignment.rubric.map((dimension) => ({
        ...dimension,
        earnedScore: 0,
        state: 'blocked',
        evidenceIds: []
      })),
      diagnoses: [],
      trace,
      mastery: [],
      feedbackSource: 'local-policy',
      rejectionReason: runnerResult.reason,
      provenance: {
        kind: 'evidence',
        evidenceIds: [],
        algorithm: 'simple.v1'
      }
    }
  }

  private timeSyncStep<T>(
    trace: TraceStep[],
    id: string,
    label: string,
    tool: string,
    operation: () => T
  ): T {
    const startedAt = performance.now()
    const result = operation()
    trace.push({
      id,
      label,
      tool,
      status: 'completed',
      summary: '完成',
      durationMs: Math.max(0, Math.round(performance.now() - startedAt))
    })
    return result
  }

  private async timeAsyncStep<T>(
    trace: TraceStep[],
    id: string,
    label: string,
    tool: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const startedAt = performance.now()
    try {
      const result = await operation()
      trace.push({
        id,
        label,
        tool,
        status: 'completed',
        summary: '完成',
        durationMs: Math.max(1, Math.round(performance.now() - startedAt))
      })
      return result
    } catch (error) {
      trace.push({
        id,
        label,
        tool,
        status: 'failed',
        summary: error instanceof Error ? error.message : '执行失败',
        durationMs: Math.max(1, Math.round(performance.now() - startedAt))
      })
      throw error
    }
  }
}
