# T05 三层 AI 辅导 + LLM 通电 — 实现报告

## 完成内容

### 1. `server/tutoring/` 物理隔离包

| 模块 | 职责 |
|------|------|
| `callOpenAICompatible.ts` | 共用 fetch + JSON 抽取 + zod 校验；`resolveLlmProvider()`（`LLM_*` + 可选 `LLM_PROVIDER`） |
| `ExplainGenerator` | 单向讲解；RAG 挂 T09 标准解析（复述已验证解）；temp 0.2 |
| `SocraticGenerator` | Khanmigo 式：不泄答案、一次一问、同构例题、连续 3 次低努力拒绝；temp 0.3 |
| `DialogueGenerator` | 多轮追问；稳定题目卡 + 最近 4–6 轮窗口 + priorSummary；temp 0.25 |
| `templates.ts` | LLM 不可用时的确定性模板兜底 |
| `TutoringService` | D1 双模门 + Attempt 装载 + 输出 `TutoringMessage`（provenance=`llm_inference`） |
| `tutoringRoutes.ts` | `POST /api/tutoring/{explain,socratic,dialogue}` |

### 2. 反馈路径复用

`OpenAICompatibleFeedbackGenerator` 改为调用 `callOpenAICompatible()`，骨架零重复。

### 3. 合约（`shared/contracts.ts`）

- `TutoringLayer` / `TutoringMessage` / `TutoringTurn`
- `TutoringExplainRequest` / `TutoringSocraticRequest` / `TutoringDialogueRequest` / `TutoringResponse`
- `TutoringMessage` **无** `score` / `weight` / `evidence` 字段；provenance 收窄为 `llm_inference`

### 4. D1 双模门

| 层 | practice | assessment |
|----|----------|------------|
| explain | 开放 | 仅 `status === 'completed'`（交卷后） |
| socratic | 开放 | **403 拒绝** |
| dialogue | 开放 | **403 拒绝** |

客户端 `mode` 必须与 `Attempt.mode` 一致，否则 400。

### 5. 铁律物理隔离

- 架构测试：`server/tutoring` 不得 import `EvaluationAgent` / `mastery` / `review` / `runner`
- 不得构造 `EvidenceItem`
- 只读消费 `FeedbackContext`；不回写 score/evidence
- UI 灰色「AI 推断」徽章（ADR-0006）

### 6. UI（`src/components/tutoring/`）

- `TutoringPanel` + `ExplainPanel` / `SocraticPanel` / `DialoguePanel` + `AiInferenceBadge`
- 挂入 `ResultsPanel`（默认 `sessionMode=practice`，`attemptId` 回退 `evaluation.id`）
- `src/lib/api.ts` 增加三层 tutoring API 客户端

### 7. 测试

- `tests/tutoring.test.ts` — generators / D1 门 / HTTP
- `tests/tutoringPanel.test.tsx` — UI 三层 + assessment 关闭
- `tests/architecture.test.ts` — T05 物理隔离 guard

## 验收

| 检查项 | 结果 |
|--------|------|
| `npm test` / `vitest run` | **401 passed** / 1 skipped（原 ~380 + 新增 ~21） |
| `tsc --noEmit` | **0 errors** |
| eslint（T05 相关路径） | **0 errors** |
| 未改 | `server/import/`、`server/mastery/`、`server/auth/` 算法体 |

## 未做（有意留给装配 / 后续）

- 未把 `handleTutoringApi` 挂进 `server/index.ts`（与 T02/T03/T06 一致，协调器统一装配）
- 主 evaluate 路径仍可走 legacy `JsonEvaluationStore`；`TutoringService` 对 AttemptStore 与 legacy 投影均可用
- 流式输出（P1）
- 生产 `LLM_*` 环境变量需运维配置（缺省自动模板 fallback）

## 挂载示例（协调器）

```ts
import { createTutoringService, handleTutoringApi } from './tutoring'
import { JsonAttemptStore } from './store/AttemptStore'

const attemptStore = new JsonAttemptStore(dataFile)
const tutoring = createTutoringService(attemptStore)

// after session resolve:
if (await handleTutoringApi(req, res, url, { tutoring, user })) return
```

## 环境变量

| 变量 | 说明 |
|------|------|
| `LLM_API_KEY` | 必填才通电；否则全模板 |
| `LLM_BASE_URL` | OpenAI-compatible endpoint（DeepSeek/Qwen/豆包/GLM） |
| `LLM_MODEL` | 模型名 |
| `LLM_PROVIDER` | 可选标签，写入 provenance（默认 `openai-compatible`） |
