# T04 扫描导入 + OCR 人工校对闸门 — 实现报告

## 完成内容

1. **MVP-0 文档解析（纯 Node、无 GPU、无出境）**
   - `server/import/DocxParser.ts`：mammoth 抽 `.docx` 文本层
   - `server/import/PdfTextParser.ts`：pdf-parse 抽带文本层 PDF；空文本层路由 OCR

2. **OCR 抽象 + 默认本地/mock（T10）**
   - `OcrProvider` 接口 + `OCR_PROVIDER=mock|local|paddle|mathpix`（默认 **mock**）
   - `MockOcrProvider`（测试/离线）
   - `PaddleOcrProvider` / `LocalOcrProvider` / `MathpixProvider` **骨架**（未实装；Mathpix 强制 `OCR_ALLOW_EGRESS=true`）

3. **ImportDraft 模型 + 持久化**
   - `shared/contracts.ts`：`ImportDraft` / `ImportDraftItem` / 状态枚举
   - Migration `0005_import_drafts.sql` + Drizzle `importDrafts` 表
   - `ImportDraftStore`（SQLite，与 T01/T03 同一迁移路径）

4. **LLM 后处理拆题（草稿 only）**
   - `QuestionSplitter`：OpenAI-compatible 骨架 + `LocalHeuristicQuestionSplitter` 离线兜底
   - 每题 `provenance.kind = 'llm_inference'`，**绝不入评分**
   - LLM 出境需 `LLM_ALLOW_EGRESS` / `IMPORT_LLM_EGRESS=true`

5. **D2 人工校对闸门（核心）**
   - 流程：`parse → pending_review 草稿 → 老师 confirm/skip → QuestionBank`
   - 未校对草稿 **不是** Question，`isUsableForAssessment() === false`
   - `confirm` 写入的题 `source: authored_key`（老师权威）

6. **HTTP 路由（未改 `server/index.ts`，对齐 T02/T03）**
   - `POST /api/import/parse`
   - `GET  /api/import/drafts` / `GET /api/import/drafts/:id`
   - `POST /api/import/drafts/:id/confirm`
   - 教师权限；导入前提示勿含手写签名/学号（`IMPORT_PRIVACY_NOTICE`）

7. **依赖**
   - `mammoth@^1.8.0`、`pdf-parse@^1.1.1`、`@types/pdf-parse`
   - `better-sqlite3` 保持 `^11`

## 验收

| 检查项 | 结果 |
|--------|------|
| `npx vitest run` | **380 passed** / 1 skipped（原 ~364 + 16 import） |
| `npm run lint` | 0 errors |
| `npx tsc --noEmit` | 0 errors |
| 无 any / 无 `!` | 遵守 |
| 未改 `server/auth/`、`server/mastery/`、`server/multimodal/`、`src/` | 遵守 |
| 未改 `server/index.ts` | 遵守（路由导出供 coordinator 挂载） |

## 接线提示（留给 coordinator）

```ts
import {
  createOcrProvider,
  createQuestionSplitter,
  ImportDraftStore,
  ImportService,
  tryHandleImportRoute
} from './import'
import { QuestionBankService } from './questionbank/QuestionBankService'
import { QuestionStore } from './questionbank/QuestionStore'

const questionStore = new QuestionStore({ dbPath: memoryDbPath })
const questionBank = new QuestionBankService({ store: questionStore })
const importStore = new ImportDraftStore({ /* shared db or path */ })
const importService = new ImportService({
  store: importStore,
  questionBank,
  ocr: createOcrProvider(),
  splitter: createQuestionSplitter()
})

// inside handleApi, after session resolve:
if (
  await tryHandleImportRoute(request, response, requestUrl, {
    importService,
    user
  })
) {
  return
}
```

## 裁决对齐

| 裁决 | 落地 |
|------|------|
| D2 OCR 只是草稿 | `ImportDraft.status=pending_review`；仅 confirm 写 Question |
| TR1 MVP-0 电子文档优先 | DocxParser + PdfTextParser 主路径 |
| T10 分级出境 | L1 only；默认 mock/local；Mathpix / LLM 出境开关 |
| 复用 T03 题库 | confirm → `QuestionBankService.create` + `authored_key` |
| 复用 T02 教师权限 | 路由拒绝 non-teacher；authorId 来自 session |

## 未做（有意留给后续）

- 前端校对 UI（任务禁止改 `src/`）
- PaddleOCR / Mathpix 真实调用
- 试卷切题 / 化学结构图（MVP-2 fog）
- 挂入 `server/index.ts` 主装配（与 T02/T03 一致，由 coordinator 统一接线）
