# T15 材料 → 草稿题（教师校对闸门）— 实现报告

## 范围

一条打穿数据 → 服务 → API → 前端 → 测试的纵向切片：教师投材料 → LLM 生成候选草稿题
→ 并排校对逐题修正 → **确认后才写入题库**。

**铁律落地方式**：草稿存在独立的 `draft_questions` 表，它**不是 `Question`**，
因此结构上不可能出现在题库列表、测评选题器、Runner / Rubric 输入里。
生成物 provenance 恒为 `llm_inference`；教师确认时服务端强制写入
`source = 'authored_key'`、`authorId = 教师 ID`，草稿 provenance 升级为 `teacher_annotation`。
整条链路不 import 任何 runner / mastery / review / scoring / evaluation / attempt 模块。

## 完成

| 层 | 文件 | 内容 |
|----|------|------|
| **迁移** | `server/db/migrations/0012_material_import.sql` | `material_import_jobs` + `draft_questions` 两表 + 索引。**无 score / evidence / attempt 列**（DDL 层面杜绝写分） |
| **共享契约** | `shared/materialImport.ts` | `DraftQuestion` / `MaterialImportJob` / `MaterialImportJobView` / `DraftQuestionProvenance`（只有 `llm_inference` \| `teacher_annotation` 两态）+ `isAnswerReady()` 前后端共用闸门口径 + `MATERIAL_IMPORT_GATE_NOTICE` |
| **生成器** | `server/materialImport/DraftQuestionGenerator.ts` | 链路上**唯一**允许调 LLM 的文件。`TemplateDraftQuestionGenerator`（无 key 降级，固定 2 题、**答案留空**）/ `OpenAICompatibleDraftQuestionGenerator`（出境开关未开或任何异常 → 回落模板）/ `createDraftQuestionGenerator()` 工厂 |
| **存储** | `server/materialImport/MaterialImportStore.ts` | 复用 product DB + `applyProductMigrations`；支持 `{ database }` 注入（与 T04 `ImportDraftStore` 同构）；草稿按生成顺序返回 |
| **服务** | `server/materialImport/MaterialImportService.ts` | `createJob`（原文只落 sha256）/ `getJobView` / `patchDraft` / `discardDraft` / `confirmDraft`（硬闸门）/ `confirmBatch`（循环走同一闸门，非绕过）/ `resolveAssessmentQuestionId`（未确认 → 抛错） |
| **HTTP** | `server/materialImport/materialImportRoutes.ts`、`index.ts` | `tryHandleMaterialImportRoute()`，7 个端点，教师/管理员私有（其余 403） |
| **前端** | `src/components/materialImport/MaterialDraftReviewPanel.tsx`、`materialImport.css`、`index.ts` | 左原文右草稿并排校对；每条显式标 `llm_inference · 未经教师背书` 与「不可作答 / 不可计分 / 不在选题器」；未填答案时「确认入库」按钮禁用；低置信标红 |
| **测试** | `tests/materialImport.test.ts` | 22 条，全绿 |

## 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/teacher/material-import` | 投料 → 生成草稿，返回 `201 { job, drafts, gateNotice, quota, publishedToQuestionBank: false }` |
| GET | `/api/teacher/material-import` | 我的生成任务列表 |
| GET | `/api/teacher/material-import/:jobId` | `MaterialImportJobView` |
| POST | `/api/teacher/material-import/:jobId/confirm-batch` | 批量确认，回报 `skipped[{draftId, reason}]` |
| GET | `/api/teacher/material-import/drafts/:id` | 单条草稿 + `usableForAssessment` |
| PATCH | `/api/teacher/material-import/drafts/:id` | 教师修正题干/选项/答案/难度/KP |
| POST | `/api/teacher/material-import/drafts/:id/confirm` | 闸门 → 写题库，返回 `{ draft, question, job }` |
| POST | `/api/teacher/material-import/drafts/:id/discard` | 丢弃，不产生 Question |
| GET | `/api/teacher/material-import/drafts/:id/assessment-ref` | 已确认 → `{ questionId }`；**未确认 → 422** |

错误映射：闸门 400（带 `gateNotice`）/ 越权 403 / 不存在 404 / 未确认引用 422 / 超限 413。

## 闸门是硬的，不是提示

1. **结构隔离** — 草稿在 `draft_questions`，题库读的是 `questions`，两者无 JOIN。
2. **答案权威** — `isAnswerReady()` 不过 → `MaterialImportGateError`，模板降级草稿刻意留空答案，
   保证没有 LLM key 时闸门依然被真实触发。
3. **测评引用** — `resolveAssessmentQuestionId()` 是唯一的「草稿 → 可布置题」出口，未确认即抛错（422）。
4. **写库出口唯一** — 全模块只有 `confirmDraft()` 一处调用 `QuestionBankService.create()`，
   且 `source` 硬编码 `authored_key`、`authorId` 取自会话教师，调用方不可覆盖。
5. **批量不是后门** — `confirmBatch()` 逐题复用 `confirmDraft()`，跳过项返回原因。

## 验证

```
npx tsc --noEmit                          → 0 error
npx vitest run tests/materialImport.test.ts → 22 passed (1 file)
```

覆盖：草稿 provenance = `llm_inference`；`createJob` 后题库仍为空；原文只存 sha256；
未填答案不可确认；未确认草稿 `assessment-ref` → 422；确认后 provenance 升级 +
`source=authored_key` + `authorId=教师`；丢弃/重复确认被拒；批量确认跳过原因；
跨教师 403、学生 403、未知草稿 404；**源码扫描断言模块不 import 任何计分/掌握度/Runner**；
迁移 DDL 无 score/evidence/attempt 列。

> 环境备注：仓库内 `node_modules/better-sqlite3` 的原生二进制原先是按 Node 24（ABI 137）编译的，
> 当前 shell 的 Node 是 22.22.2（ABI 127），导致**所有** SQLite 相关既有测试（如 `questionBank.test.ts`）
> 一并报 `NODE_MODULE_VERSION` 错。已用 `prebuild-install` 拉取 ABI 127 预编译产物替换
> （仅动 `node_modules`，未改 `package.json` / `package-lock.json`）。
> 若要切回 Node 24 运行，重新 `npm rebuild better-sqlite3` 即可。

## 待接线（本票不改共享 glue 文件，需主控人工粘贴）

**1. `server/serverTypes.ts`** — `ApiContext` 追加字段：

```ts
import type { MaterialImportService } from './materialImport'
// ... interface ApiContext {
  materialImportService: MaterialImportService
```

**2. `server/serverContext.ts`** — 构造（挨着现有 `importService` 那段）并加入返回对象：

```ts
import {
  createDraftQuestionGenerator,
  MaterialImportService,
  MaterialImportStore
} from './materialImport'

const materialImportService = new MaterialImportService({
  store: new MaterialImportStore({ database: productDb }),
  questionBank,
  generator: createDraftQuestionGenerator()
})
```

```ts
  // return { ... } 中追加
  materialImportService,
```

**3. `server/index.ts`** — 顶部 import + 在 `tryHandleImportRoute` 委托段之后插入：

```ts
import { tryHandleMaterialImportRoute } from './materialImport'
```

```ts
  if (
    await tryHandleMaterialImportRoute(request, response, requestUrl, {
      materialImportService: context.materialImportService,
      user
    })
  ) {
    return
  }
```

**4. `tests/architecture.test.ts`** — 追加守护（复用文件内既有 `findForbiddenImports` / `formatViolations`）：

```ts
describe('architecture guard: T15 material import never touches scoring', () => {
  it('draft generation path imports no runner/mastery/scoring module', () => {
    const violations = findForbiddenImports('server/materialImport', [
      'runner',
      'mastery',
      'review',
      'scoring',
      'evaluation',
      'attempt'
    ])
    expect(violations, formatViolations(violations)).toEqual([])
  })

  it('confirmDraft is the only writer into the question bank', () => {
    const source = readFileSync('server/materialImport/MaterialImportService.ts', 'utf8')
    expect(source.match(/questionBank\.create\(/g) ?? []).toHaveLength(1)
    expect(source).toContain("CONFIRMED_ANSWER_AUTHORITY = 'authored_key'")
  })
})
```

**5. 前端挂载点** — 教师工作台（如 `src/components/teacher/...` 的题库/导入标签页）内插入，
不需要新路由、不需要改侧边栏：

```tsx
import { MaterialDraftReviewPanel } from '../materialImport'

<MaterialDraftReviewPanel questionBankId={bankId} subject={subject} />
```

**6. 无需接线** — 迁移 `0012_material_import.sql` 由 `applyProductMigrations` 自动按序应用；
`server/db/migrations/meta/` 未改动。

## 边界确认

- 只新增文件；未改 `server/index.ts`、`tests/architecture.test.ts`、`package.json`、
  已有迁移、前端路由/导航、`shared/contracts.ts`、T01–T14 业务文件。
- 迁移号取 0012（T18 用 0013），无冲突。
