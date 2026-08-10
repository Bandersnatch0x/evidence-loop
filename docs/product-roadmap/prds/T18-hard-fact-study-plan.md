# PRD: T18 硬事实学习计划（本周路径）

**状态**: OPEN
**开建顺序**: 4
**来源**: 个性化学习计划需求；落实 CONTEXT「学习路径主干-调味分层」

---

## Problem Statement

「个性化学习计划」常由 LLM 直接排课，易幻觉——LLM 可能推荐未教章节或凭"感觉"改变任务顺序。循证环需要一种**只由硬输入**（MasteryProfile assessment、FSRS due、依赖链薄弱、`taughtKpIds`）确定性生成的学习计划，LLM 仅可写 `presentationHint` 文案（调味），教师可一键将计划采纳为布置。

## Solution

提供滚动 7 日学习计划：每日 1–N 个 task slot（kp + 建议题量 + 建议 mode 默认 practice），只由硬输入确定性生成。`candidateTasks` 只由 FSRS due ∩ 依赖链薄弱 ∩ assessment MasteryProfile 低阈值 ∩ `taughtKpIds` 决定。LLM 仅可写 `presentationHint`（UI 文案节奏），不影响 tasks 内容。教师可一键将计划中的题布置为 assignment。

## User Stories

1. 作为学生，我想在首页看到本周 7 日学习计划时间条，以便知道每天该练什么。
2. 作为学生，我想从计划中的今日任务直接进入练习，以便减少选择摩擦。
3. 作为学生，我想看到每个任务的推荐理由（FSRS 复习 / 薄弱点 / 掌握度低），以便理解为什么练这个。
4. 作为学生，我想在无 LLM 时计划内容不受影响（hint 可空），以便核心功能不依赖 AI。
5. 作为教师，我想在学员抽屉中只读查看学生的 7 日计划，以便了解学习路径。
6. 作为教师，我想一键将计划中的某日任务布置为 assignment，以便快速干预。
7. 作为教师，我想可选地按全班聚合薄弱生成班级计划，以便统一布置（非必须 MVP）。
8. 作为系统，未教 KP 不进 plan，以便守住 D4。
9. 作为系统，关闭 LLM 时 plan.tasks 仍完整（hint 可空），以便核心不依赖 AI。
10. 作为开发者，我想在 CI 中验证 plan builder 不 import tutoring generator 写路径，以便守护隔离。
11. 作为开发者，我想用固定 evidence 夹具做纯函数快照测试，以便验证计划确定性。
12. 作为学生，我想每次打开计划时看到最新重算结果（每日 0 点逻辑重算），以便计划不过期。
13. 作为教师，我想计划中的任务建议 mode 默认为 practice，以便学生先练后测。

## Implementation Decisions

### 要定什么

1. **计划粒度**：MVP 为滚动 7 日计划（日历日或学习日，配置默认自然日）。每日 1–N 个 task slot（kp + 建议题量 + 建议 mode 默认 practice）。

2. **硬输入（唯一决策源）**：FSRS due 卡片 + 依赖链薄弱 KP + assessment MasteryProfile 低于阈值的 KP + ∩ `taughtKpIds`。排除：仅 narrative/情绪/聊天推断。

3. **输出契约**：

```typescript
StudyPlan {
  id, studentId, teachingUnitId, termId,
  horizonDays: 7,
  days: [{ date, tasks: [{ kpId, questionIds?, targetCount, reason: 'fsrs'|'weak'|'mastery' }] }],
  algorithm: 'plan.hard.v1',
  generatedAt
}
// presentationHint 可选外挂，llm_inference，不影响 tasks
```

4. **教师采纳**：「按该生计划布置」→ 展开为 assignment（practice 为主）。「按全班聚合薄弱生成班级计划」→ 可选，复用 T06 聚合，非必须 MVP。

5. **重算**：每次打开或每日 0 点逻辑重算；不持久化「过期任务强制完成」。持久化最近一次 plan 快照便于 UI，但 `algorithm` 可重放。

### API / 数据草案

| 方法 | 路径 | 角色 | 说明 |
|------|------|------|------|
| GET | `/api/student/study-plan` | student | 当前 7 日计划 |
| POST | `/api/student/study-plan/regenerate` | student | 强制重算 |
| GET | `/api/teacher/students/:id/study-plan` | teacher | 只读（本单元 enrollment） |
| POST | `/api/teacher/study-plan/assign` | teacher | body: studentId + day 或 whole plan → 布置 |

### 模块变更

- 新增 `server/studyPlan/` 模块（StudyPlanService + 纯函数 plan builder + routes），或扩展 `server/adaptive/`。
- 复用 T06 的 FSRS due + 依赖链薄弱 + MasteryProfile 读取。
- 前端学生首页增加「本周计划」时间条 + 今日任务进练习入口。
- 前端教师学员抽屉增加只读计划 + 一键布置今日。

## Testing Decisions

### 测试缝隙

- **主缝隙**：扩展 `tests/adaptiveLoop.test.ts` — plan builder 纯函数单测（固定 evidence 夹具 → 快照 tasks）。
- **架构守护缝隙**：`tests/architecture.test.ts`（扩展）— 验证 `server/studyPlan/` 不 import tutoring generator 写路径。
- **次缝隙**：HTTP API 集成测试（GET plan / POST regenerate / POST assign）。

### 测试内容

1. 未教 KP 不进 plan（D4 守护）。
2. 关闭 LLM 时 plan.tasks 仍完整（hint 可空）—— LLM 不可用降级测试。
3. 架构：plan builder 不 import tutoring generator 写路径。
4. 纯函数单测：固定 evidence 夹具 → 快照 tasks（确定性验证）。
5. 教师布置：plan 中的 task 可展开为 assignment。
6. 重算幂等：同一输入多次重算结果一致。

### 好测试的标准

只测外部行为（plan tasks 内容 + 确定性 + 隔离边界），不测 LLM hint 文案。参考现有 `tests/adaptiveLoop.test.ts` 的纯函数夹具模式。

## Out of Scope

- LLM 自由改任务顺序 / 加未教章节
- 高考倒计时课程包
- 家长端计划（报告见 T19）
- 游戏化连胜（→ T20）

## Further Notes

### 验收（Done 定义）

1. 学生可见 7 日硬事实计划与今日入口。
2. 教师可对计划中的题一键布置。
3. 无 LLM 时 tasks 不变（hint 空）。
4. 纯函数快照测试通过。
5. 实现报告 `docs/product-roadmap/reports/T18-implementation-report.md`。

### 关联旧票

- [[T06-adaptive-loop]]：FSRS due + 依赖链薄弱 + cohort 聚合
- [[T01-product-data-model]]：Attempt 聚合根、termId/teachingUnitId
- [[T08-teacher-workflow]]：布置 assignment
- [[T05-ai-tutoring]]：presentationHint 走 llm_inference
- CONTEXT：candidateTasks 硬输入；presentationHint 软输入
