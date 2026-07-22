import type { ExecutableAssignment } from '../data/assignments'

export interface RunnerEvidence {
  id: string
  state: 'passed' | 'failed' | 'blocked'
  actual?: string
  message: string
}

export interface RunnerResult {
  status: 'completed' | 'rejected' | 'failed'
  durationMs: number
  evidence: RunnerEvidence[]
  reason?: string
}

export interface RunnerRequest {
  assignment: ExecutableAssignment
  code: string
}

export interface CodeRunner {
  run(request: RunnerRequest): Promise<RunnerResult>
}
