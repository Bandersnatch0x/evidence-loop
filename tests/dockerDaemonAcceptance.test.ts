// @vitest-environment node
//
// 真实 Docker daemon 集成验收（复赛 item 1）。
// 无可用 daemon 时整组 skip（消息提示如何启用）；有 daemon 但缺硬化镜像时
// 首个用例明确失败并给出构建命令。
//
// 覆盖：池预热 → 真实提交执行 → 无外网隔离（verifyNetworkIsolation + 逃逸
// 尝试被拒）→ dispose 后容器回到基线（不留池容器）。
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { createAssignmentRegistry } from '../server/data/assignments'
import { DockerPythonRunner } from '../server/runner/DockerPythonRunner'
import type { RunnerRequest } from '../server/runner/types'

const IMAGE =
  process.env.DOCKER_RUNNER_IMAGE ?? 'evidence-ring-python-runner:local'
const assignment = createAssignmentRegistry().get('python-average')
if (!assignment) throw new Error('Demo assignment is missing')

function dockerInfo(): { ok: boolean; detail: string } {
  try {
    const out = spawnSync('docker', ['info'], {
      encoding: 'utf8',
      timeout: 20_000,
      stdio: 'ignore'
    })
    return { ok: out.status === 0, detail: `docker info exit=${String(out.status)}` }
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : 'docker not found' }
  }
}

function imagePresent(): boolean {
  try {
    const out = spawnSync('docker', ['image', 'inspect', IMAGE], {
      encoding: 'utf8',
      timeout: 20_000,
      stdio: 'ignore'
    })
    return out.status === 0
  } catch {
    return false
  }
}

function psIds(): string[] {
  try {
    const out = spawnSync('docker', ['ps', '-aq'], {
      encoding: 'utf8',
      timeout: 20_000
    })
    return (out.stdout ?? '')
      .trim()
      .split(/\s+/u)
      .filter((id) => id !== '')
      .sort()
  } catch {
    return []
  }
}

function request(code: string): RunnerRequest {
  if (!assignment) throw new Error('Demo assignment is missing')
  return { assignment, code }
}

const CORRECT_CODE = `def calculate_average(scores):
    return 0 if not scores else sum(scores) / len(scores)`

const NETWORK_ESCAPE_CODE = `def calculate_average(scores):
    import socket
    socket.create_connection(('1.1.1.1', 80), 2)
    return 0 if not scores else sum(scores) / len(scores)`

const daemon = dockerInfo()

// 冷容器首次 exec（python 启动）在共享 daemon 上可能超 1.5s 默认值，
// 验收固定放宽，避免把基础设施延迟误判为隔离失败。
const RUNNER_TIMEOUTS = { timeoutMs: 8_000, startupTimeoutMs: 15_000 }

describe.skipIf(!daemon.ok)('真实 Docker daemon 集成验收（复赛 item 1）', () => {
  it('daemon 可用且硬化镜像已构建', () => {
    expect(
      imagePresent(),
      `镜像 ${IMAGE} 缺失。先构建：docker build -t ${IMAGE} docker/python-runner（或用 DOCKER_RUNNER_IMAGE 指向已有镜像）`
    ).toBe(true)
  })

  it('预热池并真实执行正确提交 → completed + 非空证据', async () => {
    const baseline = psIds()
    const runner = new DockerPythonRunner({
      image: IMAGE,
      poolSize: 2,
      ...RUNNER_TIMEOUTS
    })
    await runner.warm()
    expect(runner.getPoolStats().size).toBe(2)

    const result = await runner.run(request(CORRECT_CODE))
    expect(result.status).toBe('completed')
    expect(result.evidence.length).toBeGreaterThan(0)

    await runner.dispose()
    expect(psIds()).toEqual(baseline)
  })

  it('池容器拒绝出站 TCP（verifyNetworkIsolation=true）', async () => {
    const runner = new DockerPythonRunner({
      image: IMAGE,
      poolSize: 1,
      ...RUNNER_TIMEOUTS
    })
    await runner.warm()
    expect(await runner.verifyNetworkIsolation()).toBe(true)
    await runner.dispose()
  })

  it('提交内尝试外连被隔离拒止（rejected，无通过证据）', async () => {
    const runner = new DockerPythonRunner({
      image: IMAGE,
      poolSize: 1,
      ...RUNNER_TIMEOUTS
    })
    await runner.warm()
    const result = await runner.run(request(NETWORK_ESCAPE_CODE))
    // 网络不可达 → 提交内抛异常 → harness 上报 rejected（无通过证据），
    // 绝不返回 completed。
    expect(result.status).not.toBe('completed')
    expect(result.evidence.length).toBe(0)
    await runner.dispose()
  })

  it('dispose 后无残留池容器', async () => {
    const baseline = psIds()
    const runner = new DockerPythonRunner({
      image: IMAGE,
      poolSize: 2,
      ...RUNNER_TIMEOUTS
    })
    await runner.warm()
    await runner.dispose()
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(psIds()).toEqual(baseline)
  })
})
