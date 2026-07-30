// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { createAssignmentRegistry } from '../server/data/assignments'
import { createRunnerRegistry } from '../server/runner/RunnerRegistry'
import type { CodeRunner } from '../server/runner/types'

// Minimal stub code runner — not exercised by expression questions.
const stubCodeRunner: CodeRunner = {
  name: 'python-stub',
  run() {
    return Promise.resolve({ status: 'completed', durationMs: 0, evidence: [] })
  }
}

const assignment = createAssignmentRegistry().get('physics-projectile-y')

if (!assignment) {
  throw new Error('physics-projectile-y assignment not registered')
}

describe('physics-projectile-y assignment · runner integration', () => {
  const registry = createRunnerRegistry(stubCodeRunner)

  it('registers the assignment and routes it to the expression runner', () => {
    expect(assignment.questionType).toBe('expression')
    expect(assignment.language).toBe('physics')
    expect(registry.has('expression')).toBe(true)
  })

  it('passes the correct demo variant (`y = RHS` matches expected RHS)', async () => {
    const correct = assignment.demoVariants.find((v) => v.id === 'correct')
    if (!correct) throw new Error('correct variant missing')

    const result = await registry.run({ assignment, submission: correct.code })
    expect(result.status).toBe('completed')
    const final = result.evidence.find((e) => e.id === 'cas-final')
    expect(final?.state).toBe('passed')
  })

  it('fails (not blocks) the wrong demo variant', async () => {
    const wrong = assignment.demoVariants.find((v) => v.id === 'wrong')
    if (!wrong) throw new Error('wrong variant missing')

    const result = await registry.run({ assignment, submission: wrong.code })
    expect(result.status).toBe('completed')
    const final = result.evidence.find((e) => e.id === 'cas-final')
    expect(final?.state).toBe('failed')
  })

  it('blocks on unparseable garbage, still completing the run', async () => {
    const result = await registry.run({ assignment, submission: '@@@not an equation@@@' })
    expect(result.status).toBe('completed')
    const final = result.evidence.find((e) => e.id === 'cas-final')
    // Garbage → mathjs parse failure surfaces as blocked (not passed/failed).
    expect(final?.state).toBe('blocked')
  })
})
