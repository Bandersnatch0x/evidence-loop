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
  /** Populated by container runners when a pool container id is known. */
  containerId?: string
}

/**
 * Generic runner input for any question type.
 *
 * Prefer `submission` (code / LaTeX / free text). Legacy `code` is still
 * accepted so existing runners and tests remain valid without a hard cutover.
 * When both are set, `submission` wins.
 */
export interface RunnerRequest {
  assignment: ExecutableAssignment
  /** Learner submission: source code, LaTeX, free text, etc. */
  submission?: string
  /**
   * @deprecated Prefer `submission`. Retained as a backward-compatible alias.
   */
  code?: string
}

/** Resolve submission content; `submission` wins over legacy `code`. */
export function resolveSubmission(request: RunnerRequest): string {
  if (request.submission !== undefined) {
    return request.submission
  }
  if (request.code !== undefined) {
    return request.code
  }
  throw new Error('RunnerRequest requires submission (or legacy code)')
}

export interface CodeRunner {
  run(request: RunnerRequest): Promise<RunnerResult>
  readonly name?: string
  warm?(): Promise<void>
  dispose?(): Promise<void>
}
