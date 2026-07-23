# EvidenceLoop · 循证实训 Agent

杭州全球人工智能技术创新大赛 / 世界人工智能开源大赛  
赛道：**Boundless Agents 无界应用 · AI+教育**

EvidenceLoop 面向编程实训场景，完成一个可演示、可验证的 Agent 闭环：

> 提交代码 → 受限运行测试与静态检查 → 按量规生成证据与分数 → 映射薄弱知识点 → 生成下一轮修复任务 → 重新提交验证 → 更新学情

## 为什么不是聊天机器人

- 分数由测试与静态证据确定性计算。
- 模型只组织受证据约束的反馈，不改分、不捏造事实。
- 教师视图仅给出干预建议，不自动写正式成绩。
- 学习工作台可一键演示“缺陷提交 → 80 分 → 修复 → 100 分”。

## 快速启动

```powershell
cd evidence-loop
npm install
npm run dev
```

打开 `http://localhost:4173`

可选环境变量见 `.env.example`。未配置 `LLM_API_KEY` 时使用本地规则反馈。

### WSLC 隔离环境

仓库提供项目专用入口，挂载范围仅包含当前项目、Claude/Codex 状态目录和 Maven 缓存。Linux 依赖保存在 `evidence-loop-node-modules` 命名卷中，不覆盖 Windows 的 `node_modules`。

```powershell
.\scripts\wslc-dev.ps1 -Action install
.\scripts\wslc-dev.ps1 -Action check
.\scripts\wslc-dev.ps1 -Action dev
.\scripts\wslc-dev.ps1 -Action shell
```

需要模型 API 时，通过项目外的环境文件注入，例如 `-EnvFile E:\WSL\agent-home\local.env`。不要把密钥写入镜像或仓库。

### Docker 隔离运行器

默认 `PYTHON_RUNNER=subprocess`，便于没有 Docker 的本地开发和测试；该模式只适合受控 Demo。需要执行不可信提交时，显式启用 Docker 模式：

```powershell
docker build -t evidence-loop-python-runner:local docker/python-runner
$env:PYTHON_RUNNER = 'docker'
$env:DOCKER_RUNNER_IMAGE = 'evidence-loop-python-runner:local'
npm run dev
```

Docker 模式会预热容器池，并为池容器设置无网络、内存/CPU/PID 限制、只读根文件系统、受限 `/tmp`、非 root 用户、丢弃 capabilities 和 `no-new-privileges`。Docker CLI、daemon 或镜像不可用时，服务启动会明确失败，不会静默回退到子进程。

启动后可通过 `GET /api/health` 核对实际运行器；响应中的 `runner` 字段应为 `docker`。完整参数见 `.env.example`，隔离决策和剩余边界见 `docs/adr/0002-container-isolation.md`。

## 演示脚本（约 3 分钟）

1. 打开“学习工作台”，默认代码存在空列表边界缺陷。
2. 点击“运行循证评估”，观察得分约 80、证据 7/8、诊断“空序列边界未处理”。
3. 点击“应用修复示例”，再次评估，观察 100 分与 +20 分提升。
4. 切换“班级学情”，查看完成率、中位分与关注队列。
5. 切换“项目透明度”，说明评分边界、模型角色与安全限制。

## 常用命令

```powershell
npm run check   # lint + test + build
npm run test
npm run build
npm run preview # 生产静态资源 + API
```

## 技术边界

- 运行器：默认本地 Python 子进程，**仅适合受控 Demo**；显式 `PYTHON_RUNNER=docker` 可启用无外部网络和资源受限的容器池。
- 存储：本地 JSON 串行写入，不适合多进程生产。
- 数据：匿名样例，不连接真实学籍系统。
- Docker 模式仍不等同于微虚拟机；公开生产部署还需身份认证、审计、镜像治理、daemon 隔离和数据库迁移。

## 参赛材料

- `docs/PROJECT_BRIEF.md` 作品简介
- `docs/PRD.md` 产品需求
- `docs/ARCHITECTURE.md` 技术架构
- `docs/COMPLIANCE.md` 安全与合规
- `docs/PITCH_DECK_OUTLINE.md` 初赛 PPT 提纲
- `docs/ROADMAP.md` 迭代计划
- `docs/research/competition-requirements.md` 赛道要求摘录
- `docs/adr/0001-evidence-first-scoring.md` 证据优先评分决策

## 许可证

Apache-2.0，见 `LICENSE`。
