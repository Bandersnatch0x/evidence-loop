# Handoff: 循证环 · EvidenceRing 产品化 + T14 站内消息 + 复赛 5/5 + 决赛交付件

## Mission

GOAI Boundless Agents · AI+教育 — **循证环 · EvidenceRing（循证实训 Agent）**。
Wayfinder 十票产品化(`.scratch/wayfinder/MAP.md`,状态 IMPLEMENTED)已全部建成；
T11–T13 评审扫尾 + **T14 教师批量发提示（站内消息）** 已落地；
现场演示脚本、成套交卷计时壳、T14 学生多选 UI 已补齐；
**复赛 5 项（Docker 集成 / SQLite 多实例 / 任务模板库 / 演示视频 / 一键复现）全部落地**；
决赛交付件（现场 SOP / 专家问答库 / 弱网演练清单）已收口。

**Authoritative root:** `D:/code_space/evidence-loop`(Node 20,better-sqlite3 ^11)

## Status (2026-08-14)

**十票 + T11–T23 IMPLEMENTED；复赛 5/5 落地并验收；决赛交付件已提交；当前处于 UI 收口与决赛演练准备阶段。`master` 比 `origin/master` 领先 90 个提交，工作区仍有并行 UI WIP，远端同步前必须先分范围提交并跑全量验收。**

| 波次 | 内容 | commit |
|------|------|--------|
| T01–T10 | 产品化主路径 | `docs/product-roadmap/PRODUCT-MAP.md` |
| T11–T13 | T08 评审扫尾 | `2eaf693` / `bad7a69` / `d81f0aa` |
| **T14** | 教师批量发提示（站内消息） | `16a65e9` + report |
| Demo 交付件 | 现场脚本 + 成套计时壳 + 提示多选 | `bf6c112` |
| 测试修复 | `App.test` mock `listStudentTips`（收件箱挂载） | `6a615e3` |
| flake 修复 | vitest `fileParallelism:false` 串行执行，消除并发资源竞争型 flake | `d8cf1c9` |
| 读兼容 | AttemptStore 容忍 pre-T01 bare EvaluationResult + 坏行跳过；ESLint ignore `output/` | `a71b4ac` |
| Demo 讲稿 | 一页卡点 + 10 分钟口播逐字 | `fefc178` |
| E2E | Playwright demo loops → **16/16**（2026-07-25 `:18473`；2026-07-26 `:5280` 复验） | `scripts/e2e-demo-loops.mjs` |
| **复赛 1** | 真实 Docker daemon 集成验收（隔离运行器；`scripts/accept-docker.mjs`） | `44feaa4` |
| **复赛 2** | 评估历史迁移 SQLite 多实例（`SqliteAttemptStore` + migration 0020） | `9a05735` |
| **复赛 3** | 知识点任务模板库（3 模板，`GET /api/teacher/task-templates` + 一键部署） | `0af47f3` |
| **复赛 4** | 2-3 分钟演示视频（补录核心铁律路径 + 混剪包） | `666036c` |
| **复赛 5** | 一键复现脚本 + 部署文档（`scripts/reproduce.mjs` + `docs/DEPLOYMENT.md`） | `d327ab5` |
| 修复 | `StudentDemonstration` 载荷加载失败降级，消除未处理 rejection | `ac1f664` |
| 决赛交付 | 现场 SOP `DEMO-final-preflight.md` + 专家问答库 `DEMO-expert-qa.md` + 弱网演练 `DEMO-weaknetwork-drill.md` | `035e34a` |
| 架构与 UI 加固 | 深模块拆分、hash router、干预闭环、a11y 与 DESIGN.md 收口 | `3e454ca` → `208d638` |

验证快照（交付准备）：
- 最近一次已提交基线 `npm run check` **PASS**：lint + 全量 vitest **481 passed + 1 skipped** + `tsc --noEmit` + Vite build
- 2026-08-14 UI WIP 定向验收：`App` 角色选择器 **2/2**，Pipeline / 掌握度 / 参考资料 / 今日复习 **18/18**；`tsc --noEmit` PASS；触及文件 ESLint PASS
- 2026-08-14 Playwright 桌面（1440×1000）与移动端（390×844）复验：角色菜单、Pipeline 工具名换行、侧栏遮罩与键盘选择均通过
- 当前工作区仍有未提交并行改动，以上定向结果不能替代同步前的全量 `npm run check`
- `tests/productDataModel.test.ts` **9/9**（legacy bare EvaluationResult + 混合坏行读兼容）
- 本地 `.data/evaluations.json` 实读 **22/22** 条保留
- E2E 真机复验（2026-07-26）：`PORT=5280` → `node scripts/e2e-demo-loops.mjs http://127.0.0.1:5280` → **16 passed, 0 failed**
  - 学生：我的练习 → 双模 → 苏格拉底求助 → 提交(score 80) → 场次历史 → 错题本重练
  - 教师：工作台 → tu-demo → 布置(1 占位) → 批改 tab → 题库 tab
  - 报告：`output/playwright/e2e/report.json`（gitignore）
- Windows 注意：Hyper-V 排除了 `4173`/`5173` 段 → 用 `PORT=5280` 或 `18473`

## 复赛已交付(产品化十票之后,勿重做)

- **Docker 隔离运行器**(复赛 1): `DockerPythonRunner` `--network=none` + 资源限制 + cap-drop 全丢；daemon 验收 5 用例（探活/隔离/逃逸拒止/无残留）；默认子进程模式仍可用
- **SQLite 多实例**(复赛 2): `SqliteAttemptStore` + migration 0020 `paper_id/due_at`；serverContext 默认 SQLite，启动一次性导入 `.data/evaluations.json`；`JsonAttemptStore` 可切回
- **知识点任务模板库**(复赛 3): `TaskTemplate` = 预置题 + 知识点绑定；3 模板（数学完全平方 / 物理欧姆定律 / 化学配平）；unit ownership 双门
- **演示视频**(复赛 4): 8 段 ~2.6min `demo-full.mp4` 由本机 `scripts/assemble-hybrid.mjs` 产出；单段重录 `CLIP=xxx`
- **一键复现**(复赛 5): `scripts/reproduce.mjs` lint→test→build→budget→e2e→启动冒烟，跨平台可跳步；`docs/DEPLOYMENT.md` 零外网

## 产品化十票之前的地基(勿重做)

- **多模态 Phase 1**(ADR-0005): VoiceCompanion / DOM 高亮 / STT / feature flag 红线
- **多学科题型引擎**(ADR-0008): 7 题型 Runner + 9 学科 121 KP DAG
- **记忆与自适应硬事实层**: FSRS + 依赖链 + MasteryProfile
- **合规**(ADR-0002/0003): 容器隔离、HMAC 审计链、PII、被遗忘权 API

## Product invariants(铁律,勿破坏)

- 分数只来自可复现证据;LLM 永不改分(ADR-0001)
- **D1 双模**:练习态只喂 FSRS,不进正式 MasteryProfile
- 辅导 generator 物理隔离打分路径
- 教师终裁写 `result.teacherAnnotation`(+`signature`),永不折叠进 `result.score`;无批量给分
- **T14 提示是消息不是分**：永不写 score / evidence / MasteryProfile
- Cohort 正式中位分排除待终裁主观题(`pendingAdjudication`)
- T10 egress:学生 PII 永不出境

## Demo 演示路径

**身份常量**:学员 `learner-demo` / 教师 `teacher-demo` / 单元 `tu-demo` / 预置题 `seed:<assignmentId>`。
角色:侧栏「演示角色切换」+ `x-demo-role`(dev-only MockSession)。

- **学生**:我的练习 → **老师提示**收件箱 → 今日该练/双模 → 练习态求助 → 提交 → **成套计时交卷壳** → 错题本 → 重练
- **教师**:教师工作台 → 使用演示单元 tu-demo → 布置 → **发提示（多选/全班）** → 主观题批改(可导出 CSV)→ 终裁
- **学情**:班级学情中位分尊重终裁门;待终裁计数
- **多模态**:`MULTIMODAL_ENABLED=true` + `docs/DEMO-multimodal-*.md`
- **现场脚本**:[`docs/DEMO-live-script.md`](docs/DEMO-live-script.md)（含专家问答备稿）

## Known tails(有意后置,非阻塞 Demo)

| 项 | 说明 |
|----|------|
| 成绩 Excel/PDF 教务导出 | fog;CSV 已有 |
| S4 list 性能 / S5 demo id 耦合 | Demo 可接受 |
| 激励体系 / 家长报告 / 课标对齐 | MAP Not yet specified |
| 短信/推送/家长端提示 | T14 出界 |
| 成套交卷与 Attempt 批量提交 API | 当前为 UI 仪式壳；计分仍在单题 Attempt |

> 已解决：全量 vitest 并发 flake → `d8cf1c9`（`fileParallelism:false` 串行执行）。代价：全量 ~25s → ~90s。

## Next

复赛 5/5 已落地，代码与 E2E 闭环齐。剩余全是**交付准备**（非功能缺口），按以下顺序推进：

1. **UI WIP 收口**：完成分范围提交，确认没有把并行改动混入同一提交；跑全量 `npm run check`
2. **远端同步**：当前 `master` 比 `origin/master` 领先 90 个提交；全量验收通过后推送并复核远端 HEAD
3. **现场演练**：按 `docs/DEMO-final-preflight.md` + `docs/DEMO-weaknetwork-drill.md` 走一遍，记录实际耗时、故障分支和口播偏差
4. **专家问答脱口**：`docs/DEMO-expert-qa.md` 5 维度 37 问 + 铁律快答卡（评分边界 / 安全 / 开源复用）
5. **演讲打磨**：口播稿 / 卡点 / 10min 逐字稿按决赛 SOP 对齐（开场句 / 收束三句 / 多 Agent 插播 30s）
6. **决赛加码（YAGNI，除非评分明确要求）**：Excel/PDF 教务导出、成套 Attempt 批量提交 API、家长端

不要在没拿到评分细则前开建 #6。

## Key docs

| 文档 | 用途 |
|------|------|
| `CONTEXT.md` | 域语言 + Active decisions |
| `docs/DEMO-live-script.md` | 现场演示脚本 + 专家问答 |
| `docs/DEMO-cue-card.md` | 一页现场卡点（时间盒 / 脱口 Q&A / 故障） |
| `docs/DEMO-oral-10min.md` | 10 分钟口播逐字稿 |
| `docs/DEMO-final-preflight.md` | **决赛现场固化 SOP**（T-30 → T-0 + 故障决策树 D1-D8） |
| `docs/DEMO-expert-qa.md` | **专家问答库**（5 维度 37 问 + 铁律快答卡） |
| `docs/DEMO-weaknetwork-drill.md` | **弱网演练清单**（无公网 / STT 降级 / 语音兜底） |
| `docs/DEMO-preflight.md` | 原始上场预检（final-preflight 的底稿） |
| `docs/SUBMISSION_GUIDE.md` | 报名填表（决赛口径；含是否改名结论） |
| `docs/PROJECT_BRIEF.md` | 作品简介附件正文 |
| `output/submission/EvidenceRing-submission.zip` | 作品附件（gitignore；改名后需重打） |
| 品牌 | 循证环 · EvidenceRing（package `evidence-ring`；本地目录可仍为 evidence-loop） |
| `docs/product-roadmap/decisions/` | T01–T14 裁决 |
| `docs/product-roadmap/reports/` | 实现报告 |
| `docs/adr/0001-0008` | 铁律与架构 |
| `docs/ROADMAP.md` | 决赛时间线 |

## Commands

```powershell
cd D:/code_space/evidence-loop
# 若 4173 EACCES，换端口：
$env:PORT='5280'; npm run dev
# 或：
node output/restart-dev-server.cjs

npx vitest run tests/teacherTips.test.ts tests/productDataModel.test.ts
node node_modules/typescript/lib/tsc.js --noEmit
node scripts/e2e-demo-loops.mjs http://127.0.0.1:5280
```

## Do not re-do

- wayfinder 十票裁决(CLOSED)
- 核心 Agent 环、7 题型 Runner、9 学科 DAG、多模态 Phase 1
- T11–T14（已落地）
- 现场演示脚本 / 成套计时壳 / TipComposer 多选（本轮已落地）
- 复赛 5 项（Docker 集成 / SQLite 多实例 / 模板库 / 演示视频 / 一键复现，已落地并验收）
