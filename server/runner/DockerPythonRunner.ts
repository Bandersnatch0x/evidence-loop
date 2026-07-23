import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { isPythonRunnerSpec } from '../data/assignments'
import type { CodeRunner, RunnerRequest, RunnerResult } from './types'
import { resolveSubmission } from './types'
import { PYTHON_HARNESS } from './PythonSubprocessRunner'

const MAX_OUTPUT_BYTES = 64 * 1024
const DEFAULT_IMAGE = 'python:3.12-slim'
const DEFAULT_MEMORY = '128m'
const DEFAULT_CPUS = '0.5'
const DEFAULT_TMPFS = '/tmp:noexec,nosuid,size=100m'
const DEFAULT_USER = '65532:65532'
const DEFAULT_PIDS_LIMIT = 64
const DEFAULT_POOL_SIZE = 2
const DEFAULT_TIMEOUT_MS = 1_500
const DEFAULT_STARTUP_TIMEOUT_MS = 15_000
const IDLE_CONTAINER_SCRIPT = [
  'import time',
  'while True:',
  '    time.sleep(3600)'
].join('\n')
const NETWORK_PROBE_SCRIPT = [
  'import socket',
  'try:',
  '    socket.create_connection(("1.1.1.1", 80), 1)',
  'except OSError:',
  '    raise SystemExit(0)',
  'raise SystemExit(1)'
].join('\n')

export interface DockerCommandResult {
  exitCode: number | null
  stdout: string
  stderr: string
  error?: string
  timedOut?: boolean
  outputLimitExceeded?: boolean
}

export interface DockerCommandExecutor {
  execute(
    args: readonly string[],
    input?: string,
    options?: {
      timeoutMs?: number
      maxOutputBytes?: number
    }
  ): Promise<DockerCommandResult>
}

export interface DockerPythonRunnerOptions {
  dockerBin?: string
  image?: string
  poolSize?: number
  timeoutMs?: number
  startupTimeoutMs?: number
  memory?: string
  memorySwap?: string
  cpus?: string
  tmpfs?: string
  user?: string
  pidsLimit?: number
  maxOutputBytes?: number
  executor?: DockerCommandExecutor
}

export interface DockerRunConfig {
  image: string
  memory: string
  memorySwap: string
  cpus: string
  tmpfs: string
  user: string
  pidsLimit: number
}

export interface DockerPoolStats {
  size: number
  available: number
  busy: number
  waiters: number
  disposed: boolean
}

interface PoolSlot {
  id: string
  busy: boolean
}

interface PoolWaiter {
  resolve: (slot: PoolSlot) => void
  reject: (error: Error) => void
}

/** Builds the hardened, long-lived container used as a hot pool slot. */
export function buildDockerRunArgs(config: DockerRunConfig): string[] {
  const args = [
    'run',
    '--rm',
    '-d',
    '--network=none',
    `--memory=${config.memory}`,
    `--memory-swap=${config.memorySwap}`,
    `--cpus=${config.cpus}`,
    '--read-only',
    '--tmpfs',
    config.tmpfs,
    '--security-opt=no-new-privileges',
    '--cap-drop=ALL',
    `--pids-limit=${String(config.pidsLimit)}`
  ]

  args.push(`--user=${config.user}`)

  args.push(
    config.image,
    'python',
    '-I',
    '-S',
    '-u',
    '-c',
    IDLE_CONTAINER_SCRIPT
  )

  return args
}

export function buildDockerExecArgs(
  containerId: string,
  command: readonly string[] = [
    'python',
    '-I',
    '-S',
    '-u',
    '-c',
    PYTHON_HARNESS
  ]
): string[] {
  return ['exec', '-i', containerId, ...command]
}

export function buildDockerRemoveArgs(containerId: string): string[] {
  return ['rm', '-f', containerId]
}

export function buildDockerInspectArgs(containerId: string): string[] {
  return ['inspect', '--format={{.State.Running}}', containerId]
}

export function buildDockerNetworkProbeArgs(containerId: string): string[] {
  return buildDockerExecArgs(containerId, [
    'python',
    '-I',
    '-S',
    '-u',
    '-c',
    NETWORK_PROBE_SCRIPT
  ])
}

export class DockerPythonRunner implements CodeRunner {
  public readonly name = 'docker'

  private readonly executor: DockerCommandExecutor
  private readonly config: DockerRunConfig
  private readonly poolSize: number
  private readonly timeoutMs: number
  private readonly startupTimeoutMs: number
  private readonly maxOutputBytes: number
  private readonly slots = new Map<string, PoolSlot>()
  private readonly available: PoolSlot[] = []
  private readonly waiters: PoolWaiter[] = []
  private readonly pendingRemovals = new Set<Promise<void>>()
  private fillPromise: Promise<void> | undefined
  private disposePromise: Promise<void> | undefined
  private disposed = false

  public constructor(options: DockerPythonRunnerOptions = {}) {
    this.poolSize = positiveInteger(options.poolSize ?? DEFAULT_POOL_SIZE, 'poolSize')
    this.timeoutMs = positiveInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 'timeoutMs')
    this.startupTimeoutMs = positiveInteger(
      options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
      'startupTimeoutMs'
    )
    this.maxOutputBytes = positiveInteger(
      options.maxOutputBytes ?? MAX_OUTPUT_BYTES,
      'maxOutputBytes'
    )
    this.config = {
      image: nonEmptyString(options.image ?? DEFAULT_IMAGE, 'image'),
      memory: nonEmptyString(options.memory ?? DEFAULT_MEMORY, 'memory'),
      memorySwap: nonEmptyString(
        options.memorySwap ?? options.memory ?? DEFAULT_MEMORY,
        'memorySwap'
      ),
      cpus: nonEmptyString(options.cpus ?? DEFAULT_CPUS, 'cpus'),
      tmpfs: nonEmptyString(options.tmpfs ?? DEFAULT_TMPFS, 'tmpfs'),
      user: nonEmptyString(options.user ?? DEFAULT_USER, 'user'),
      pidsLimit: positiveInteger(
        options.pidsLimit ?? DEFAULT_PIDS_LIMIT,
        'pidsLimit'
      )
    }
    this.executor =
      options.executor ??
      new SpawnDockerCommandExecutor(
        nonEmptyString(
          options.dockerBin ?? process.env.DOCKER_BIN ?? 'docker',
          'dockerBin'
        )
      )
  }

  public async warm(): Promise<void> {
    await this.ensurePool()
  }

  public getPoolStats(): DockerPoolStats {
    return {
      size: this.slots.size,
      available: this.available.length,
      busy: [...this.slots.values()].filter((slot) => slot.busy).length,
      waiters: this.waiters.length,
      disposed: this.disposed
    }
  }

  public async run(request: RunnerRequest): Promise<RunnerResult> {
    const startedAt = performance.now()
    let slot: PoolSlot | undefined
    let healthy = true

    try {
      const runnerSpec = request.assignment.runner
      if (!isPythonRunnerSpec(runnerSpec)) {
        return this.failedResult(
          startedAt,
          'Docker Python runner requires a PythonRunnerSpec (questionType: code).'
        )
      }

      await this.ensurePool()
      slot = await this.acquireSlot()

      const command = await this.executor.execute(
        buildDockerExecArgs(slot.id),
        JSON.stringify({
          code: resolveSubmission(request),
          functionName: runnerSpec.functionName,
          maxAstNodes: runnerSpec.maxAstNodes,
          testCases: runnerSpec.testCases
        }),
        { timeoutMs: this.timeoutMs, maxOutputBytes: this.maxOutputBytes }
      )

      if (
        command.error ||
        command.timedOut ||
        command.outputLimitExceeded ||
        command.exitCode !== 0
      ) {
        healthy = false
        return this.failedResult(
          startedAt,
          this.commandFailureReason(command, 'Docker execution')
        )
      }

      const output = command.stdout.trim()
      try {
        const parsed: unknown = JSON.parse(output)
        if (!isRunnerResultWithoutDuration(parsed)) {
          healthy = false
          return this.failedResult(
            startedAt,
            'Docker execution returned an invalid evaluation result.'
          )
        }

        return {
          ...parsed,
          durationMs: Math.max(1, Math.round(performance.now() - startedAt))
        }
      } catch {
        healthy = false
        return this.failedResult(
          startedAt,
          'Unable to parse the Docker execution result.'
        )
      }
    } catch (error) {
      healthy = false
      return this.failedResult(startedAt, this.errorMessage(error))
    } finally {
      if (slot) this.releaseSlot(slot, healthy)
    }
  }

  /** Returns true only when the pooled container rejects an outbound TCP connection. */
  public async verifyNetworkIsolation(): Promise<boolean> {
    await this.ensurePool()
    const slot = await this.acquireSlot()
    let healthy = false

    try {
      const command = await this.executor.execute(
        buildDockerNetworkProbeArgs(slot.id),
        undefined,
        { timeoutMs: this.timeoutMs, maxOutputBytes: this.maxOutputBytes }
      )
      healthy =
        !command.error &&
        !command.timedOut &&
        !command.outputLimitExceeded &&
        command.exitCode === 0
      return healthy
    } finally {
      this.releaseSlot(slot, healthy)
    }
  }

  public async dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise

    this.disposed = true
    this.rejectWaiters(new Error('Docker runner has been disposed.'))
    this.disposePromise = (async () => {
      if (this.fillPromise) {
        await Promise.allSettled([this.fillPromise])
      }

      const containerIds = [...this.slots.keys()]
      this.slots.clear()
      this.available.length = 0

      await Promise.allSettled([
        ...containerIds.map((containerId) => this.removeContainer(containerId)),
        ...this.pendingRemovals
      ])
    })()

    return this.disposePromise
  }

  private ensurePool(): Promise<void> {
    if (this.disposed) {
      return Promise.reject(new Error('Docker runner has been disposed.'))
    }
    if (this.slots.size >= this.poolSize) return Promise.resolve()
    if (this.fillPromise) return this.fillPromise

    const fillPromise = this.fillPool()
    this.fillPromise = fillPromise
    void fillPromise
      .catch((error: unknown) => {
        this.rejectWaiters(
          error instanceof Error
            ? error
            : new Error('Docker container pool initialization failed.')
        )
      })
      .finally(() => {
        if (this.fillPromise === fillPromise) this.fillPromise = undefined
      })

    return fillPromise
  }

  private async fillPool(): Promise<void> {
    const missing = this.poolSize - this.slots.size
    if (missing <= 0) return

    const results = await Promise.allSettled(
      Array.from({ length: missing }, () => this.createContainer())
    )
    const failures = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    )

    this.dispatchWaiters()

    if (failures.length > 0) {
      const firstFailure: unknown = failures[0]?.reason
      throw firstFailure instanceof Error
        ? firstFailure
        : new Error('Docker container pool initialization failed.')
    }
  }

  private async createContainer(): Promise<PoolSlot> {
    const command = await this.executor.execute(
      buildDockerRunArgs(this.config),
      undefined,
      { timeoutMs: this.startupTimeoutMs, maxOutputBytes: 1024 }
    )

    if (
      command.error ||
      command.timedOut ||
      command.outputLimitExceeded ||
      command.exitCode !== 0
    ) {
      throw new Error(this.commandFailureReason(command, 'Docker container startup'))
    }

    const containerId = command.stdout.trim().split(/\s+/u)[0]
    if (!containerId) throw new Error('Docker did not return a container ID.')

    if (this.disposed) {
      await this.removeContainer(containerId)
      throw new Error('Docker runner has been disposed.')
    }

    const inspection = await this.executor.execute(
      buildDockerInspectArgs(containerId),
      undefined,
      { timeoutMs: this.startupTimeoutMs, maxOutputBytes: 1024 }
    )
    if (
      inspection.error ||
      inspection.timedOut ||
      inspection.outputLimitExceeded ||
      inspection.exitCode !== 0
    ) {
      await this.removeContainer(containerId)
      throw new Error(
        this.commandFailureReason(inspection, 'Docker container inspection')
      )
    }
    if (inspection.stdout.trim() !== 'true') {
      await this.removeContainer(containerId)
      throw new Error('Docker pool container did not remain running.')
    }

    if (this.disposed) {
      await this.removeContainer(containerId)
      throw new Error('Docker runner has been disposed.')
    }

    const slot: PoolSlot = { id: containerId, busy: false }
    this.slots.set(containerId, slot)
    this.available.push(slot)
    this.dispatchWaiters()
    return slot
  }

  private acquireSlot(): Promise<PoolSlot> {
    if (this.disposed) {
      return Promise.reject(new Error('Docker runner has been disposed.'))
    }

    const slot = this.available.shift()
    if (slot) {
      slot.busy = true
      return Promise.resolve(slot)
    }

    return new Promise<PoolSlot>((resolve, reject) => {
      this.waiters.push({ resolve, reject })
      this.dispatchWaiters()
    })
  }

  private releaseSlot(slot: PoolSlot, healthy: boolean): void {
    if (this.slots.get(slot.id) !== slot) return

    slot.busy = false
    if (healthy && !this.disposed) {
      this.available.push(slot)
      this.dispatchWaiters()
      return
    }

    this.slots.delete(slot.id)
    const index = this.available.indexOf(slot)
    if (index >= 0) this.available.splice(index, 1)
    this.dispatchWaiters()

    const removal = this.removeContainer(slot.id)
      .catch(() => undefined)
      .finally(() => {
        this.pendingRemovals.delete(removal)
        if (!this.disposed) {
          void this.ensurePool().catch((error: unknown) => {
            this.rejectWaiters(
              error instanceof Error
                ? error
                : new Error('Docker container pool refill failed.')
            )
          })
        }
      })
    this.pendingRemovals.add(removal)
  }

  private dispatchWaiters(): void {
    while (this.available.length > 0 && this.waiters.length > 0) {
      const slot = this.available.shift()
      const waiter = this.waiters.shift()
      if (!slot || !waiter) return
      slot.busy = true
      waiter.resolve(slot)
    }
  }

  private rejectWaiters(error: Error): void {
    while (this.waiters.length > 0) {
      this.waiters.shift()?.reject(error)
    }
  }

  private async removeContainer(containerId: string): Promise<void> {
    await this.executor.execute(buildDockerRemoveArgs(containerId), undefined, {
      timeoutMs: Math.min(this.startupTimeoutMs, 5_000),
      maxOutputBytes: 1024
    })
  }

  private failedResult(startedAt: number, reason: string): RunnerResult {
    return {
      status: 'failed',
      durationMs: Math.max(1, Math.round(performance.now() - startedAt)),
      evidence: [],
      reason
    }
  }

  private commandFailureReason(
    command: DockerCommandResult,
    operation: string
  ): string {
    if (command.timedOut) return `${operation} timed out; the task was terminated.`
    if (command.outputLimitExceeded) {
      return `${operation} exceeded the output limit; the task was terminated.`
    }
    if (command.error) return `${operation} failed to start: ${command.error}`
    return (
      command.stderr.trim().slice(0, 500) ||
      `${operation} exited unexpectedly with code ${String(command.exitCode)}.`
    )
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error
      ? error.message
      : 'Docker runner could not complete the task.'
  }
}

class SpawnDockerCommandExecutor implements DockerCommandExecutor {
  public constructor(private readonly dockerBin: string) {}

  public execute(
    args: readonly string[],
    input?: string,
    options: { timeoutMs?: number; maxOutputBytes?: number } = {}
  ): Promise<DockerCommandResult> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS
    const maxOutputBytes = options.maxOutputBytes ?? MAX_OUTPUT_BYTES

    return new Promise((resolve) => {
      let child: ChildProcessWithoutNullStreams
      try {
        child = spawn(this.dockerBin, [...args], {
          env: process.env,
          shell: false,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe']
        })
      } catch (error) {
        resolve({
          exitCode: null,
          stdout: '',
          stderr: '',
          error: error instanceof Error ? error.message : 'Unable to start Docker.'
        })
        return
      }

      let stdout = ''
      let stderr = ''
      let settled = false
      const finish = (result: DockerCommandResult): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        resolve(result)
      }

      const terminateForOutput = (): void => {
        child.kill()
        finish({
          exitCode: null,
          stdout,
          stderr,
          outputLimitExceeded: true
        })
      }

      const timeout = setTimeout(() => {
        child.kill()
        finish({ exitCode: null, stdout, stderr, timedOut: true })
      }, timeoutMs)

      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk
        if (stdout.length > maxOutputBytes && !settled) terminateForOutput()
      })
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk
        if (stderr.length > maxOutputBytes && !settled) terminateForOutput()
      })
      child.on('error', (error) => {
        finish({
          exitCode: null,
          stdout,
          stderr,
          error: error.message
        })
      })
      child.on('close', (exitCode) => {
        finish({ exitCode, stdout, stderr })
      })

      if (input === undefined) child.stdin.end()
      else child.stdin.end(input)
    })
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

function nonEmptyString(value: string, name: string): string {
  const normalized = value.trim()
  if (normalized === '') throw new Error(`${name} must not be empty`)
  return normalized
}

function isRunnerResultWithoutDuration(
  value: unknown
): value is Omit<RunnerResult, 'durationMs'> {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { status?: unknown; evidence?: unknown }
  return (
    (candidate.status === 'completed' ||
      candidate.status === 'rejected' ||
      candidate.status === 'failed') &&
    Array.isArray(candidate.evidence)
  )
}
