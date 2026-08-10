# T22 媒体/转写 → 闪卡草稿 — 实现报告

## 范围

教师投入转写文本 / WebVTT 字幕 /（可选）音频 → LLM 生成闪卡草稿（front=概念/术语,
back=解释）→ 教师逐条校对闸门 → 确认后才入库为 fill_blank 题库题。

**不做**：未校对草稿进可作答路径、LLM 编造材料外概念、原文全文落库、任何计分行为。

## 完成

| 层 | 文件 | 内容 |
|----|------|------|
| **契约** | `shared/flashcardDraft.ts` | `FlashcardDraft` / `FlashcardDraftJob` 全类型（无 score/evidence 字段）；provenance 两态（llm_inference → teacher_annotation）；`isFlashcardReady` 闸门口径；`verifyFrontIsGrounded` 正面溯源红线 + `FLASHCARD_GATE_NOTICE` |
| **生成器** | `server/flashcardDraft/FlashcardDraftGenerator.ts` | 唯一允许调 LLM 的文件；模板降级（无 LLM key → 固定 2 张，back 留空逼教师补）；`pickTermCandidates` 从原文抽 front（结构性可溯源）；失败一律回落模板 |
| **编排** | `server/flashcardDraft/FlashcardDraftService.ts` | createJob / createAudioJob（feature flag + 出境闸 + 无学生发言声明）→ 正面溯源过滤 → 校对闸门（未填 back 拒绝 / 已确认重复拒绝 / front 未溯源拒绝）→ `QuestionBankService.create` 唯一写出口（authored_key + 教师 ID） |
| **持久化** | `server/flashcardDraft/FlashcardDraftStore.ts` + 迁移 `0018_flashcard_drafts.sql` | `draft_flashcards` + `flashcard_draft_jobs` 自有表，无 score/evidence 列；原文只落 sha256 |
| **字幕解析** | `server/flashcardDraft/WebVttParser.ts` | WebVTT → 纯文本（纯函数）；非法输入抛 `WebVttInputError` |
| **HTTP** | `server/flashcardDraft/flashcardRoutes.ts` | POST 创建 / POST audio / GET 任务列表 / GET 任务详情 / GET-PATCH 单张 / POST confirm / POST discard / GET assessment-ref（未确认 → 422）；教师私有，学生 403 |
| **测试** | `tests/flashcardDraft.test.ts` | 20 项：provenance、不写题库、sha256 不落全文、溯源红线（编造概念被拒）、闸门（未填 back / 未确认 422 / 确认升级）、归属、HTTP 全流程 |

## 关键设计决策

1. **照抄 T15 闸门手法**：草稿存独立表（结构性进不了题库）、`resolveAssessmentQuestionId` 未确认抛错（路由 422）、确认时硬编码 `authored_key` + 教师 ID、provenance 升级 teacher_annotation、原文只落 sha256。
2. **正面溯源红线**：`verifyFrontIsGrounded` 是前后端共用纯函数（归一化 + 连续子串/最长公共子串占比）；生成期强校验 + 确认期二次拦截，双保险。LLM 产物全被剔除时回落模板（模板 front 抽取原文，恒可溯源）——**永远不会有编造概念入库**。
3. **模板 back 留空**：答案权威只能来自教师；空 back 的草稿确认必被闸门拒绝，保证「校对」不是走过场。
4. **音频默认关闭**：`FLASHCARD_AUDIO_ENABLED` feature flag；学生课堂录音默认禁止（必须勾选「无学生发言素材」）；非本地 STT 需 `LLM_ALLOW_EGRESS`/`FLASHCARD_LLM_EGRESS` 出境开关（T10 egress gate）。

## 待接线（本票不改共享 glue 文件，需人工粘贴）

**1. `server/serverTypes.ts`** — `ApiContext` 增加：

```ts
import type { FlashcardDraftService } from './flashcardDraft'
// ApiContext 内：
  flashcardDraft: FlashcardDraftService
```

**2. `server/serverContext.ts`** — 在 `questionBank` 构造之后：

```ts
import { createFlashcardDraftGenerator, FlashcardDraftService, FlashcardDraftStore } from './flashcardDraft'
// 在 importService 附近：
const flashcardDraft = new FlashcardDraftService({
  store: new FlashcardDraftStore({ database: productDb }),
  questionBank,
  generator: createFlashcardDraftGenerator(process.env),
  now: () => new Date()
})
// context 对象加：
  flashcardDraft,
```

**3. `server/index.ts`** — import + 委托路由段：

```ts
import { tryHandleFlashcardDraftRoute } from './flashcardDraft'
```

```ts
  if (await tryHandleFlashcardDraftRoute(request, response, requestUrl, {
    flashcardDraft: context.flashcardDraft,
    user
  })) {
    return
  }
```

**4. `tests/architecture.test.ts`** — 追加守护：`server/flashcardDraft` 目录不得 import runner/mastery/review/evaluation 写路径（模式写法与 T15/T16/T18/T19/T20 守护一致）。

**5. 前端** — 教师工作台挂闪卡草稿面板（导入字幕/转写 → 校对列表 → 逐条确认）。

## 验证

| 命令 | 结果 |
|------|------|
| `npx tsc --noEmit` | 0 error |
| `npx vitest run tests/flashcardDraft.test.ts` | 20/20 通过 |

未跑全量套件（并行工单占用）。

## 出界（未做）

- 音频自动转写接入真实 STT（服务端只留端口 + feature flag，v1 走模板）
- 闪卡复习调度（FSRS 等）—— 入库后是普通题库题，复用既有练习/复习路径
- LLM 判定「这个词值不值得记」—— 只负责抽取与解释，取舍由教师定
- 原文全文落库 / 导出
