# Issue T20 — 证据驱动的轻激励（克制版）

**Triage**: ready-for-agent
**Source PRD**: [prds/T20-evidence-light-motivation.md](../prds/T20-evidence-light-motivation.md)
**Build order**: 5（与 T19 并行）

## What to build

一条端到端纵向切片：新增 `student_achievements` 表 + 固定目录 5 种成就（首枚证据通过 / 修复闭环分差≥20 / 薄弱点清除 / 三日研习 / 今日计划完成，条件只由硬事实判定，可重放）→ `GET /api/student/achievements`（已获得 + 目录进度）→ 评估成功路径写 Attempt 后钩子检查成就（保持简单可同步）→ 学生工作台侧栏「证据成就」列表（克制图标 + 一句话条件）+ 非阻塞 toast（`prefers-reduced-motion` 无动画）→ 教师可选看班级成就计数（聚合，不展示排行榜）→ 架构守护（achievements 模块不写 score）。

成就零影响 score / MasteryProfile 算法；不用 LLM 评判「学习态度」发奖。

## Acceptance criteria

- [ ] Demo 路径「80→100」可点亮 `repair_plus_20`
- [ ] 学生成就列表可见；无排行榜入口
- [ ] 铁律/架构测试：achievements 模块不写 score
- [ ] 条件边界测试通过：分差 19 不授、20 授
- [ ] 实现报告 `docs/product-roadmap/reports/T20-implementation-report.md` 完成

## Blocked by

- [ISSUE-T18](../issues/ISSUE-T18.md)（`plan_day_done` 成就依赖 T18 当日 tasks；T18 未上时该成就标记 optional 不激活，其余 4 种不受影响）
