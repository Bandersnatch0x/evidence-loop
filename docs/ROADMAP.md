# 迭代路线

## 已完成（初赛可用）

- AI+教育方向立项与 Agent 闭环 Demo
- 学习工作台 / 班级学情 / 项目透明度
- 证据优先评分与本地规则反馈
- 自动化测试、生产构建与浏览器演示路径
- 参赛材料：简介、PRD、架构、合规、路演提纲

## 复赛（8/25-9/23）

1. 无网络 Docker 容器运行器：代码、池化、异常回收和自动化测试已于 2026-07-23 完成；真实 Docker daemon 集成验收 ✅（复赛 2026-08-10 落地：`tests/dockerDaemonAcceptance.test.ts` 5 用例覆盖 daemon 探活/镜像就绪 → 池预热真实提交 → 出站 TCP 隔离 → 逃逸提交被拒止 → dispose 无残留；`scripts/accept-docker.mjs` + `npm run accept:docker` 一键探 daemon/补镜像/跑验收，无 daemon 整组 skip 并给启用提示；WSL kali-linux + 硬化镜像 `evidence-ring-python-runner:local` 实测全绿）
2. 评估历史迁移到数据库，支持多实例 ✅（复赛 2026-08-10 落地：`SqliteAttemptStore` 接 `attempts` 表 + migration 0020 paper_id/due_at；serverContext 默认切 SQLite，启动一次性导入 `.data/evaluations.json`，JsonAttemptStore 经 `dataFile`/`attemptStore` 保留可切）
3. 增加 2-3 个知识点任务模板（关联 011 知识点 seed 文件：`server/knowledge/` seed 数据）✅（复赛 2026-08-10 落地：`TaskTemplate` 模板库 = 预置题 + 知识点绑定；3 模板覆盖 数学·完全平方（expression）/ 物理·欧姆定律（numeric）/ 化学·配平（chem_equation）；`GET /api/teacher/task-templates` 目录 + `POST /:id/deploy` 一键布置，复用 AssignmentService handpick，unit ownership 双门）
4. 录制 2-3 分钟 Demo 视频 ✅（复赛 2026-08-10 落地：补录 3 段核心铁律路径 `live-evidence`/`live-tutoring`/`live-teacher`（分数只来自证据 / 辅导不改分 / 终裁不折叠+提示不是分），与 3 段多模态 live + 3 段 opener 拼成 `demo-full.mp4`（8 段 ~2.6 分钟）；`scripts/record-demo-videos.mjs` 支持单段重录 `CLIP=xxx`，`scripts/assemble-hybrid.mjs` 一键产出 demo-full + 3 条短 hybrid；视频二进制由本机执行产出，见 `docs/screenshots/demo-videos/README.md`）
5. 补齐部署脚本与一键复现文档 ✅（复赛 2026-08-10 落地：`scripts/reproduce.mjs` 一键全链（lint→test→build→budget→e2e→启动冒烟，跨平台/可跳步）+ `docs/DEPLOYMENT.md`（数据布局/SQLite 迁移/端口与 ABI 坑/隔离运行器/零外网）；顺手修掉 `StudentDemonstration` 播放器载荷加载失败的未处理 rejection（reproduce 首跑抓出））

### Phase 1 多模态交付（ADR-0005）

- [x] 协议冻结 + feature flag 红线（`MULTIMODAL_ENABLED`）
- [x] VoiceCompanion + OverlayLayer 骨架与 directive 分发
- [x] 阿里云 STT 抽象 + KaTeX 数学 SPEAK/DISPLAY 双通道
- [x] 多模态合规：审计 `modality`、语音元数据审计、IndexedDB 24h TTL、教师语音使用次数面板（021）
- [x] 演示脚本：代码 / 数学 / 作文 + 弱网降级演练（022）
  - [docs/DEMO-multimodal-code.md](./DEMO-multimodal-code.md)
  - [docs/DEMO-multimodal-math.md](./DEMO-multimodal-math.md)
  - [docs/DEMO-multimodal-essay.md](./DEMO-multimodal-essay.md)
  - [docs/DEMO-multimodal-fallback.md](./DEMO-multimodal-fallback.md)
- [x] 架构守护 + Feature Flag 冒烟（023）：`tests/architecture.test.ts` + `tests/multimodal-flag-smoke.test.ts`
- [x] 演示视频混剪包（开场概念 + 实机 Playwright 录屏）：[`docs/screenshots/demo-videos/`](./screenshots/demo-videos/)
- [ ] Phase 2：canvas 手写 + 视觉 LLM（前置 ADR-0007 笔迹隐私分类）

### 多学科题型引擎 + 九门学科（ADR-0008 / 工单 025–031）

- [x] 题型抽象：`QuestionType` + `RunnerSpec` union + `EvidenceKind` 扩展
- [x] `RunnerRegistry` 注册 7 种题型（choice / fill_blank / numeric / expression / chem_equation / code / essay）
- [x] 客观题验证器：ObjectiveValidator / ExpressionValidator / ChemEquationValidator
- [x] 作文客观维度 + AdvisoryLayer（教师终裁、不入分）
- [x] 九门学科知识点 DAG（`data/knowledge-points.seed.json`，121 kp）
- [x] 九门学科示例题库（`server/data/assignments.ts`：每门 ≥1 道可评分 demo）
- [x] 端到端集成测试：`tests/multiSubjectIntegration.test.ts` + `tests/multiDisciplineScoring.test.ts`
- [x] 合规与 CONTEXT 收尾：`docs/COMPLIANCE.md`「多学科评分能力」+ CONTEXT Active decision「已实施（7 题型 + 9 学科）」

## 决赛（9/22-9/23）

1. 现场演示脚本已固化（缺陷 80 → 修复 100）；待按决赛 SOP 做计时演练
2. 专家问答库已整理：评分边界、安全、开源复用；待脱稿抽问
3. 开放模板展示路径已具备：任务配置、量规、知识诊断；待现场串联验证
4. 多模态与弱网降级文档已具备；待按 `DEMO-weaknetwork-drill.md` 实机演练

### 交付准备状态（2026-08-14）

- [x] 决赛现场 SOP、专家问答库、弱网演练清单提交（`035e34a`）
- [x] UI WIP 第一轮审查与定向回归（20 tests + TypeScript + 触及文件 ESLint）
- [ ] 分范围提交当前并行 UI WIP，并跑全量 `npm run check`
- [ ] 将本地领先的 90 个提交同步到 `origin/master`，复核远端 HEAD
- [ ] 完成一轮决赛计时演练，记录实际耗时与降级分支

## 后续产品化

- LMS/作业平台对接
- 教师人工确认后的成绩回写
- 多语言运行器
- 机构级隐私与审计能力
