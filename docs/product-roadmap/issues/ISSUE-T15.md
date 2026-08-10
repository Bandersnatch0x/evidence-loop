# Issue T15 — 材料 → 草稿题（教师校对闸门）

**Triage**: ready-for-agent
**Source PRD**: [prds/T15-material-to-draft-questions.md](../prds/T15-material-to-draft-questions.md)
**Build order**: 2

## What to build

一条端到端纵向切片：新增 product SQLite 表 `material_import_jobs` + `draft_questions` → `POST /api/teacher/material-import`（纯文本粘贴/.txt → LLM 生成 choice/fill_blank/numeric 候选草稿，标 `provenance: llm_inference`，状态 `draft`）→ `GET` 草稿列表 → `PATCH` 修正 → `POST .../confirm`（校验答案权威 `authored_key` + teacherId → 写入题库 `published`）/ `discard` → 教师题库页「从材料生成草稿」入口 + 并排校对列表 UI → 复用 T04 闸门模式 → 架构守护（生成路径不写 score/evidence/Attempt）+ 无 `LLM_API_KEY` 时模板假草稿（固定 2 题）降级。

未确认草稿题不可被 assessment 场次引用（422 或查询不可见）。

## Acceptance criteria

- [ ] 教师粘贴样例讲义 → 得 ≥2 道 draft
- [ ] 修正并 confirm 1 道 → 题库可见且可布置测评（带 `authored_key` + teacherId）
- [ ] 未 confirm 题不可出现在测评选题器
- [ ] 铁律测试：全流程零 score 写入
- [ ] 无 `LLM_API_KEY` 时模板降级路径走通校对
- [ ] 实现报告 `docs/product-roadmap/reports/T15-implementation-report.md` 完成

## Blocked by

None — can start immediately（依赖 T03/T04/T09/T10 均已 IMPLEMENTED，无 intra-batch 阻塞）
