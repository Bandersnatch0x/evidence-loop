# T20 证据驱动的轻激励（成就徽章）— 实现报告

## 范围

固定目录 5 种成就徽章，全部由**确定性规则**基于硬事实快照判定，每枚必须携带
可追溯到 Attempt / Evidence 原子 / ReviewCard / 掌握度快照的证据链。

**不做**：积分、排行榜、连胜压力、虚拟货币、逐学生明细对比、LLM 判定授予。

## 完成

| 层 | 文件 | 内容 |
|----|------|------|
| **契约** | `shared/achievements.ts` | 5 条固定目录（含 `requiresStudyPlan` 标记）、`AchievementEvidenceRef`（复用 T18 `StudyPlanEvidenceRef` + 4 种 Attempt 级锚点）、`AchievementHardFacts` 扁平快照、可执行不变量 `findUnbackedAchievements` / `isCongratulationHint` / `describeEvidenceRef`；类型层面**没有** points/rank/level/streakPressure/currency 字段 |
| **纯函数内核** | `server/achievements/evaluateAchievements.ts` | `HardFacts → AchievementEvaluation`。五条规则：first_evidence_pass / repair_plus_20 / weak_kp_cleared / streak_study_3 / plan_day_done；`earnedAt` 取自触发它的 Attempt 时间（重算幂等） |
| **编排** | `server/achievements/AchievementService.ts` | 只读端口收集硬事实 → 纯函数判定 →（可选）`sync` 落自有表（幂等：已存在不覆盖）；`attachCongratulation` 只外挂文案不改授予 |
| **持久化** | `server/achievements/AchievementStore.ts` + 迁移 `0016_student_achievements.sql` | 自有 `student_achievements` 表（student_id + achievement_id 联合主键，`ON CONFLICT DO NOTHING`）；`UnbackedAchievementError` 拒绝落无证据徽章 |
| **HTTP** | `server/achievements/achievementRoutes.ts` | GET 学生成就墙 / POST sync / GET 教师聚合计数（只有分子分母，无逐学生明细） |
| **UI** | `src/components/achievements/`（AchievementWall / AchievementEvidencePanel / AchievementToast / TeacherAchievementPanel） | 学生「凭什么」抽屉 + 新徽章 toast + 教师班级聚合计数；无任何排行榜组件 |
| **测试** | `tests/achievements.test.ts` | 23 项：无证据不授予、占位不参与、五条规则边界、确定性、sync 幂等、plan 缺失降级、建议层闸门、HTTP 形状与 403 |

## 关键设计决策

1. **克制写在类型里**：`StudentAchievement` 没有 points/rank 字段、`AchievementClassSummary` 没有逐学生明细——想画排行榜也没有数据可画。
2. **占位 Attempt 永不参与**：`assigned_not_started` / `practice_not_submitted`（T07 占位）在 `collectHardFacts` 时标记 `placeholder: true`，内核统一过滤——教师布置作业不会凭空点亮徽章。
3. **零证据不算通过**：`evidenceIds` 为空的提交表示「Runner 没跑出证据」，不算通过、不算研习、不算完成任务。
4. **earnedAt 取自硬事实时间**：`Attempt.createdAt`，不是判定时刻——任何时候重算，结果逐字节相同。
5. **计划缺失是 unavailable 不是 locked**：「做不到判定」与「判定为未达成」分开；T18 未接线只影响 `plan_day_done` 一枚，其余 4 种照常。
6. **建议层双保险**：`attachCongratulation` 在展示期外挂文案（`evidenceRefs` 引用透传）；内核在授予期就拒绝无锚点徽章。

## 待接线（本票不改共享 glue 文件，需人工粘贴）

**1. `server/serverTypes.ts`** — `ApiContext` 增加：

```ts
import type { AchievementService } from './achievements'
// ApiContext 内：
  achievements: AchievementService
```

**2. `server/serverContext.ts`** — 在 `tips` / `evidenceProjector` 之后构造（`studyPlan` 为 T18 服务，可选注入；缺省时 `plan_day_done` 报 unavailable）：

```ts
import { AchievementService, AchievementStore } from './achievements'
// studyPlan 构造之后：
const achievements = new AchievementService({
  attempts: store,
  questions: questionStore,
  mistakes,
  studyPlan,           // 可选：T18
  awards: new AchievementStore({ database: productDb }), // 可选：缺省纯投影
  org
})
// context 对象加：
  achievements,
```

**3. `server/index.ts`** — import + 委托路由段：

```ts
import { handleAchievementApi } from './achievements'
```

```ts
  if (await handleAchievementApi(request, response, requestUrl, context)) {
    return
  }
```

**4. `tests/architecture.test.ts`** — 追加守护：`server/achievements` 目录不得 import runner/mastery/review/evaluation 写路径（模式写法与 T18/T16/T19 守护一致）。

**5. 前端** — 学生工作台挂 `<AchievementWall syncOnLoad />`（交卷回来自动 sync），教师工作台挂 `<TeacherAchievementPanel />`。

## 验证

| 命令 | 结果 |
|------|------|
| `npx tsc --noEmit` | 0 error |
| `npx vitest run tests/achievements.test.ts` | 23/23 通过 |

未跑全量套件（并行工单占用）。

## 出界（未做）

- 积分 / 排行榜 / 连胜 / 虚拟货币 / 社交对比
- 徽章编辑器 / 自定义成就
- LLM 判定「学习态度」类徽章
- 授予动作回写 score / evidence / MasteryProfile
