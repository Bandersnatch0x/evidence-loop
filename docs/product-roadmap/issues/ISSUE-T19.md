# Issue T19 — 学情周报 / 家长可读导出

**Triage**: ready-for-agent
**Source PRD**: [prds/T19-learning-weekly-report.md](../prds/T19-learning-weekly-report.md)
**Build order**: 5

## What to build

一条端到端纵向切片：新增 `WeeklyReportService` 按固定章节顺序聚合一周数据（完成与时长 / 测评得分趋势 / 薄弱知识点 / 错题 Top3–5 / 练习活动量 / 下周建议来自 T18 / 教师提示摘录来自 T14），每章标注 evidence 层或 AI 文案层 → `GET /api/teacher/reports/weekly`（query: teachingUnitId, studentId?, from, to）→ JSON + `GET /api/teacher/reports/weekly.html` 打印友好页（浏览器另存 PDF）+ `GET /api/student/reports/weekly`（仅本人）→ 教师学情页学生行「周报」入口（预览/打印）+ 学生侧栏「我的周报」→ 隐私：默认学名号/化名，手机邮箱不进报告，summary 过 `PIIDetector`，导出记审计日志。

practice 分不标为正式掌握；无 assessment 时趋势为空态文案而非 500。

## Acceptance criteria

- [ ] 教师导出 demo 班一生徒周报 HTML 可打印
- [ ] 章节含证据层标识；AI 文案有灰标（llm_inference）
- [ ] 权限测试通过：学生不能拉他人报告；教师仅本单元 enrollment
- [ ] PII 测试通过：summary 过 PIIDetector
- [ ] 无 assessment 时空态文案不 500
- [ ] 实现报告 `docs/product-roadmap/reports/T19-implementation-report.md` 完成

## Blocked by

- [ISSUE-T18](../issues/ISSUE-T18.md)（周报「下周建议」章节消费 T18 plan 摘要）
