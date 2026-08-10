# [wayfinder:ticket] T18 硬事实学习计划（本周路径）

## Question

黑客松「个性化学习计划」常由 LLM 直接排课，易幻觉。本票规定：`candidateTasks` **只由硬输入**（MasteryProfile assessment、FSRS due、依赖链薄弱、`taughtKpIds`）确定性生成；LLM 仅可写 `presentationHint` 文案。教师可一键将计划采纳为布置（接 T06/T08）。

**来源**：国外教育黑客松调研 Wave B-④；落实 CONTEXT「学习路径主干-调味分层」。

**Blocked by**: T01、T06（today 队列）、T03（选题）、T08（布置）

---

## 要定什么

1. **计划粒度**  
   - MVP：滚动 **7 日**计划（日历日或学习日，配置默认自然日）。  
   - 每日：1–N 个 task slot（kp + 建议题量 + 建议 mode 默认 practice）。

2. **硬输入（唯一决策源）**  
   - FSRS due 卡片  
   - 依赖链薄弱 KP  
   - assessment MasteryProfile 低于阈值的 KP  
   - ∩ `taughtKpIds`  
   - 排除：仅 narrative/情绪/聊天推断

3. **输出契约**

```
StudyPlan {
  id, studentId, teachingUnitId, termId,
  horizonDays: 7,
  days: [{ date, tasks: [{ kpId, questionIds?, targetCount, reason: 'fsrs'|'weak'|'mastery' }] }],
  algorithm: 'plan.hard.v1',
  generatedAt
}
// presentationHint 可选外挂，llm_inference，不影响 tasks
```

4. **教师采纳**  
   - 「按该生计划布置」→ 展开为 assignment（practice 为主）。  
   - 「按全班聚合薄弱生成班级计划」→ 可选，复用 T06 聚合，非必须 MVP。

5. **重算**  
   - 每次打开或每日 0 点逻辑重算；不持久化「过期任务强制完成」。  
   - 持久化最近一次 plan 快照便于 UI，但 `algorithm` 可重放。

---

## 建议 MVP 形状

### API

| 方法 | 路径 | 角色 | 说明 |
|------|------|------|------|
| GET | `/api/student/study-plan` | student | 当前 7 日计划 |
| POST | `/api/student/study-plan/regenerate` | student | 强制重算 |
| GET | `/api/teacher/students/:id/study-plan` | teacher | 只读（本单元 enrollment） |
| POST | `/api/teacher/study-plan/assign` | teacher | body: studentId + day 或 whole plan → 布置 |

### UI

- 学生首页：「本周计划」时间条 + 今日任务进练习。  
- 教师学员抽屉：只读计划 + 一键布置今日。

### 测试

- 未教 KP 不进 plan。  
- 关闭 LLM 时 plan.tasks 仍完整（hint 可空）。  
- 架构：plan builder 不 import tutoring generator 写路径。  
- 纯函数单测：固定 evidence 夹具 → 快照 tasks。

---

## 出界（本票不做）

- LLM 自由改任务顺序/加未教章节  
- 高考倒计时课程包  
- 家长端计划（报告见 T19）  
- 游戏化连胜（→ T20）  

---

## 验收（Done 定义）

1. 学生可见 7 日硬事实计划与今日入口。  
2. 教师可对计划中的题一键布置。  
3. 无 LLM 时 tasks 不变。  
4. 实现报告 `docs/product-roadmap/reports/T18-implementation-report.md`。

---

## 状态

**OPEN** — 待实现。

## 关联

[[T06-adaptive-loop]] [[T01-product-data-model]] [[T08-teacher-workflow]] [[T05-ai-tutoring]]  
CONTEXT：candidateTasks 硬输入；presentationHint 软输入。
