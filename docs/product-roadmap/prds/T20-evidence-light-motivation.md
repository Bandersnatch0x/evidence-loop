# PRD: T20 证据驱动的轻激励（克制版）

**状态**: OPEN
**开建顺序**: 5（可与 T19 并行；依赖 T18 的成就可标记 optional）
**来源**: 激励体系需求；PRODUCT 反模式：不低幼、不花哨

---

## Problem Statement

PRODUCT-MAP fog「激励体系」与游戏化设计（打卡/徽章/排行榜）之间存在张力：学生需要正反馈来维持刷题动力，但循证环的品牌定位是「严谨实验报告」，PRODUCT.md 明确反低幼、反花哨。需要一种**只奖励可复现证据与闭环完成**的克制版激励，不做排行榜/社交 PK，语气保持实验报告式精确。

## Solution

提供固定目录的成就系统：5 种成就（首枚证据通过 / 修复闭环 / 薄弱点清除 / 三日研习 / 今日计划完成），每种成就条件**只由硬事实**（Attempt、evidence、MistakeBook 移出规则）可复现地判定。成就零影响 score / MasteryProfile 算法。达成时非阻塞 toast，`prefers-reduced-motion` 无动画。教师可选看班级成就计数（聚合），不展示排行榜。

## User Stories

1. 作为学生，我想在首次 assessment 全证据通过时获得「首枚证据通过」成就，以便获得正反馈。
2. 作为学生，我想在同题连续两次 assessment 分差 ≥20 时获得「修复闭环」成就，以便奖励"修了再交"的闭环行为。
3. 作为学生，我想在某 KP 错题本按规则移出活跃时获得「薄弱点清除」成就，以便看到进步。
4. 作为学生，我想在连续 3 个日历日有练习或测评时获得「三日研习」成就，以便鼓励坚持。
5. 作为学生，我想在 T18 当日 tasks 全完成时获得「今日计划完成」成就（若 T18 已上），以便衔接学习计划。
6. 作为学生，我想在学生工作台侧栏看到「证据成就」列表，以便了解可获得哪些成就。
7. 作为学生，我想达成成就时看到非阻塞 toast 提示，以便不打断学习流。
8. 作为学生，我在 `prefers-reduced-motion` 下不看到任何动画，以便无障碍需求。
9. 作为教师，我想可选看班级成就计数（聚合），以便了解整体激励情况。
10. 作为教师，我不想在系统中看到排行榜或学生间对比，以便守住反社交 PK 边界。
11. 作为系统，成就写入零影响 score / MasteryProfile 算法，以便守护铁律。
12. 作为系统，条件边界精确：分差 19 不授 `repair_plus_20`，以便成就可信。
13. 作为开发者，我想验证成就重算幂等，以便从 Attempt 重算结果一致。
14. 作为系统，不用 LLM 评判「学习态度」发奖，以便成就只由硬事实决定。

## Implementation Decisions

### 要定什么

1. **可授予的成就（MVP 固定目录）**：

| id | 条件（硬） | 展示名 |
|----|------------|--------|
| `first_evidence_pass` | 首次 assessment 全证据通过 | 首枚证据通过 |
| `repair_plus_20` | 同题连续两次 assessment，分差 ≥20 | 修复闭环 |
| `weak_kp_cleared` | 某 KP 错题本按 T07 规则移出活跃 | 薄弱点清除 |
| `streak_study_3` | 连续 3 个日历日有 practice 或 assessment | 三日研习 |
| `plan_day_done` | T18 当日 tasks 全完成（若 T18 未上则不做） | 今日计划完成 |

2. **禁止**：全班排名、公开羞辱性对比、付费加速、随机抽奖徽章、用 LLM 评判「学习态度」发奖。

3. **存储**：`StudentAchievement { studentId, achievementId, earnedAt, evidenceRef? }`。可重放：条件可从 Attempt 重算；展示用缓存。

4. **UI**：学生工作台侧栏「证据成就」列表（克制图标 + 一句话条件）。达成时非阻塞 toast；`prefers-reduced-motion` 无动画。教师可选看班级成就计数（聚合），不展示排行榜。

5. **与分数关系**：成就**零影响** score / MasteryProfile 算法。

### API / 数据草案

| 方法 | 路径 | 角色 | 说明 |
|------|------|------|------|
| GET | `/api/student/achievements` | student | 已获得 + 目录进度 |
| POST | `/api/internal/achievements/recompute` | system/test | 重算（或评估后钩子） |

评估成功路径 hook：写 Attempt 后异步/同步检查成就（保持简单可同步）。

### 模块变更

- 新增 `server/achievements/` 模块（AchievementService + 条件判定 + routes）。
- 复用 T01 Attempt、T07 MistakeBook 移出规则、T18 plan 完成判定。
- 前端学生工作台侧栏增加「证据成就」列表组件。
- 前端 toast 组件（非阻塞，`prefers-reduced-motion` 无动画）。
- `tests/architecture.test.ts` 增加守护：achievements 模块不写 score。

## Testing Decisions

### 测试缝隙

- **主缝隙**：新 `tests/achievements.test.ts` — 条件判定单测 + HTTP API 集成测试。
- **架构守护缝隙**：`tests/architecture.test.ts`（扩展）— 验证 `server/achievements/` 不 import mastery/review/runner/scoring 路径。

### 测试内容

1. 成就写入不改 score（架构守护）。
2. 条件边界：分差 19 不授 `repair_plus_20`；分差 20 授予。
3. `first_evidence_pass` 只在 assessment 模式触发（practice 不算）。
4. `streak_study_3` 跨日判定（3 个连续日历日）。
5. 重算幂等：同一 Attempt 历史多次重算结果一致。
6. `prefers-reduced-motion` 时无动画类名（前端组件级测试）。
7. 教师聚合视图不含学生间排名。

### 好测试的标准

只测外部行为（条件判定边界 + 成就列表 API + 隔离边界），不测 toast UI 动画实现。参考现有 `tests/adaptiveLoop.test.ts` 的条件判定测试模式。

## Out of Scope

- 积分商城、虚拟货币
- 好友 PK、公会
- 复杂徽章编辑器
- 音效包

## Further Notes

### 验收（Done 定义）

1. Demo 路径「80→100」可点亮 `repair_plus_20`。
2. 学生成就列表可见；无排行榜入口。
3. 铁律/架构测试：成就模块不写 score。
4. 条件边界测试通过（分差 19 不授 / 20 授）。
5. 实现报告 `docs/product-roadmap/reports/T20-implementation-report.md`。

### 关联旧票

- [[T07-student-experience]]：错题本移出规则、Attempt
- [[T18-hard-fact-study-plan]]：`plan_day_done` 条件（optional 依赖 T18）
- PRODUCT.md Brand / Anti-references：不低幼、不花哨
- PRODUCT-MAP fog：激励体系
