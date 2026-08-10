# T18 实施报告 —— 硬事实学习计划 / 本周路径

- 票：T18 `docs/product-roadmap/issues/ISSUE-T18.md`
- PRD：`docs/product-roadmap/prds/T18-hard-fact-study-plan.md`
- 铁律依据：ADR-0001（分数只来自 Runner Evidence）、ADR-0006（硬事实 / 软语义双聚合根隔离）、T05（辅导与打分物理隔离）
- 状态：垂直切片完成。`npx tsc --noEmit` 0 错误；`npx vitest run tests/studyPlan.test.ts` **36 passed / 36**。
- 边界遵守：**只新增文件**。未修改 `server/index.ts`、`tests/architecture.test.ts`、`package.json`、任何既有迁移、前端路由/导航/`App.tsx`、`shared/contracts.ts`、T01–T14 业务文件。新迁移编号 `0013`（未触碰 `server/db/migrations/meta/`）。

---

## 1. 核心设计决策

### 1.1 一条「物理上写不了分」的生成路径

计划生成被切成三段，每段的能力都被类型收窄：

| 层 | 文件 | 能拿到什么 | 能写什么 |
| --- | --- | --- | --- |
| 纯函数内核 | `server/studyPlan/buildStudyPlan.ts` | 一份扁平数据快照 `StudyPlanHardFacts` | 什么都写不了（没有 db / store / service 句柄） |
| 编排层 | `server/studyPlan/StudyPlanService.ts` | 一组**只读端口** | 只有可选的自有快照表 |
| HTTP 面 | `server/studyPlan/studyPlanRoutes.ts` | 上面两层 + 可选布置端口 | 布置动作通过注入端口转交 T06 既有写路径 |

`buildStudyPlan(facts: StudyPlanHardFacts): StudyPlan` 的签名里没有任何句柄，所以「生成计划时顺手改了掌握度」这件事在**类型层面**就不可能发生 —— 不需要靠人自觉，也不需要靠 code review。

### 1.2 read-only ports：保住既有架构扫描

`server/studyPlan/ports.ts` 用结构化（duck-typed）接口声明依赖，**刻意不 import** `server/mastery`、`server/review`、`server/runner`、`server/tutoring` 中的任何实体。

- 现成实现（`MasteryService` / `ReviewScheduler` / `QuestionStore` / `InterventionService` / `SqliteOrgReader` / `AssignByWeaknessService`）在结构上天然满足这些端口，主控接线时**直接传进来即可，不需要写适配器**；
- 但 `server/studyPlan/` 的 import 图里没有一条边指向评分/辅导模块，隔离是结构性成立的。

唯一一条指向 `mastery` 字样的 import 是 `../config/mastery`（`MASTERY_THRESHOLD` 纯常量），架构守护测试用 `/(^|\/)mastery\//`（要求尾部斜杠）把它排除在外。

### 1.3 「不编造」写进了数据结构，而不是写进注释

三条硬输入路线（`fsrs` / `weak` / `mastery`）各自构造 `evidenceRefs`；`collectCandidates` 里有一行：

```ts
// 不编造铁律：锚点为空的候选项一律丢弃。
if (candidate.evidenceRefs.length === 0) return
```

于是「没有证据的任务」在数据通路上根本构造不出来。`shared/studyPlan.ts` 导出的 `findUnbackedTasks(plan)` 是这条不变量的可执行断言（返回违规 kpId 列表，合规时为空数组），T19 / T20 可以直接复用它做入口校验。

### 1.4 与 T06 NextPracticeService 的关键差异

T06 把「MasteryProfile 里没有该 KP」退化成 score 0 的薄弱点。**T18 不这么做**：没有快照 = 没有证据 = 不产出任务。这条差异在 `StudyPlanService.weakSnapshotKpIds` 与 `buildStudyPlan.collectCandidates` 两处都有显式注释，并由测试 `MasteryProfile 里缺失的 KP 视为「没有证据」` 锁死。

冷启动的结果是一份 `status: 'insufficient_evidence'` 的空计划 —— 7 天骨架仍然完整，只是每天都是空的。这是**诚实**，不是缺陷。

### 1.5 建议层是事后外挂

`attachPresentationHint(plan, hint)` 是纯函数：

- `provenance.kind !== 'llm_inference'` → 原样返回（伪装成 `evidence` / `learner_self_report` / `teacher_annotation` 的文案一律拒绝）；
- 空白文案 → 原样返回；
- 合法时返回 `{ ...plan, presentationHint }`，`days` 引用**原样透传**，所以 tasks 逐字节不可能被 hint 改写。

无 LLM 时整条链路照常工作，tasks 完整、hint 缺省。前端把 hint 渲染在虚线框里，与硬事实任务在视觉上分开。

### 1.6 确定性与可重放

- 计划 id = `plan_<studentId>_<unitId>_<YYYY-MM-DD>`（UTC 自然日）；
- `algorithm = 'plan.hard.v1'`；
- 排序键全部定宽/字典序（`dueAt` → `kpId`；分数用 `toFixed(6).padStart(10,'0')`），跨平台稳定；
- 候选轮转铺到 7 天（`index % horizonDays`），最高优先级必然落在今天。

结果：「每次打开重算」与「每日 0 点重算」是同一条代码路径，幂等。`collectHardFacts()` 的返回值就是完整重放输入 —— 想审计「计划凭什么这么排」，读它即可。

---

## 2. 新增文件与职责

### 契约

| 文件 | 职责 |
| --- | --- |
| `shared/studyPlan.ts` | T18 独立契约（**未动** `shared/contracts.ts`）。类型：`StudyPlan` / `StudyPlanDay` / `StudyPlanTask` / `StudyPlanEvidenceRef` / `StudyPlanHardFacts` / `StudyPlanDependencyGap` / `StudyPlanPresentationHint`。常量：`STUDY_PLAN_ALGORITHM`、`STUDY_PLAN_HORIZON_DAYS`。辅助：`listStudyPlanTasks` / `listTodayTasks` / `findUnbackedTasks` / `isAdvisoryHint`。 |

### 服务端

| 文件 | 职责 |
| --- | --- |
| `server/studyPlan/buildStudyPlan.ts` | 纯函数内核。三路硬输入合并 ∩ `taughtKpIds`(D4)，铺到 7 天窗口。 |
| `server/studyPlan/ports.ts` | 只读端口：`DueCardReader` / `StudyPlanMasteryReader` / `DependencyGapReader` / `StudyPlanQuestionReader` / `StudyPlanOrgReader` / `StudyPlanSnapshotWriter`，以及 `TeachingUnitMissingError`。 |
| `server/studyPlan/StudyPlanService.ts` | 编排：`generate()` / `collectHardFacts()`；外加纯函数 `attachPresentationHint()`。 |
| `server/studyPlan/StudyPlanSnapshotStore.ts` | 自有快照表读写（UPSERT + load），纯缓存语义。 |
| `server/studyPlan/studyPlanRoutes.ts` | 4 个 HTTP 端点 + `StudyPlanAssignPort` / `StudyPlanRouteContext` / `StudyPlanResponse`。 |
| `server/studyPlan/index.ts` | 模块 barrel。 |
| `server/db/migrations/0013_study_plan_snapshots.sql` | 建 `study_plan_snapshots` 表 + 索引。与 `mastery_scores` / `review_cards` / `evaluations` **无任何外键或写关系**。 |

HTTP 端点：

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/student/study-plan?studentId=&unitId=` | `student-data` | 学生 7 日计划 + 今日任务 |
| POST | `/api/student/study-plan/regenerate` | `student-data` | 强制重算（幂等） |
| GET | `/api/teacher/students/:id/study-plan?unitId=` | `teaching` + `student-data` | 教师只读 |
| POST | `/api/teacher/study-plan/assign` | `teaching` | 一键布置某日/整周；无 assign 端口时 501，无任务时 409 |

### 前端

| 文件 | 职责 |
| --- | --- |
| `src/components/studyPlan/studyPlanApi.ts` | 独立客户端（**不改** `src/lib/api.ts`，避免与并行 agent 冲突），复用 `src/lib/demoRole`。 |
| `src/components/studyPlan/StudyPlanTimeline.tsx` | 学生「本周计划」时间条：7 天列 + 证据不足空态 + 重算按钮 + hint 虚线框。 |
| `src/components/studyPlan/StudyPlanDayColumn.tsx` | 共享日格（学生可交互 / 教师 `readOnly`），显示 reason 标签与证据条数。 |
| `src/components/studyPlan/TeacherStudyPlanPanel.tsx` | 教师只读计划 + 「布置今日」/「布置整周」。 |
| `src/components/studyPlan/studyPlan.css` | 局部样式（DESIGN.md 令牌；靛蓝只用于品牌/政策徽章）。 |
| `src/components/studyPlan/index.ts` | barrel。 |

### 测试

| 文件 | 覆盖 |
| --- | --- |
| `tests/studyPlan.test.ts` | 36 项，见 §4。 |

---

## 3. 接线胶水清单（**最重要** —— 这些文件我被禁止修改，需主控合并时手工补）

> 以下每一条都是**新增**，不改动既有行为。全部补完之前，T18 的后端能力已可被单测覆盖，但线上还访问不到路由。

### 胶水 1 — `server/serverTypes.ts`：`ApiContext` 增字段

```ts
// 顶部 import 区
import type { StudyPlanService } from './studyPlan'

// ApiContext 接口内，紧跟 assignByWeakness 之后
  studyPlan: StudyPlanService
```

### 胶水 2 — `server/serverContext.ts`：构造并注入

```ts
// 顶部 import 区
import { StudyPlanService, StudyPlanSnapshotStore } from './studyPlan'

// 紧跟 `const assignByWeakness = new AssignByWeaknessService({...})` 之后
  const studyPlan = new StudyPlanService({
    review: memory.review,          // ReviewScheduler 结构上满足 DueCardReader
    mastery: memory.mastery,        // MasteryService 满足 StudyPlanMasteryReader
    org,                            // SqliteOrgReader 满足 StudyPlanOrgReader
    questions: questionStore,       // QuestionStore 满足 StudyPlanQuestionReader
    interventions,                  // InterventionService 满足 DependencyGapReader
    snapshots: new StudyPlanSnapshotStore({ database: productDb })
  })

// `const context: ApiContext = { ... }` 字面量里，assignByWeakness 之后
    studyPlan,
```

**注意**：五个依赖都是既有实例，**不需要适配器** —— 端口是按它们的现有方法签名反向声明的。

### 胶水 3 — `server/index.ts`：挂载路由

```ts
// 顶部 import 区（与 `import { handleAdaptiveApi } from './adaptive'` 同级）
import { handleStudyPlanApi } from './studyPlan'

// 在 `handleAdaptiveApi(...)` 那个 if 块之后插入
  if (
    await handleStudyPlanApi(request, response, requestUrl, {
      db: context.productDb,
      studyPlan: context.studyPlan,
      user,
      assign: context.assignByWeakness   // 结构上兼容 StudyPlanAssignPort
    })
  ) {
    return
  }
```

挂载顺序无所谓 —— 路径判定是精确匹配 / 单一正则，不会误吞其它路由；未命中时返回 `false` 原样放行。

### 胶水 4 — `src/components/student/StudentWorkbench.tsx`：学生入口

```tsx
import { StudyPlanTimeline } from '../studyPlan'

// 在 <TodayPractice ... /> 之后、紧跟其后的 <hr /> 之前
      <hr />
      <StudyPlanTimeline
        studentId={studentId}
        teachingUnitId={teachingUnitId}
        refreshKey={refreshKey}
        busy={busy}
        onStartTask={(questionId) => {
          void startQuestion(questionId, 'practice')
        }}
      />
```

### 胶水 5 — 教师端入口（宿主页自选）

`TeacherStudyPlanPanel` 需要 `{ studentId, teachingUnitId }`，放在教师查看单个学生的面板里即可：

```tsx
import { TeacherStudyPlanPanel } from '../studyPlan'

<TeacherStudyPlanPanel
  studentId={selectedStudentId}
  teachingUnitId={teachingUnitId}
  onAssigned={() => setRefreshKey((k) => k + 1)}
/>
```

### 胶水 6 — `tests/architecture.test.ts`：把 T18 守护并入全局架构测试（可选）

我在 `tests/studyPlan.test.ts` 里自带了等价的架构守护（4 项）。若希望它出现在统一的架构红灯里，把下面这段搬到 `tests/architecture.test.ts`：

```ts
describe('architecture guard: T18 计划模块隔离', () => {
  const PLAN_DIRS = ['server/studyPlan', 'src/components/studyPlan']
  const FORBIDDEN = [
    /(^|\/)mastery\//, /(^|\/)review\//, /(^|\/)runner\//, /(^|\/)tutoring\//,
    /(^|\/)domain\/EvaluationAgent/, /computeMastery/, /(^|\/)memory\//,
    /\bmem0ai\b/, /@xenova\/transformers/, /(^|\/)ollama($|\/)/
  ]
  it('计划模块 import 图不指向 mastery/review/runner/tutoring/LLM 运行时', () => {
    expect(findForbiddenImports(PLAN_DIRS, FORBIDDEN)).toEqual([])
  })
})
```

⚠️ 模式必须写成 `/(^|\/)mastery\//`（带尾部斜杠），否则会误伤 `../config/mastery` 这个纯阈值常量模块。

### 胶水 7 — 迁移编号冲突检查

T15 占用 `0012_material_import.sql`，T18 占用 `0013_study_plan_snapshots.sql`。合并 T19–T23 时从 `0014` 起编号。`applyProductMigrations` 按文件名排序执行且通过 `schema_migrations` 幂等，`openMemoryDatabase(':memory:')` 会自动应用 0013，测试无需额外准备。

---

## 4. 测试结果

```
npx tsc --noEmit                        → 0 errors
npx vitest run tests/studyPlan.test.ts  → Test Files 1 passed (1)
                                          Tests      36 passed (36)
```

| 分组 | 数量 | 覆盖的铁律 |
| --- | --- | --- |
| `buildStudyPlan：硬输入 → 计划（纯函数）` | 12 | **不编造**（无硬输入 / 未开课 / 缺快照三种冷启动都产出 `insufficient_evidence` 空计划）；**可追溯**（`findUnbackedTasks() === []`，逐条校验 ref 结构）；**D4**（未教 KP 即使到期且 0 分也不进）；依赖链缺口触发点必须有真实低分快照；阈值边界；**确定性**（两次构建 JSON 逐字节相同 + 计划 id 固定）；`mode` 恒 `practice`；题量不超过题库供给；候选超限截断；task 结构无 `score` 字段 |
| `建议层 presentationHint：provenance 与隔离` | 5 | 只接受 `llm_inference`；拒绝伪装成 `evidence`/`learner_self_report`/`teacher_annotation`；挂 hint 后 `days` 逐字节不变且原对象未被就地修改；空文案忽略；**证据不足的计划不会被文案「填满」** |
| `StudyPlanService：只读收集硬事实` | 6 | **不写分**（`mastery_scores`+`review_cards`+`evaluations` 三表全量内容指纹前后一致，重复生成仍一致）；真实 `ReviewScheduler` 到期卡进计划且按 D4 过滤；题目来自教师私有题库；`collectHardFacts()` 可完整重放出同一计划；缺单元抛 `TeachingUnitMissingError`；快照表 UPSERT 只留一行且只写自有表 |
| `study plan HTTP 路由` | 9 | GET/regenerate 只读且不写计分表；跨学生 403；regenerate 幂等；教师只读端点角色门；一键布置只转交计划内 KP 且恒 `practice`；**证据不足时 409 拒绝布置**；学生调布置 403；未命中路径原样放行 |
| `architecture guard: T18 计划模块隔离` | 4 | import 图不指向 mastery/review/runner/tutoring/LLM 运行时；源码无计分表写语句；`buildStudyPlan` 保持纯函数签名（编译期 + 源码扫描）；迁移 0013 不碰计分表 |

「不写分」用的是三张表的**全量行内容指纹**（`SELECT *` 后 JSON 序列化比对），不是行数比对 —— 改值而不改行数也会红灯。

---

## 5. 未覆盖 / 已知缺口

1. **未接线**：§3 的 7 条胶水未落地，所以线上还访问不到 `/api/student/study-plan`。已加的路由测试用独立 `createServer` 直接调 `handleStudyPlanApi`，覆盖的是 handler 本身而非主控挂载。
2. **前端无组件测试**。`StudyPlanTimeline` / `TeacherStudyPlanPanel` / `StudyPlanDayColumn` 只做了 tsc 类型校验，没有 `.test.tsx`。空态 / hint 虚线框 / 证据条数角标的渲染断言待补。
3. **`presentationHint` 没有生产者**。T18 只提供了 `attachPresentationHint` 这个安全闸门，实际调用 LLM 生成文案的那一步留给 T19（周报）—— 现在整条链路是「无 LLM」形态，且这是**完整可用**形态。
4. **快照表只写不读**。`StudyPlanSnapshotStore.load` 已实现并测试，但路由目前每次都全量重算（幂等，成本可接受）。「先读缓存、失效才重算」的策略未接。
5. **无按日重算的定时任务**。「每日 0 点重算」目前靠请求触发；由于生成是幂等纯函数，这不影响正确性，只影响首屏延迟。
6. **`targetCount` 是常量表**（`fsrs:2 / weak:3 / mastery:3`），未按遗忘曲线或历史正确率加权。加权需要更多硬输入，属于后续迭代。
7. **`listEnrolledStudentIds` 端口已声明但未使用**。为 T19 的班级级周报预留。

---

## 6. 给 T19（学习周报）/ T20（轻量激励）复用的接口

以下全部已从 `server/studyPlan/index.ts` 与 `shared/studyPlan.ts` 导出，**无需修改 T18 代码即可复用**。

### 6.1 只读地拿到一份可追溯的计划

```ts
import { StudyPlanService, buildStudyPlan } from '../studyPlan'
import type { StudyPlanHardFacts } from '../../shared/studyPlan'

class StudyPlanService {
  generate(studentId: string, teachingUnitId: string, options?: GenerateStudyPlanOptions): Promise<StudyPlan>
  collectHardFacts(studentId: string, teachingUnitId: string, options?: GenerateStudyPlanOptions): Promise<StudyPlanHardFacts>
}

function buildStudyPlan(facts: StudyPlanHardFacts, options?: BuildStudyPlanOptions): StudyPlan
```

- **T19 周报**：调 `collectHardFacts()` 拿到本周硬事实快照，直接作为周报的「事实段」数据源；调 `buildStudyPlan()` 用**上周的** `now` 重放出上周计划，与实际完成情况做差，得到「计划 vs 实际」对比。整个过程零写入。
- **T20 激励**：`generate()` 后统计 `listStudyPlanTasks(plan).length` 与已完成数，得到进度比例。

### 6.2 计划投影与不变量校验

```ts
import {
  listStudyPlanTasks,   // (plan) => StudyPlanTask[]        全周扁平视图
  listTodayTasks,       // (plan) => StudyPlanTask[]        dayIndex === 0
  findUnbackedTasks,    // (plan) => string[]               无锚点任务的 kpId（空数组 = 合规）
  isAdvisoryHint,       // (hint) => boolean                provenance === 'llm_inference'
  STUDY_PLAN_ALGORITHM,
  STUDY_PLAN_HORIZON_DAYS
} from '../../shared/studyPlan'
```

**建议**：T19/T20 在任何「把计划内容展示给用户」的入口都先跑一次 `findUnbackedTasks(plan)`，非空即拒绝渲染 —— 这是最便宜的不编造闸门。

### 6.3 建议层安全闸门（T19 生成周报文案时直接用）

```ts
import { attachPresentationHint } from '../studyPlan'

// provenance 不是 llm_inference / 文案为空 → 原样返回，days 一个字节都不会变
const withHint = attachPresentationHint(plan, {
  text: llmSummary,
  provenance: { kind: 'llm_inference', sourceMessages: [...], model, extractedAt }
})
```

T19 若要给周报加自己的 LLM 段落，**照抄这个模式**：硬事实字段先算完、冻结，LLM 产物作为带 provenance 的独立字段外挂，永不参与硬字段计算。

### 6.4 端口类型（T19/T20 写自己的 Service 时复用，避免各自再声明一遍）

```ts
import type {
  DueCardReader,             // listDue(studentId, now?, limit?): ReviewCard[]
  StudyPlanMasteryReader,    // getProfile(studentId): MasteryProfileMap
  DependencyGapReader,       // suggestNextIntervention(studentId, weakKp): Promise<InterventionSuggestion>
  StudyPlanQuestionReader,   // list({ authorId?, kpIds?, limit? }): Question[]
  StudyPlanOrgReader,        // getTeachingUnit(id) / listEnrolledStudentIds(classId, termId)
  StudyPlanSnapshotWriter    // save(plan) / load(studentId, teachingUnitId)
} from '../studyPlan'
```

复用这些端口 = 自动继承「import 图不指向评分模块」的架构隔离性质。`listEnrolledStudentIds` 是专门为 T19 班级级周报留的。

### 6.5 证据锚点类型（T20 发奖励时用来自证「凭什么」）

```ts
import type { StudyPlanEvidenceRef } from '../../shared/studyPlan'
// { kind: 'review_card',      cardId, kpId, dueAt }
// { kind: 'mastery_snapshot', kpId, score, evidenceIds, computedAt, algorithmVersion }
```

`plan.evidenceRefs` 是全计划锚点并集。T20 的每一枚徽章/积分都应该携带触发它的 `StudyPlanEvidenceRef[]`，这样「为什么给我这个奖励」永远能回答到 Evidence 层。
