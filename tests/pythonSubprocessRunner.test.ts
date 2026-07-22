// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { createAssignmentRegistry } from '../server/data/assignments'
import { PythonSubprocessRunner } from '../server/runner/PythonSubprocessRunner'

const assignment = createAssignmentRegistry().get('python-average')

if (!assignment) throw new Error('Demo assignment is missing')

describe('PythonSubprocessRunner', () => {
  it('executes the assignment tests and reports the empty-input defect', async () => {
    const runner = new PythonSubprocessRunner({ timeoutMs: 2_500 })

    const result = await runner.run({
      assignment,
      code: 'def calculate_average(scores):\n    return sum(scores) / len(scores)'
    })

    expect(result.status).toBe('completed')
    expect(result.evidence.find((item) => item.id === 'empty-input')).toMatchObject({
      state: 'failed',
      actual: 'ZeroDivisionError'
    })
    expect(result.evidence.find((item) => item.id === 'no-side-effects')).toMatchObject({
      state: 'passed'
    })
  })

  it('detects printing as a contract side effect', async () => {
    const runner = new PythonSubprocessRunner({ timeoutMs: 2_500 })

    const result = await runner.run({
      assignment,
      code:
        'def calculate_average(scores):\n    if not scores:\n        return 0\n    result = sum(scores) / len(scores)\n    print(result)\n    return result'
    })

    expect(result.status).toBe('completed')
    expect(result.evidence.find((item) => item.id === 'no-side-effects')).toMatchObject({
      state: 'failed'
    })
  })

  it('rejects imports before executing student code', async () => {
    const runner = new PythonSubprocessRunner({ timeoutMs: 2_500 })

    const result = await runner.run({
      assignment,
      code:
        'import os\n\ndef calculate_average(scores):\n    return sum(scores) / len(scores)'
    })

    expect(result.status).toBe('rejected')
    expect(result.reason).toContain('不允许导入模块')
  })
})
