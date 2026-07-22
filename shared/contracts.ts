export type EvaluationStatus = 'completed' | 'rejected' | 'failed'

export type EvidenceKind = 'test' | 'static'

export type EvidenceVisibility = 'public' | 'hidden'

export type ResultState = 'passed' | 'failed' | 'blocked'

export interface RubricDimension {
  id: string
  label: string
  description: string
  maxScore: number
}

export interface DemoVariant {
  id: string
  label: string
  description: string
  code: string
}

export interface AssignmentSummary {
  id: string
  title: string
  module: string
  language: 'python'
  estimatedMinutes: number
  status: 'ready' | 'coming-soon'
}

export interface Assignment extends AssignmentSummary {
  objective: string
  scenario: string
  requirements: string[]
  constraints: string[]
  functionSignature: string
  rubric: RubricDimension[]
  demoVariants: DemoVariant[]
}

export interface EvidenceItem {
  id: string
  kind: EvidenceKind
  label: string
  dimensionId: string
  visibility: EvidenceVisibility
  state: ResultState
  weight: number
  expected?: string
  actual?: string
  message: string
  conceptId?: string
}

export interface DimensionResult extends RubricDimension {
  earnedScore: number
  state: ResultState
  evidenceIds: string[]
}

export interface Diagnosis {
  conceptId: string
  title: string
  explanation: string
  severity: 'high' | 'medium' | 'low'
  evidenceIds: string[]
}

export interface Intervention {
  conceptId: string
  title: string
  rationale: string
  instruction: string
  successCriteria: string[]
  hints: string[]
}

export interface TraceStep {
  id: string
  label: string
  tool: string
  status: 'completed' | 'skipped' | 'failed'
  summary: string
  durationMs: number
}

export interface MasterySignal {
  conceptId: string
  label: string
  level: 'needs-work' | 'developing' | 'demonstrated'
  evidenceCount: number
}

export interface EvaluationResult {
  id: string
  assignmentId: string
  attempt: number
  createdAt: string
  status: EvaluationStatus
  score: number
  previousScore?: number
  scoreDelta?: number
  summary: string
  evidence: EvidenceItem[]
  dimensions: DimensionResult[]
  diagnoses: Diagnosis[]
  intervention?: Intervention
  trace: TraceStep[]
  mastery: MasterySignal[]
  feedbackSource: 'local-policy' | 'llm'
  rejectionReason?: string
}

export interface EvaluateRequest {
  assignmentId: string
  code: string
  previousEvaluationId?: string
}

export interface EvaluationHistoryItem {
  id: string
  assignmentId: string
  attempt: number
  createdAt: string
  score: number
  scoreDelta?: number
  status: EvaluationStatus
}

export interface CohortLearner {
  id: string
  displayName: string
  assignmentTitle: string
  attempts: number
  latestScore: number
  delta: number
  focusConcept: string
  state: 'on-track' | 'needs-attention' | 'not-started'
  lastActiveAt: string
}

export interface CohortSnapshot {
  cohortName: string
  generatedAt: string
  completionRate: number
  medianScore: number
  needsAttention: number
  learners: CohortLearner[]
}

export interface ApiError {
  error: string
  details?: string[]
}
