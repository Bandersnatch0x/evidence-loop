# T16 跨学科模拟考（组卷）— 实现报告

## 范围

教师选择多个教学单元（跨学科 MVP 限同一行政班）→ 确定性组卷 → 教师确认 →
保存草稿 / 一键布置全班。交卷报告是对既有 Attempt 的**只读投影**，不判分。

**不做**：跨行政班组卷、LLM 决定题目、主观题自动计分、排行榜。

## 完成

| 层 | 文件 | 内容 |
|----|------|------|
| **契约** | `shared/mockExam.ts` | `MockExamPlan` / `MockExamSuggestion` / `MockExamPaperReport` 等全部类型 + 纯投影 helpers（`listPlanSubjects` / `isInterdisciplinary` / `groupQuestionsBySubject` / `roundRatio`）+ `hasAnswerAuthority`（D2 闸门，复用 T15 `isAnswerReady`）+ 常量与 `MOCK_EXAM_GATE_NOTICE` |
| **纯函数内核** | `server/mockExam/assembleMockExam.ts` | `AssembleMockExamInput → { plan, warnings }`。无 IO / 无随机 / 无 LLM；薄弱 KP 优先 → 学科字典序轮转 → 同 KP 去重；题量不足只出 warning 允许短卷 |
| **报告投影** | `server/mockExam/buildPaperReport.ts` | `Attempt[] → MockExamPaperReport`。只数题、只聚合已存在 score，不重新判分 |
| **编排** | `server/mockExam/MockExamService.ts` | 三道闸门（D2 答案权威 / D4 已教 KP / 跨单元归属），`suggest`/`save`/`publish`/`report`；`save` 对教师改过的题号**逐题重跑闸门** |
| **持久化** | `server/mockExam/MockExamPlanStore.ts` + 迁移 `0014_mock_exam_plans.sql` | 自有卷面表，无 score/evidence 列；paper_id 回填只做反查 |
| **HTTP** | `server/mockExam/mockExamRoutes.ts` | POST suggest / POST 保存+发布 / GET 卷面 / GET 学生报告 |
| **UI** | `src/components/mockExam/`（TeacherMockExamWizard / StudentMockExamEntry / MockExamReport） | 教师向导（选单元→看建议卷→删换题→发布）+ 学生入口 + 分科报告视图 |
| **测试** | `tests/mockExam.test.ts` | 25 项：D2 闸门、纯函数确定性/去重/轮转/短板、Service 三道闸门、save 重校验、report 只读、HTTP 形状与权限 |

## 关键设计决策

1. **草稿题结构性进不来**：T15 草稿在 `draft_questions` 表，`QuestionStore` 根本读不到；再叠 `source` 运行时校验，脏数据也无门。
2. **薄弱 KP 优先在学科内排序**：跨学科时学科字典序轮转先决定谁上榜，薄弱优先级决定同科内谁先被选——PRD「先覆盖薄弱、再保证学科均衡」的两层语义落成两层排序。
3. **save 与 suggest 共用同一份 `rejectReason` 闸门**：前端删换题后回到服务端必须重新验证，前端不能替服务端放行。
4. **发布转交 T08**：本模块不构造 Attempt/Evidence，`assign` 端口（结构上兼容 `AssignmentService.create`）产出占位 Attempt（status=rejected, score=0）。
5. **报告只读投影**：`buildPaperReport` 只聚合 `Attempt.result` 已有字段，输出含 `algorithm: mockexam.report.v1` 可重放。

## 待接线（本票不改共享 glue 文件，需人工粘贴）

**1. `server/serverTypes.ts`** — `ApiContext` 增加：

```ts
import type { MockExamService } from './mockExam'
// ApiContext 内：
  mockExam: MockExamService
```

**2. `server/serverContext.ts`** — 在 `assignmentService` 之后构造并加入 context：

```ts
import { MockExamPlanStore, MockExamService } from './mockExam'
// 在 const evidenceProjector = ... 附近：
const mockExam = new MockExamService({
  org,
  questions: questionStore,
  mastery: memory.mastery,
  plans: new MockExamPlanStore({ database: productDb }),
  attempts: store,
  assign: assignmentService,
  excludeRecentDays: 0
})
// context 对象加：
  mockExam,
```

**3. `server/index.ts`** — import + 委托路由段（现有 `handle*Api` 之后）：

```ts
import { handleMockExamApi } from './mockExam'
```

```ts
  if (await handleMockExamApi(request, response, requestUrl, context)) {
    return
  }
```

（`MockExamRouteContext` 的 `db` / `mockExam` / `user` 由 server/index.ts 从 context 组装。）

**4. `tests/architecture.test.ts`** — 追加守护（复用既有 `findForbiddenImports`）：`server/mockExam` 目录不得 import runner/mastery/review/evaluation 的写路径（`/(^|\/)mastery(\/|$)/` 需带尾斜杠写法，与 T18 守护一致）。

**5. 前端** — 教师工作台内挂 `<TeacherMockExamWizard />`，学生工作台挂 `<StudentMockExamEntry />`（无需改路由/侧边栏）。

## 验证

| 命令 | 结果 |
|------|------|
| `npx tsc --noEmit` | 0 error |
| `npx vitest run tests/mockExam.test.ts` | 25/25 通过 |

未跑全量套件（并行工单占用）。

## 出界（未做）

- 跨行政班 / 跨学期组卷
- 主观题（essay）进模拟卷自动计分（只能走 T08 教师终裁）
- 组卷过程 LLM 参与选题决策
- 榜单 / 排名 / 成绩单导出
