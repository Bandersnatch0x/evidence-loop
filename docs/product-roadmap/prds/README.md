# PRD 索引：T15–T23 产品化增强

**状态**: 全部 OPEN
**铁律（全票）**: LLM 不写 score / evidence / 正式 MasteryProfile；草稿题未教师确认不得用于 assessment；无排行榜 / 无情绪摄像头评分 / 无无闸门自动出题

---

## 建议开建顺序

| 序 | 票 | PRD 文件 | 内容 | 分组 | 依赖 |
|----|----|---------|------|------|------|
| 1 | T17 | [T17](T17-multi-agent-product-narrative.md) | 五 Agent 目录 + 透明度页 + 口播；不引入新框架 | A | 无硬依赖 |
| 2 | T15 | [T15](T15-material-to-draft-questions.md) | 讲义/文本 → LLM 草稿 → 教师校对入库 | A | T03/T04/T09/T10 |
| 3 | T16 | [T16](T16-interdisciplinary-mock-exam.md) | 薄弱+已教 KP 组 paper，测评打包+分科报告 | A | T03/T06/T07/T08 |
| 4 | T18 | [T18](T18-hard-fact-study-plan.md) | 7 日 plan 只由 FSRS/薄弱/掌握度生成；LLM 只写 hint | B | T01/T06/T03/T08 |
| 5 | T19 | [T19](T19-learning-weekly-report.md) | 教师/学生周报 HTML；证据层 vs AI 层标注 | B | T01/T06/T07/T08/T14/T18 |
| 5 | T20 | [T20](T20-evidence-light-motivation.md) | 闭环/证据成就；无排行榜 | B | T01/T07/T18(optional) |
| 6 | T21 | [T21](T21-persona-dialogue-inquiry.md) | 练习态角色对话，不入分 | C | T05/T01 |
| 7 | T22 | [T22](T22-media-to-flashcard-drafts.md) | 字幕/音频 → 复用 T15 闸门 | C | T15/T04/T10 |
| 8 | T23 | [T23](T23-evidence-portfolio-export.md) | Attempt 证据包 JSON/zip | C | T01/CodeRunner/T08 |

> 序 5 的 T19 和 T20 可并行开建。T20 的 `plan_day_done` 成就依赖 T18，标记 optional——T18 未上时该成就不激活。

---

## 测试缝隙总览

所有票复用两个已有缝隙，不引入新的测试基础设施：

1. **架构守护测试** `tests/architecture.test.ts` — file-read + regex 模式强制隔离边界
2. **HTTP API 集成测试** — 直接打端点、断言响应体

| 票 | 主测试文件 | 架构守护扩展 |
|----|-----------|-------------|
| T17 | `tests/agentCatalog.test.ts` (新) | catalog 契约：touchesScore→!llmAllowed |
| T15 | `tests/materialImport.test.ts` (新) | materialImport 不写 score/evidence/Attempt |
| T16 | `tests/mockExam.test.ts` (新) | 未教 KP / draft 题不进卷 |
| T18 | `tests/adaptiveLoop.test.ts` (扩展) | plan builder 不 import tutoring 写路径 |
| T19 | `tests/weeklyReport.test.ts` (新) | practice 分不标正式掌握 |
| T20 | `tests/achievements.test.ts` (新) | achievements 不写 score |
| T21 | `tests/personaDialogue.test.ts` (新) | dialogue 不 import AttemptStore |
| T22 | `tests/materialImport.test.ts` (扩展) | egress 关闭时拒绝非本地 STT |
| T23 | `tests/portfolioExport.test.ts` (新) | 导出不写 MasteryProfile |

---

## 模块落点总览

| 票 | 新增/扩展模块 | 对齐模式 |
|----|-------------|---------|
| T17 | `shared/agentCatalog.ts` | 静态目录 + 类型 |
| T15 | `server/materialImport/` | questionbank 模式 |
| T16 | `server/mockExam/` 或扩展 `server/adaptive/` | adaptive + teacher 模式 |
| T18 | `server/studyPlan/` 或扩展 `server/adaptive/` | adaptive 模式 |
| T19 | `server/reports/` | 聚合现有数据源 |
| T20 | `server/achievements/` | 条件判定纯函数 |
| T21 | `server/dialogue/` 或扩展 `server/tutoring/` | tutoring 模式 |
| T22 | 扩展 `server/materialImport/` (T15) | 复用 T15 闸门 |
| T23 | `server/portfolio/` | 聚合 Attempt + Evidence |
