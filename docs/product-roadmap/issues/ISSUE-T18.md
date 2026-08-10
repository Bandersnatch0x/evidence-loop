# Issue T18 — 硬事实学习计划（本周路径）

**Triage**: ready-for-agent
**Source PRD**: [prds/T18-hard-fact-study-plan.md](../prds/T18-hard-fact-study-plan.md)
**Build order**: 4

## What to build

一条端到端纵向切片：纯函数 `buildStudyPlan()`（硬输入唯一决策源：FSRS due ∩ 依赖链薄弱 KP ∩ assessment MasteryProfile 低于阈值 ∩ `taughtKpIds`，排除 narrative/情绪）→ `GET /api/student/study-plan`（7 日计划）+ `POST .../regenerate` → `GET /api/teacher/students/:id/study-plan`（只读）+ `POST /api/teacher/study-plan/assign`（一键布置）→ 学生首页「本周计划」时间条 + 今日任务进练习入口 + 教师学员抽屉只读计划 → 架构守护（plan builder 不 import tutoring generator 写路径）+ 纯函数快照测试（固定 evidence 夹具）。

LLM 仅可写 `presentationHint`（llm_inference），不影响 tasks；无 LLM 时 tasks 仍完整。

## Acceptance criteria

- [ ] 学生可见 7 日硬事实计划与今日入口
- [ ] 教师可对计划中的题一键布置
- [ ] 无 LLM 时 tasks 不变（hint 可空）
- [ ] 纯函数快照测试通过（确定性）
- [ ] 架构守护通过：plan builder 不 import tutoring 写路径
- [ ] 实现报告 `docs/product-roadmap/reports/T18-implementation-report.md` 完成

## Blocked by

None — can start immediately（依赖 T01/T06/T03/T08 均已 IMPLEMENTED，无 intra-batch 阻塞）
