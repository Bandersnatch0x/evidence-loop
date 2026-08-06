import {
  DockerPythonRunner,
  type DockerPythonRunnerOptions
} from './DockerPythonRunner'
import { PythonSubprocessRunner } from './PythonSubprocessRunner'
import type { CodeRunner } from './types'

/** Build the configured single-language Python runner. */
export function createConfiguredRunner(
  environment: NodeJS.ProcessEnv = process.env
): CodeRunner {
  const mode = (environment.PYTHON_RUNNER ?? 'subprocess').trim().toLowerCase()

  if (mode === 'subprocess') {
    return new PythonSubprocessRunner({
      pythonBin: environment.PYTHON_BIN,
      timeoutMs: optionalPositiveInteger(environment.PYTHON_RUNNER_TIMEOUT_MS)
    })
  }

  if (mode === 'docker') {
    const options: DockerPythonRunnerOptions = {
      dockerBin: environment.DOCKER_BIN,
      image: environment.DOCKER_RUNNER_IMAGE,
      poolSize: optionalPositiveInteger(environment.DOCKER_RUNNER_POOL_SIZE),
      timeoutMs: optionalPositiveInteger(environment.DOCKER_RUNNER_TIMEOUT_MS),
      startupTimeoutMs: optionalPositiveInteger(
        environment.DOCKER_RUNNER_STARTUP_TIMEOUT_MS
      ),
      memory: environment.DOCKER_RUNNER_MEMORY,
      memorySwap: environment.DOCKER_RUNNER_MEMORY_SWAP,
      cpus: environment.DOCKER_RUNNER_CPUS,
      tmpfs: environment.DOCKER_RUNNER_TMPFS,
      user: environment.DOCKER_RUNNER_USER,
      pidsLimit: optionalPositiveInteger(environment.DOCKER_RUNNER_PIDS_LIMIT)
    }
    return new DockerPythonRunner(options)
  }

  throw new Error(
    `Unsupported PYTHON_RUNNER value "${mode}". Use "subprocess" or "docker".`
  )
}

function optionalPositiveInteger(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received "${value}".`)
  }
  return parsed
}
