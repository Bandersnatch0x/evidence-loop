# 部署与一键复现（复赛 item 5）

> 目标：任何一台有 Node 的机器，两条命令从零复现「循证环 · EvidenceRing」的全部验证链。
> 覆盖：环境要求 → 安装 → 一键复现 → 数据布局（SQLite 迁移）→ 常见坑 → 隔离运行器。

## 1. 环境要求

| 项 | 要求 |
|----|------|
| Node.js | ≥ 20（推荐 22 LTS / 24；本项目 CI 在 24.2 验证） |
| npm | ≥ 10（随 Node 安装） |
| 磁盘 | ≥ 2 GB（node_modules + dist） |
| 网络 | 安装依赖时需要；**运行期零外网依赖**（见 §7） |

Windows（PowerShell / Git Bash 均可）与 Linux / macOS 同等支持。

## 2. 安装

```bash
cd <repo>
npm ci          # 锁定版本全新安装（比 npm install 更可复现）
```

> **Node 升级后 better-sqlite3 ABI 报错**：若出现
> `better_sqlite3.node was compiled against a different Node.js version`
> （NODE_MODULE_VERSION 不匹配），执行：
> ```bash
> npm rebuild better-sqlite3
> ```

## 3. 一键复现（推荐）

```bash
npm run reproduce
```

等价于依次执行并**任一失败即停**：eslint → vitest 全量 → 生产构建 → 构建预算闸门 →
Playwright e2e 矩阵 → 启动冒烟（起服务 + `GET /api/health` 核对 runner 字段）。

常用变体：

```bash
npm run reproduce -- --skip-install   # 复用现有 node_modules（日常迭代）
npm run reproduce -- --skip-e2e       # 未装 Playwright 浏览器时跳过 e2e
npm run reproduce -- --skip-smoke     # 环境禁止绑定端口时跳过启动冒烟
PORT=5280 npm run reproduce           # 端口冲突/被排除时显式换端口
```

人工复现也可以分步：

```bash
npm run check        # lint + test + build + budget + e2e（等价全闸门）
npm run dev          # 开发态（HMR）；默认端口 4180
npm run preview      # 生产态（dist 静态资源 + API）
```

## 4. 数据文件布局

| 路径 | 内容 | 说明 |
|------|------|------|
| `.data/product.sqlite` | **主产品库**：attempts（评估历史）、questions（题库）、auth、教学单元、Effort 2 各表 | SQLite WAL 模式，**多实例共享** |
| `.data/evaluations.json` | 遗留评估历史（T01 之前） | 首次启动**一次性导入**进 SQLite，文件保留不动 |
| `.data/audit.sqlite` | 审计日志（HMAC 签名） | 只追加 |
| `.data/memory.sqlite` | 掌握度/复习调度（MemoryLayer） | |
| `data/media/` | 内容寻址媒体（上传） | `data/media/<hash>` |
| `data/knowledge-points.seed.json` | 121+ 知识点 DAG 种子 | 只读 |
| `data/task-templates.seed.json` | 知识点任务模板（复赛 item 3） | 只读 |

**评估历史迁移（复赛 item 2）**：默认启动即用 SQLite 的 `attempts` 表（`SqliteAttemptStore`）。
启动时若表为空且存在 `.data/evaluations.json`，自动导入（幂等、非破坏，日志
`[attempt-store] migrated N legacy evaluation(s) into product database`）。
显式回退到 JSON 存储：传 `dataFile` 选项（测试/演示用，多实例场景勿用）。
`.data/` 已 gitignore，不随提交分发。

## 5. 端口与环境变量

- 默认 `PORT=4180`。Windows 某些环境存在端口排除/防火墙策略，`listen EACCES` 时：
  ```bash
  PORT=5280 npm run dev
  ```
- 全部可配变量见 `.env.example`（LLM、OCR、STT、Docker runner、审计 HMAC 等）。
- **未配 `LLM_API_KEY` 时**：AI 辅导/出题等自动降级为本地模板，评分链路完全不受影响
  （铁律：LLM 永不写分）。

## 6. 隔离运行器

| 模式 | 变量 | 适用 |
|------|------|------|
| subprocess（默认） | `PYTHON_RUNNER=subprocess` | 受控 Demo / 本地开发 |
| Docker 无网络 | `PYTHON_RUNNER=docker` | 不可信提交 |

```bash
docker build -t evidence-ring-python-runner:local docker/python-runner
PYTHON_RUNNER=docker DOCKER_RUNNER_IMAGE=evidence-ring-python-runner:local npm run dev
```

Docker 模式：无网络、内存/CPU/PID 限制、只读根、非 root、丢弃 capabilities、`no-new-privileges`。
daemon/镜像不可用时**明确失败**，不静默回退。`GET /api/health` 的 `runner` 字段核对实际模式。
隔离边界详见 `docs/adr/0002-container-isolation.md`。

## 7. 运行期零外网保证

- 默认栈（subprocess runner + 本地规则反馈 + 无 LLM key）**完全离线**。
- 出境合规（T10）：学生 PII 永不出境；LLM 只走境内已备案 provider，OCR 本地优先，
  全部为配置开关，关掉即零外网。
- 演示模式 `X-Demo-Role` 仅 MockSessionProvider 生效，`--production` 下**拒绝**该头
  （见 `server/auth/authMode.ts`）。

## 8. 常见坑速查

| 现象 | 处理 |
|------|------|
| `NODE_MODULE_VERSION` 不匹配 | `npm rebuild better-sqlite3` |
| `listen EACCES 0.0.0.0:PORT` | 换 `PORT`（Windows 端口排除/防火墙）；或 `--skip-smoke` |
| e2e 找不到浏览器 | `npx playwright install chromium`（或 `--skip-e2e`） |
| 首次启动日志出现 `migrated N legacy evaluation(s)` | 正常，一次性迁移 |
| `product.sqlite-wal/-shm` 文件 | WAL 正常产物，勿删（服务运行中） |
