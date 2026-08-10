/**
 * accept-docker.mjs — 复赛 item 1：真实 Docker daemon 集成验收。
 *
 *   npm run accept:docker
 *
 * 步骤：
 *   1. 探测 docker daemon（docker info）——缺失即失败并给启用提示
 *   2. 硬化镜像缺失时构建：docker build -t evidence-ring-python-runner:local docker/python-runner
 *   3. vitest 只跑 tests/dockerDaemonAcceptance.test.ts（真实池 + 提交 + 隔离 + 清理）
 *
 * 无第三方依赖。WSL 提示：wsl -d kali-linux -- bash -lc 'cd <repo> && npm run accept:docker'
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const IMAGE = process.env.DOCKER_RUNNER_IMAGE ?? 'evidence-ring-python-runner:local'

function run(command) {
  process.stdout.write(`$ ${command}\n`)
  const out = spawnSync(command, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'inherit',
    shell: true
  })
  if (out.error) throw out.error
  if (out.status !== 0) throw new Error(`${command} 退出码 ${String(out.status)}`)
}

function dockerInfo() {
  const out = spawnSync('docker', ['info'], { encoding: 'utf8', timeout: 20_000, stdio: 'ignore' })
  return out.status === 0
}

function imagePresent() {
  const out = spawnSync('docker', ['image', 'inspect', IMAGE], { encoding: 'utf8', timeout: 20_000, stdio: 'ignore' })
  return out.status === 0
}

try {
  if (!dockerInfo()) {
    process.stdout.write(
      'Docker daemon 不可用。启用方式：\n' +
        '  - Windows: 安装 Docker Desktop 并启动\n' +
        '  - WSL:     wsl -d <distro> -- bash -lc "cd <repo> && npm run accept:docker"\n'
    )
    process.exit(1)
  }
  process.stdout.write('Docker daemon 就绪。\n')

  if (!imagePresent()) {
    process.stdout.write(`镜像 ${IMAGE} 缺失，开始构建…\n`)
    run(`docker build -t ${IMAGE} docker/python-runner`)
  } else {
    process.stdout.write(`镜像 ${IMAGE} 已存在。\n`)
  }

  run('npx vitest run tests/dockerDaemonAcceptance.test.ts')
  process.stdout.write('\nDocker 集成验收全绿。\n')
} catch (error) {
  process.stdout.write(`\nDocker 集成验收失败：${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
}
