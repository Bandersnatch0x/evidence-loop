# Issue T16 — 跨学科模拟考（Paper 智能组卷）

**Triage**: ready-for-agent
**Source PRD**: [prds/T16-interdisciplinary-mock-exam.md](../prds/T16-interdisciplinary-mock-exam.md)
**Build order**: 3

## What to build

一条端到端纵向切片：新增 `mock_exam_plans` 表 → `POST /api/teacher/mock-exams/suggest`（按 cohort 薄弱 KP ∩ `taughtKpIds` 确定性组卷，支持同行政班下多 TeachingUnit 抽题，单科退化同一 API）→ `POST /api/teacher/mock-exams`（保存草稿/发布布置）→ 学生测评态打包作答（`mode: assessment`，AI 关闭，每题独立 Attempt 共享 `paperId`）→ `GET /api/student/papers/:paperId/report` 交卷后统一报告（分 subject 分节 + KP 诊断 + 失败证据 TopN + 共性薄弱列表）→ 教师「生成模拟考」向导 UI + 学生测评入口（卷名/时长/学科标签）。

未教 KP、draft 题、无答案题不得入卷；跨单元仅限本师 TeachingUnit。

## Acceptance criteria

- [ ] 教师对 demo 班生成建议卷并布置成功
- [ ] 学生 assessment 交卷后看到分科 + KP 报告
- [ ] 卷内无 draft / 未教 KP
- [ ] 集成测试覆盖组卷过滤（未教 KP、draft 题）与跨单元权限
- [ ] 实现报告 `docs/product-roadmap/reports/T16-implementation-report.md` 完成

## Blocked by

- [ISSUE-T15](../issues/ISSUE-T15.md)（T16 选用的 `published` 题由 T15 确认入库产出；建议 T15 先建以演示完整「材料→题→考」闭环）
