# Issue T21 — 人物对话探究（练习态，不入分）

**Triage**: ready-for-agent
**Source PRD**: [prds/T21-persona-dialogue-inquiry.md](../prds/T21-persona-dialogue-inquiry.md)
**Build order**: 6（体验加深项，非阻塞主路径）

## What to build

一条端到端纵向切片：新增 `personas` + `dialogue_sessions` 表（预置 3–5 个 demo 人物，非真人师生仿冒，挂载史料/教材摘录）→ `GET /api/personas` → `POST /api/practice/dialogue`（开会话，仅 practice 态）→ `POST .../turn`（多轮，轮次上限 8–12，防套话对齐 T05 苏格拉底）→ `POST .../close`（结束 → 引导做论述题）→ 知识点/题目页「探究对话」入口 + 对话 UI + 顶栏常驻「练习探究 · 不计入测评」标识 → 架构守护（dialogue 路由不 import AttemptStore 写 score；产出只进 `LearnerNarrative` llm_inference）→ 无 LLM 时模板角色回复降级。

关闭对话后不产生 Attempt（除非用户另开测评题）。

## Acceptance criteria

- [ ] Demo 人物可多轮对话并结束
- [ ] 全程无 score 写入；UI 标明练习不计入测评
- [ ] 架构测试通过：dialogue 不写 MasteryProfile / 不 import AttemptStore
- [ ] 无 LLM 时模板降级可演示
- [ ] 实现报告 `docs/product-roadmap/reports/T21-implementation-report.md` 完成

## Blocked by

None — can start immediately（依赖 T05/T01 均已 IMPLEMENTED，无 intra-batch 阻塞）
