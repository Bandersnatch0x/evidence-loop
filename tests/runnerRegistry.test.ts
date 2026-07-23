// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import { createAssignmentRegistry } from '../server/data/assignments'
import {
  createRunnerRegistry,
  RunnerRegistry,
  UnknownQuestionTypeError
} from '../server/runner/RunnerRegistry'
import type { CodeRunner, RunnerRequest, RunnerResult } from '../server/runner/types'

const assignment = createAssignmentRegistry().get('python-average')

if (!assignment) throw new Error('Demo assignment is missing')

function createRecordingRunner(name: string): CodeRunner & {
  calls: RunnerRequest[]
} {
  const calls: RunnerRequest[] = []
  return {
    name,
    calls,
    run(request: RunnerRequest): Promise<RunnerResult> {
      calls.push(request)
      return Promise.resolve({
        status: 'completed',
        durationMs: 1,
        evidence: []
      })
    }
  }
}

describe('RunnerRegistry', () => {
  it('routes code assignments to the registered code runner', async () => {
    const codeRunner = createRecordingRunner('python-stub')
    const registry = createRunnerRegistry(codeRunner)

    const request: RunnerRequest = {
      assignment,
      submission:
        'def calculate_average(scores):\n    return 0 if not scores else sum(scores) / len(scores)'
    }

    const result = await registry.run(request)

    expect(result.status).toBe('completed')
    expect(codeRunner.calls).toHaveLength(1)
    expect(codeRunner.calls[0]).toBe(request)
    expect(registry.displayName()).toBe('python-stub')
  })

  it('registers all multi-discipline validators by default', () => {
    const registry = createRunnerRegistry(createRecordingRunner('python-stub'))
    expect(registry.has('code')).toBe(true)
    expect(registry.has('choice')).toBe(true)
    expect(registry.has('fill_blank')).toBe(true)
    expect(registry.has('numeric')).toBe(true)
    expect(registry.has('expression')).toBe(true)
    expect(registry.has('chem_equation')).toBe(true)
    expect(registry.has('essay')).toBe(true)
  })

  it('throws UnknownQuestionTypeError when a type was never registered', async () => {
    const registry = new RunnerRegistry()
    // intentionally empty — no createRunnerRegistry defaults

    await expect(
      registry.run({
        assignment,
        submission: 'print(1)'
      })
    ).rejects.toBeInstanceOf(UnknownQuestionTypeError)

    expect(() => registry.get('essay')).toThrow(UnknownQuestionTypeError)
    expect(() => registry.get('essay')).toThrow(
      'No runner registered for question type: essay'
    )
    expect(registry.has('code')).toBe(false)
    expect(registry.has('essay')).toBe(false)
  })

  it('forwards warm and dispose to registered runners', async () => {
    const warm = vi.fn(() => Promise.resolve())
    const dispose = vi.fn(() => Promise.resolve())
    const codeRunner: CodeRunner = {
      name: 'lifecycle',
      run: () =>
        Promise.resolve({ status: 'completed', durationMs: 1, evidence: [] }),
      warm,
      dispose
    }

    const registry = createRunnerRegistry(codeRunner)
    await registry.warm()
    await registry.dispose()

    // Code runner plus shared objective + expression + chem + essay
    expect(warm).toHaveBeenCalledTimes(1)
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('routes choice assignment to objective validator', async () => {
    const registry = createRunnerRegistry(createRecordingRunner('python-stub'))
    const choice = createAssignmentRegistry().get('choice-algebra-simplify')
    if (!choice) throw new Error('missing choice assignment')

    const result = await registry.run({
      assignment: choice,
      submission: 'B'
    })
    expect(result.status).toBe('completed')
    expect(result.evidence[0]?.state).toBe('passed')
  })
})
