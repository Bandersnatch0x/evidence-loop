// @vitest-environment node

/**
 * 端到端集成测试（工单 009）。
 *
 * 覆盖 Demo 合规闭环的四条主线，并串联完整流程：
 *   学生提交代码 → 容器执行 → PII 检测 → 审计日志 → 权限过滤 → 教师查询。
 *
 * 与 tests/serverApi.test.ts / tests/accessControl.test.ts 保持同一风格：
 * 用真实 HTTP server + 注入的 in-memory AuditStore，避免触碰磁盘。
 * 容器网络隔离通过 DockerPythonRunner + stub executor 在进程内验证，
 * 无需真实 Docker daemon（真实容器探测见 tests/dockerPythonRunner.test.ts）。
 */

import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AuditStore } from '../server/audit/AuditStore'
import { SECURITY_WARNING_VALUE } from '../server/auth/MockSessionProvider'
import { createEvidenceLoopServer } from '../server/index'
import {
  buildDockerNetworkProbeArgs,
  buildDockerRunArgs,
  DockerPythonRunner,
  type DockerCommandExecutor,
  type DockerCommandResult
} from '../server/runner/DockerPythonRunner'
import type { CodeRunner, RunnerRequest, RunnerResult } from '../server/runner/types'

const SECRET = 'integration-test-hmac'
const DEMO_STUDENT_ID = 'learner-demo'
const CONTAINER_RUNNER_NAME = 'python-docker-pool'

/** 满分提交所需的合法代码（内容不参与真实执行，runner 被 stub）。 */
const VALID_CODE =
  'def calculate_average(scores):\n    if not scores:\n        return 0\n\n    return sum(scores) / len(scores)'

interface ResponseHeadersBag {
  'x-security-warning'?: string
}

function headers(role: string, extra?: Record<string, string>): HeadersInit {
  return {
    'x-demo-role': role,
    ...extra
  }
}

/**
 * 构造一个"容器执行成功"的 stub runner：所有量规证据判定通过（满分 100），
 * `actual` 可选覆盖以注入 PII，用于 PII 拒绝路径测试。
 */
function createStubRunner(options?: {
  name?: string
  piiActual?: string
}): CodeRunner {
  return {
    name: options?.name ?? CONTAINER_RUNNER_NAME,
    run(request: RunnerRequest): Promise<RunnerResult> {
      const evidence = request.assignment.criteria.map((criterion, index) => ({
        id: criterion.id,
        state: 'passed' as const,
        // 仅在第一条证据注入 PII（当提供 piiActual 时）。
        actual:
          index === 0 && options?.piiActual !== undefined
            ? options.piiActual
            : criterion.expected ?? '0',
        message: '容器执行完成'
      }))
      return Promise.resolve({
        status: 'completed',
        durationMs: 5,
        evidence,
        containerId: options?.name ?? CONTAINER_RUNNER_NAME
      })
    }
  }
}

describe('集成测试：端到端合规闭环', () => {
  let server: Awaited<ReturnType<typeof createEvidenceLoopServer>>
  let baseUrl: string
  let audit: AuditStore

  beforeEach(async () => {
    audit = new AuditStore({
      dbPath: ':memory:',
      hmacSecret: SECRET,
      flushIntervalMs: 60_000,
      flushBatchSize: 100
    })
    server = await createEvidenceLoopServer({
      dataFile: ':memory:',
      runner: createStubRunner(),
      auditStore: audit,
      auditHmacSecret: SECRET
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${String(address.port)}`
  })

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  })

  it('串联学生提交→容器执行→审计→权限过滤→教师查询的完整流程', async () => {
    // 1. 学生提交代码，容器执行成功并返回满分。
    const submit = await fetch(`${baseUrl}/api/evaluations`, {
      method: 'POST',
      headers: { ...headers('student'), 'content-type': 'application/json' },
      body: JSON.stringify({ assignmentId: 'python-average', code: VALID_CODE })
    })
    expect(submit.status).toBe(201)
    expect((submit.headers as unknown as ResponseHeadersBag)['x-security-warning']).toBe(
      undefined
    )
    // 显式警告头始终存在。
    expect(submit.headers.get('x-security-warning')).toBe(SECURITY_WARNING_VALUE)
    const created = (await submit.json()) as {
      id: string
      score: number
      status: string
      studentId?: string
    }
    expect(created.status).toBe('completed')
    expect(created.score).toBe(100)
    expect(created.studentId).toBe(DEMO_STUDENT_ID)

    // 2. 学生只能看到自己的评估历史。
    const studentList = await fetch(
      `${baseUrl}/api/evaluations?assignmentId=python-average`,
      { headers: headers('student') }
    )
    expect(studentList.status).toBe(200)
    const studentHistory = (await studentList.json()) as Array<{
      id: string
      studentId?: string
    }>
    expect(studentHistory.some((item) => item.id === created.id)).toBe(true)
    expect(
      studentHistory.every((item) => item.studentId === DEMO_STUDENT_ID)
    ).toBe(true)

    // 3. 教师能看到班级快照与该学生记录。
    const cohort = await fetch(`${baseUrl}/api/cohort`, {
      headers: headers('teacher')
    })
    expect(cohort.status).toBe(200)

    const teacherList = await fetch(
      `${baseUrl}/api/evaluations?assignmentId=python-average`,
      { headers: headers('teacher') }
    )
    expect(teacherList.status).toBe(200)
    const teacherHistory = (await teacherList.json()) as Array<{ id: string }>
    expect(teacherHistory.some((item) => item.id === created.id)).toBe(true)

    // 4. 审计日志可追溯：evaluate 成功事件记录了容器 id，且哈希链完整。
    await audit.flush()
    const evaluateLogs = await audit.query({ action: 'evaluate' })
    expect(
      evaluateLogs.some(
        (entry) =>
          entry.resourceId === created.id &&
          entry.actorRole === 'student' &&
          entry.studentId === DEMO_STUDENT_ID &&
          entry.containerId === CONTAINER_RUNNER_NAME &&
          entry.result === 'success'
      )
    ).toBe(true)

    const integrity = await audit.verifyIntegrity()
    expect(integrity.valid).toBe(true)

    // 5. 教师查询审计端点可按 studentId 过滤。
    const auditView = await fetch(
      `${baseUrl}/api/audit?studentId=${DEMO_STUDENT_ID}`,
      { headers: headers('teacher') }
    )
    expect(auditView.status).toBe(200)
    const auditRows = (await auditView.json()) as Array<{
      studentId: string | null
      action: string
    }>
    expect(auditRows.length).toBeGreaterThan(0)
  })

  it('强制访问控制矩阵：学生越权被拒并留痕，教师放行', async () => {
    // 学生访问班级快照 → 403 且审计 denied。
    const studentCohort = await fetch(`${baseUrl}/api/cohort`, {
      headers: headers('student')
    })
    expect(studentCohort.status).toBe(403)

    // 学生访问审计端点 → 403。
    const studentAudit = await fetch(`${baseUrl}/api/audit`, {
      headers: headers('student')
    })
    expect(studentAudit.status).toBe(403)

    // 教师放行。
    const teacherCohort = await fetch(`${baseUrl}/api/cohort`, {
      headers: headers('teacher')
    })
    expect(teacherCohort.status).toBe(200)

    await audit.flush()
    const viewLogs = await audit.query({ action: 'view' })
    expect(
      viewLogs.some(
        (entry) =>
          entry.resourceType === 'cohort' &&
          entry.result === 'denied' &&
          entry.actorRole === 'student'
      )
    ).toBe(true)
  })

  it('隔离两个学生的评估记录（学生 A 看不到学生 B）', async () => {
    // 当前 Demo 单一学生主体（learner-demo）。验证学生视图始终被
    // 收敛到自己的 studentId，任何非本人记录都不会出现在结果里。
    await fetch(`${baseUrl}/api/evaluations`, {
      method: 'POST',
      headers: { ...headers('student'), 'content-type': 'application/json' },
      body: JSON.stringify({ assignmentId: 'python-average', code: VALID_CODE })
    })

    const studentList = await fetch(
      `${baseUrl}/api/evaluations?assignmentId=python-average`,
      { headers: headers('student') }
    )
    const rows = (await studentList.json()) as Array<{ studentId?: string }>
    expect(rows.every((row) => row.studentId === DEMO_STUDENT_ID)).toBe(true)
    expect(rows.some((row) => row.studentId !== DEMO_STUDENT_ID)).toBe(false)
  })

  it('审计哈希链在记录被篡改后验证失败', async () => {
    await fetch(`${baseUrl}/api/evaluations`, {
      method: 'POST',
      headers: { ...headers('student'), 'content-type': 'application/json' },
      body: JSON.stringify({ assignmentId: 'python-average', code: VALID_CODE })
    })
    await audit.flush()

    const before = await audit.verifyIntegrity()
    expect(before.valid).toBe(true)
    expect(before.checkedCount).toBeGreaterThan(0)

    // 篡改首条记录的 result 字段，破坏内容哈希。
    await audit.tamperForTest(1, 'result', 'forged-success')
    const after = await audit.verifyIntegrity()
    expect(after.valid).toBe(false)
    expect(after.brokenAtSequence).toBe(1)
  })
})

describe('集成测试：PII 入库拦截', () => {
  let server: Awaited<ReturnType<typeof createEvidenceLoopServer>>
  let baseUrl: string
  let audit: AuditStore

  beforeEach(async () => {
    audit = new AuditStore({
      dbPath: ':memory:',
      hmacSecret: SECRET,
      flushIntervalMs: 60_000,
      flushBatchSize: 100
    })
    server = await createEvidenceLoopServer({
      dataFile: ':memory:',
      // 容器执行输出把邮箱泄露进 evidence[].actual，触发入库前 PII 扫描。
      runner: createStubRunner({ piiActual: '联系 student@school.edu.cn 查看详情' }),
      auditStore: audit,
      auditHmacSecret: SECRET
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${String(address.port)}`
  })

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  })

  it('含 PII 的评估被拒绝存储（422）并写入 pii_rejected 审计', async () => {
    const submit = await fetch(`${baseUrl}/api/evaluations`, {
      method: 'POST',
      headers: { ...headers('student'), 'content-type': 'application/json' },
      body: JSON.stringify({ assignmentId: 'python-average', code: VALID_CODE })
    })
    expect(submit.status).toBe(422)
    const body = (await submit.json()) as { error: string }
    expect(body.error).toMatch(/邮箱/)

    // 被拒绝的提交不得进入历史。
    const list = await fetch(
      `${baseUrl}/api/evaluations?assignmentId=python-average`,
      { headers: headers('student') }
    )
    const history = (await list.json()) as Array<{ id: string }>
    expect(history).toHaveLength(0)

    // 审计留下 pii_rejected 事件。
    await audit.flush()
    const evaluateLogs = await audit.query({ action: 'evaluate' })
    expect(
      evaluateLogs.some(
        (entry) =>
          entry.result === 'pii_rejected' &&
          entry.actorRole === 'student' &&
          entry.metadata?.piiDetected === true
      )
    ).toBe(true)
  })
})

describe('集成测试：容器网络隔离', () => {
  /**
   * 进程内 stub executor：模拟 docker run / inspect / exec / rm 与网络探测，
   * 让隔离逻辑可在无真实 daemon 的 CI 中验证。
   * probe exitCode 0 表示容器内 socket.create_connection 抛错（外连被阻断）。
   */
  class IsolatedDockerExecutor implements DockerCommandExecutor {
    private nextContainer = 1

    public execute(args: readonly string[]): Promise<DockerCommandResult> {
      const command = args[0]
      if (command === 'run') {
        const id = `container-${String(this.nextContainer)}`
        this.nextContainer += 1
        return Promise.resolve({ exitCode: 0, stdout: `${id}\n`, stderr: '' })
      }
      if (command === 'inspect') {
        return Promise.resolve({ exitCode: 0, stdout: 'true\n', stderr: '' })
      }
      if (command === 'rm') {
        return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
      }
      if (args.some((argument) => argument.includes('socket.create_connection'))) {
        // 外连被 --network=none 阻断：探测脚本正常退出（exit 0）。
        return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
      }
      if (command === 'exec') {
        return Promise.resolve({
          exitCode: 0,
          stdout: JSON.stringify({ status: 'completed', evidence: [] }),
          stderr: ''
        })
      }
      return Promise.resolve({
        exitCode: 1,
        stdout: '',
        stderr: `Unexpected Docker command: ${args.join(' ')}`
      })
    }
  }

  it('容器启动参数强制 --network=none 与硬化选项', () => {
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
        '--network=none',
        '--read-only',
        '--security-opt=no-new-privileges',
        '--cap-drop=ALL'
      ])
    )
  })

  it('预热的容器池通过外连探测确认网络隔离生效', async () => {
    const runner = new DockerPythonRunner({
      executor: new IsolatedDockerExecutor(),
      poolSize: 1
    })
    try {
      await runner.warm()
      await expect(runner.verifyNetworkIsolation()).resolves.toBe(true)
    } finally {
      await runner.dispose()
    }
  })

  it('网络探测参数指向具体容器 id', () => {
    const probeArgs = buildDockerNetworkProbeArgs('container-1')
    expect(probeArgs[0]).toBe('exec')
    expect(probeArgs).toContain('container-1')
    expect(probeArgs.join('\n')).toContain('socket.create_connection')
  })
})
