// @vitest-environment node

import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { createAssignmentRegistry } from '../server/data/assignments'
import {
  buildDockerNetworkProbeArgs,
  buildDockerRunArgs,
  DockerPythonRunner,
  type DockerCommandExecutor,
  type DockerCommandResult
} from '../server/runner/DockerPythonRunner'
import type { RunnerRequest } from '../server/runner/types'

const assignment = createAssignmentRegistry().get('python-average')

if (!assignment) throw new Error('Demo assignment is missing')

const request: RunnerRequest = {
  assignment,
  code: 'def calculate_average(scores):\n    return 0 if not scores else sum(scores) / len(scores)'
}

interface DockerCall {
  args: string[]
  input?: string
  options?: {
    timeoutMs?: number
    maxOutputBytes?: number
  }
}

class FakeDockerExecutor implements DockerCommandExecutor {
  public readonly calls: DockerCall[] = []
  public networkProbeExitCode = 0
  public nextExecutionResult: DockerCommandResult | undefined
  public nextInspectionResult: DockerCommandResult | undefined

  private nextContainerNumber = 1
  private holdNext = false
  private heldExecution:
    | { resolve: (result: DockerCommandResult) => void }
    | undefined

  public holdNextExecution(): void {
    this.holdNext = true
  }

  public hasHeldExecution(): boolean {
    return this.heldExecution !== undefined
  }

  public releaseHeldExecution(): void {
    if (!this.heldExecution) throw new Error('No Docker execution is waiting')
    this.heldExecution.resolve(successfulEvaluationResult())
    this.heldExecution = undefined
  }

  public execute(
    args: readonly string[],
    input?: string,
    options?: { timeoutMs?: number; maxOutputBytes?: number }
  ): Promise<DockerCommandResult> {
    const normalizedArgs = [...args]
    this.calls.push({ args: normalizedArgs, input, options })

    if (normalizedArgs[0] === 'run') {
      const containerId = `container-${String(this.nextContainerNumber)}`
      this.nextContainerNumber += 1
      return Promise.resolve(successfulCommand(`${containerId}\n`))
    }

    if (normalizedArgs[0] === 'rm') {
      return Promise.resolve(successfulCommand())
    }

    if (normalizedArgs[0] === 'inspect') {
      if (this.nextInspectionResult) {
        const result = this.nextInspectionResult
        this.nextInspectionResult = undefined
        return Promise.resolve(result)
      }
      return Promise.resolve(successfulCommand('true\n'))
    }

    if (isNetworkProbe(normalizedArgs)) {
      return Promise.resolve({
        exitCode: this.networkProbeExitCode,
        stdout: '',
        stderr: ''
      })
    }

    if (normalizedArgs[0] === 'exec') {
      if (this.nextExecutionResult) {
        const result = this.nextExecutionResult
        this.nextExecutionResult = undefined
        return Promise.resolve(result)
      }

      if (this.holdNext) {
        this.holdNext = false
        return new Promise((resolve) => {
          this.heldExecution = { resolve }
        })
      }

      return Promise.resolve(successfulEvaluationResult())
    }

    return Promise.resolve({
      exitCode: 1,
      stdout: '',
      stderr: `Unexpected Docker command: ${normalizedArgs.join(' ')}`
    })
  }
}

describe('DockerPythonRunner', () => {
  it('builds a hardened, network-disabled pool container command', () => {
    const args = buildDockerRunArgs({
      image: 'evidence-loop/python-runner:test',
      memory: '128m',
      memorySwap: '128m',
      cpus: '0.5',
      tmpfs: '/tmp:noexec,nosuid,size=100m',
      user: '65532:65532',
      pidsLimit: 64
    })

    expect(args).toEqual(
      expect.arrayContaining([
        'run',
        '--rm',
        '-d',
        '--network=none',
        '--memory=128m',
        '--memory-swap=128m',
        '--cpus=0.5',
        '--read-only',
        '--security-opt=no-new-privileges',
        '--cap-drop=ALL',
        '--pids-limit=64',
        '--user=65532:65532',
        '/tmp:noexec,nosuid,size=100m'
      ])
    )
    expect(args.join('\n')).toContain('while True:')
  })

  it('reuses a warm slot and queues work while the slot is busy', async () => {
    const executor = new FakeDockerExecutor()
    const runner = new DockerPythonRunner({ executor, poolSize: 1 })

    await runner.warm()
    executor.holdNextExecution()

    const first = runner.run(request)
    await waitUntil(() => executor.hasHeldExecution())

    const second = runner.run(request)
    await waitUntil(() => runner.getPoolStats().waiters === 1)

    expect(runner.getPoolStats()).toMatchObject({
      size: 1,
      available: 0,
      busy: 1,
      waiters: 1
    })

    executor.releaseHeldExecution()
    const results = await Promise.all([first, second])

    expect(results.map((result) => result.status)).toEqual([
      'completed',
      'completed'
    ])
    expect(containerRuns(executor.calls)).toHaveLength(1)
    expect(harnessContainerIds(executor.calls)).toEqual([
      'container-1',
      'container-1'
    ])

    await runner.dispose()
    expect(removedContainerIds(executor.calls)).toContain('container-1')
  })

  it('fails startup and removes a pool container that exits immediately', async () => {
    const executor = new FakeDockerExecutor()
    const runner = new DockerPythonRunner({ executor, poolSize: 1 })
    executor.nextInspectionResult = successfulCommand('false\n')

    await expect(runner.warm()).rejects.toThrow(
      'Docker pool container did not remain running.'
    )
    expect(removedContainerIds(executor.calls)).toContain('container-1')
    expect(runner.getPoolStats()).toMatchObject({ size: 0, available: 0 })

    await runner.dispose()
  })

  it('removes and replaces an unhealthy slot after execution timeout', async () => {
    const executor = new FakeDockerExecutor()
    const runner = new DockerPythonRunner({ executor, poolSize: 1 })
    executor.nextExecutionResult = {
      exitCode: null,
      stdout: '',
      stderr: '',
      timedOut: true
    }

    await runner.warm()
    const result = await runner.run(request)

    expect(result).toMatchObject({
      status: 'failed',
      evidence: []
    })
    expect(result.reason).toContain('timed out')

    await waitUntil(() => containerRuns(executor.calls).length === 2)
    expect(removedContainerIds(executor.calls)).toContain('container-1')
    expect(runner.getPoolStats()).toMatchObject({ size: 1, available: 1 })

    await runner.dispose()
    expect(removedContainerIds(executor.calls)).toEqual(
      expect.arrayContaining(['container-1', 'container-2'])
    )
  })

  it('destroys a slot when the outbound network probe succeeds', async () => {
    const executor = new FakeDockerExecutor()
    const runner = new DockerPythonRunner({ executor, poolSize: 1 })
    executor.networkProbeExitCode = 1

    await runner.warm()
    await expect(runner.verifyNetworkIsolation()).resolves.toBe(false)

    await waitUntil(() => containerRuns(executor.calls).length === 2)
    const probe = executor.calls.find((call) => isNetworkProbe(call.args))
    expect(probe?.args).toEqual(buildDockerNetworkProbeArgs('container-1'))
    expect(removedContainerIds(executor.calls)).toContain('container-1')

    await runner.dispose()
  })
})

const dockerBin = process.env.DOCKER_BIN ?? 'docker'
const dockerImage = process.env.DOCKER_RUNNER_IMAGE ?? 'python:3.12-slim'
const runDockerIntegration =
  process.env.RUN_DOCKER_INTEGRATION === '1' ||
  hasUsableDockerImage(dockerBin, dockerImage)

describe('DockerPythonRunner integration', () => {
  it.runIf(runDockerIntegration)(
    'blocks outbound TCP from a real Docker pool container',
    async () => {
      const runner = new DockerPythonRunner({
        dockerBin,
        image: dockerImage,
        poolSize: 1,
        timeoutMs: 3_000,
        startupTimeoutMs: 30_000
      })

      try {
        await runner.warm()
        await expect(runner.verifyNetworkIsolation()).resolves.toBe(true)
      } finally {
        await runner.dispose()
      }
    },
    45_000
  )
})

function successfulCommand(stdout = ''): DockerCommandResult {
  return { exitCode: 0, stdout, stderr: '' }
}

function successfulEvaluationResult(): DockerCommandResult {
  return successfulCommand(
    JSON.stringify({ status: 'completed', evidence: [] })
  )
}

function isNetworkProbe(args: readonly string[]): boolean {
  return args.some((argument) => argument.includes('socket.create_connection'))
}

function containerRuns(calls: readonly DockerCall[]): DockerCall[] {
  return calls.filter((call) => call.args[0] === 'run')
}

function harnessContainerIds(calls: readonly DockerCall[]): string[] {
  return calls
    .filter((call) => call.args[0] === 'exec' && !isNetworkProbe(call.args))
    .map((call) => call.args[2] ?? '')
}

function removedContainerIds(calls: readonly DockerCall[]): string[] {
  return calls
    .filter((call) => call.args[0] === 'rm' && call.args[1] === '-f')
    .map((call) => call.args[2] ?? '')
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('Timed out waiting for asynchronous Docker runner work')
}

function hasUsableDockerImage(bin: string, image: string): boolean {
  const options = {
    stdio: 'ignore' as const,
    timeout: 5_000,
    windowsHide: true
  }
  const daemon = spawnSync(bin, ['info'], options)
  if (daemon.status !== 0) return false
  return spawnSync(bin, ['image', 'inspect', image], options).status === 0
}
