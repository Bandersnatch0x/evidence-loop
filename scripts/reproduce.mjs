/**
 * reproduce.mjs — 复赛 item 5：一键复现整条验证链（跨平台）。
 *
 *   node scripts/reproduce.mjs [--skip-install] [--skip-e2e] [--skip-smoke]
 *
 * 步骤（任一失败即停，退出码非零）：
 *   1. 环境检查（node/npm 版本）
 *   2. npm ci —— 全新依赖（--skip-install 跳过，复用 node_modules）
 *   3. npm run lint
 *   4. npm test
 *   5. npm run build
 *   6. node scripts/verify-build-budget.mjs
 *   7. npm run test:e2e（--skip-e2e 跳过；需 Playwright 浏览器）
 *   8. 启动冒烟：dev:no-watch + GET /api/health 断言 runner 字段（--skip-smoke 跳过）
 *
 * 无任何第三方依赖（仅 node 内置模块）。
 */
import { spawnSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = new Set(process.argv.slice(2))
if (args.has('--help') || args.has('-h')) {
  process.stdout.write(`用法：node scripts/reproduce.mjs [选项]

选项：
  --skip-install   跳过 npm ci（复用现有 node_modules）
  --skip-e2e       跳过 Playwright e2e 矩阵
  --skip-smoke     跳过启动冒烟（端口被环境禁止时）
  --help          显示本帮助

示例：npm run reproduce -- --skip-e2e
`)
  process.exit(0)
}
const SKIP_INSTALL = args.has('--skip-install')
const SKIP_E2E = args.has('--skip-e2e')
const SKIP_SMOKE = args.has('--skip-smoke')
const SMOKE_PORT = Number(process.env.SMOKE_PORT ?? 44127)

const results = []
function step(name, run) {
  process.stdout.write(`\n=== ${name} ...\n`)
  const started = Date.now()
  try {
    const detail = run()
    results.push({ name, ok: true, ms: Date.now() - started })
    process.stdout.write(`\u2713 ${name} 通过 (${(Date.now() - started) / 1000}s)\n`)
    return detail
  } catch (error) {
    results.push({ name, ok: false, ms: Date.now() - started })
    process.stdout.write(`\u2717 ${name} 失败：${error instanceof Error ? error.message : String(error)}\n`)
    throw error
  }
}

function runCommand(command, cwd = ROOT) {
  const useShell = process.platform === 'win32'
  const out = spawnSync(command, {
    cwd,
    encoding: 'utf8',
    stdio: 'inherit',
    shell: useShell
  })
  if (out.error) throw out.error
  if (out.status !== 0) throw new Error(`${command} 退出码 ${String(out.status)}`)
}

function assertNodeVersion() {
  const [major] = process.versions.node.split('.').map(Number)
  if (major < 20) throw new Error(`Node ${process.version} 过旧，需要 ≥ 20（推荐 LTS 22+）`)
  return major
}

async function bootSmoke() {
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(SMOKE_PORT) },
    stdio: 'ignore'
  })
  const base = `http://127.0.0.1:${SMOKE_PORT}`
  try {
    let lastError
    for (let i = 0; i < 40; i += 1) {
      if (child.exitCode !== null) {
        throw new Error(`服务器提前退出（exit ${String(child.exitCode)}）——端口可能被占用或环境禁止绑定，试试 PORT=xxxx npm run reproduce`)
      }
      try {
        const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1500) })
        if (response.ok) {
          const body = (await response.json())
          if (typeof body.runner !== 'string' || body.runner === '') {
            throw new Error(`/api/health 缺少 runner 字段：${JSON.stringify(body)}`)
          }
          return `runner=${body.runner}`
        }
        lastError = new Error(`/api/health 返回 ${response.status}`)
      } catch (error) {
        lastError = error
      }
      await new Promise((resolve) => setTimeout(resolve, 750))
    }
    throw lastError ?? new Error('启动超时（30s）')
  } finally {
    child.kill('SIGTERM')
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
}

try {
  const nodeMajor = assertNodeVersion()
  process.stdout.write(`环境：node ${process.version} · npm ${process.env.npm_version ?? '?'} · 目录 ${ROOT}\n`)

  if (!SKIP_INSTALL) {
    step('npm ci（全新依赖）', () => runCommand('npm ci'))
  } else {
    process.stdout.write('（--skip-install：复用现有 node_modules）\n')
  }

  step('eslint 全量', () => runCommand('npm run lint'))
  step('vitest 全量', () => runCommand('npm test'))
  step('生产构建', () => runCommand('npm run build'))
  step('构建预算闸门', () => runCommand('node scripts/verify-build-budget.mjs'))

  if (SKIP_E2E) {
    process.stdout.write('（--skip-e2e：跳过 Playwright 矩阵）\n')
  } else {
    step('Playwright e2e 矩阵', () => runCommand('npm run test:e2e'))
  }

  if (SKIP_SMOKE) {
    process.stdout.write('（--skip-smoke：跳过启动冒烟）\n')
  } else {
    step('启动冒烟（health + runner 核对）', () => bootSmoke())
  }

  const failed = results.filter((item) => !item.ok)
  process.stdout.write('\n===== 复现摘要 =====\n')
  for (const item of results) {
    process.stdout.write(`  [${item.ok ? 'PASS' : 'FAIL'}] ${item.name} (${(item.ms / 1000).toFixed(1)}s)\n`)
  }
  if (failed.length > 0) {
    process.exit(1)
  }
  process.stdout.write(`\n全绿。node ${nodeMajor} 环境下整条验证链通过。\n`)
} catch (error) {
  process.stdout.write(`\n===== 复现失败：${error instanceof Error ? error.message : String(error)} =====\n`)
  process.exit(1)
}
