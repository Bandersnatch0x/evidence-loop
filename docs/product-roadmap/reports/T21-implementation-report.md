# T21 实现报告 — 人物对话探究（练习态，不入分）

**Ticket**: ISSUE-T21（体验加深项，Build order 6）
**PRD**: prds/T21-persona-dialogue-inquiry.md
**状态**: 垂直切片完成（数据 → 服务 → API → 前端 → 测试），待主控接线
**验收**: 5/5 Done 条件全部满足（见「测试结果」）

---

## 一、新建文件清单及职责

### 契约 / 数据层

| 文件 | 职责 |
|---|---|
| `shared/personaDialogue.ts` | **独立契约文件**（不动 `shared/contracts.ts`）。固定角色目录 `PERSONA_CATALOG`（5 个 demo 人物：屈原/王安石/张骞/徐霞客/孔子，各挂史料摘录 + 开场白 + 免责声明）、`PersonaId` 联合、`DialogueTurn` / `DialogueSessionView` / `PersonaDialogueMessage`、轮次上限 `DIALOGUE_MAX_ROUNDS=10`、`DIALOGUE_PRACTICE_NOTICE`、`findPersonaEntry` 查表。**`DialogueTurn` 无 score/evidence/weight 字段**（对齐 T05 `TutoringMessage` 隔离模式）。 |
| `server/db/migrations/0017_persona_dialogue.sql` | 三张自有表：`personas`（静态目录镜像快照，按 `catalog_version` 记录）、`dialogue_sessions`（`mode CHECK (mode='practice')`，schema 层堵死 assessment）、`dialogue_turns`（逐轮审计：session_id + turn_index + role + source + provenance_json）。与 mastery/review/evaluations/attempts **无任何外键或写关系**。 |

### 服务层（新模块 `server/dialogue/`）

| 文件 | 职责 |
|---|---|
| `server/dialogue/ports.ts` | 只读依赖端口 + 自有表写端口 `DialogueSessionWriter`（duck-typed，**不 import** 任何评分/Attempt 存储实体）；对话模块的全部错误类。 |
| `server/dialogue/templates.ts` | 无 LLM / LLM 失败的**确定性模板降级**：据第一条史料摘录作答 + 免责声明；防套话文案。纯函数。 |
| `server/dialogue/PersonaDialogueGenerator.ts` | 角色回复生成器。**复用 T05** `callOpenAICompatible` / `resolveLlmProvider` / `countLowEffortStreak`。系统 prompt 约束「只据史料摘录回答、不知则说不知、不评分数、拒绝剧透」；LLM 失败回退模板。 |
| `server/dialogue/DialogueStore.ts` | 持久化实现（只 touch 三张自有表），实现 `DialogueSessionWriter`。seedCatalog / createSession / appendTurn / getSession / listTurns / closeSession。 |
| `server/dialogue/PersonaDialogueService.ts` | 编排层：mode 门（D1）→ 静态目录校验 → 落会话/轮次 → 生成回复并**统一盖 `llm_inference` provenance**。无任何评分写句柄。 |
| `server/dialogue/dialogueRoutes.ts` | HTTP 面：`GET /api/personas`、`POST /api/practice/dialogue`、`POST .../:id/turn`、`POST .../:id/close`。风格照抄 `studyPlanRoutes.ts`（精确路径匹配 + respondError 映射）。 |
| `server/dialogue/index.ts` | 公共面 + 工厂 `createPersonaDialogueService({ database })`（供主控一行接线）。 |

### 前端（只新建，未注册路由/导航）

| 文件 | 职责 |
|---|---|
| `src/components/dialogue/personaDialogueApi.ts` | API 客户端（对齐 `studyPlanApi.ts` 的 demo-role 请求头约定）：listPersonas / openDialogue / sendDialogueTurn / closeDialogue。 |
| `src/components/dialogue/PersonaDialoguePanel.tsx` | 对话面板：顶栏常驻「练习探究 · 不计入测评」横幅、人物选择卡、气泡对话（assistant 挂「AI 推断」徽章）、轮次上限引导「结束探究 → 去做论述题」。 |
| `src/components/dialogue/index.ts` | 前端公共面。 |

### 测试

| 文件 | 职责 |
|---|---|
| `tests/personaDialogue.test.ts` | 20 用例，覆盖：静态目录契约、practice-only 门、provenance 不改分、可审计、无 LLM 降级、轮次上限、防套话、关闭不产生 Attempt、越权/404、HTTP 全流程、**架构守卫**（server/dialogue 不 import 评分路径 + `DialogueTurn` 无分数字段 + 迁移 CHECK）。 |

---

## 二、设计决策

1. **角色目录是静态常量，personas 表是镜像**。铁律要求目录必须像 T17 `AGENT_CATALOG` / T20 `ACHIEVEMENT_CATALOG` 那样是代码里的常量。`PERSONA_CATALOG`（`as const`）是唯一事实源；`personas` 表按 `catalog_version` 存快照，供审计与将来教师挂载，**不是**角色自由发挥的来源。目录外的 personaId 一律 404。

2. **会话不绑定 Attempt，mode 门在 Service 层守**。T21 的探究会话是独立的（PRD 数据模型无 attemptId；关闭不产生 Attempt）。由于没有 Attempt 可对账，D1 门退化为：open 请求 body.mode 必须为 `practice`，否则 `DialogueModeError`(403) 且**不产生任何会话**；存储层 `CHECK (mode='practice')` 兜底。

3. **provenance 统一盖戳（ADR-0006）**。`PersonaDialogueService.buildAssistantTurn` 是唯一盖戳点：任何生成器 draft（llm 或模板降级）都被重写为 `{ kind:'llm_inference', sourceMessages, model, extractedAt }`。`source` 区分 `llm` / `local-policy`（模板），两者都不改分。开场白同样带 llm_inference（静态目录文案，source=local-policy），让整份 transcript 自证一致。

4. **存储层双保险**。`dialogue_turns` 的列集（PRAGMA 校验）无 score/evidence/weight；`DialogueStore` 全文件无一条 SQL 提到 mastery_scores / review_cards / evaluations / attempts。对话在 schema + 代码两层都构造不出评分写入。

5. **复用 T05 而非重造**。LLM 调用层、`resolveLlmProvider`、`countLowEffortStreak`/`HELP_ABUSE_THRESHOLD`（防套话对齐 T05）直接从 `server/tutoring` 导入——它不是评分路径，架构守卫允许，且保证「对齐 T05 苏格拉底」字面成立。

6. **轮次上限到达 → 409 + `suggestedNext:'essay'`**。服务抛 `DialogueRoundLimitError`，路由映射为 409 并附 `suggestedNext:'essay'` + `roundLimit`，前端据此渲染「结束探究 → 去做论述题」CTA。

---

## 三、待主控接线的粘合代码清单（可直接照抄）

以下文件**在禁改名单内，本切片未改动**，需要主控接线。

### 1. `server/serverTypes.ts`

- 在第 13 行附近（`import type { createTutoringService } from './tutoring'` 之后）加：
```ts
import type { createPersonaDialogueService } from './dialogue'
```
- 在 `ApiContext` 接口（约第 40 行 `tutoring` 字段之后）加：
```ts
dialogue: ReturnType<typeof createPersonaDialogueService>
```

### 2. `server/serverContext.ts`

- 在第 47 行（`import { createTutoringService } from './tutoring'`）之后加：
```ts
import { createPersonaDialogueService } from './dialogue'
```
- 在第 234 行（`const tutoring = createTutoringService(store)`）之后加：
```ts
const dialogue = createPersonaDialogueService({ database: productDb })
```
- 在 `context` 对象（约第 289 行 `tutoring,`）加一行：
```ts
dialogue,
```

### 3. `server/index.ts`

- 在第 25 行（`import { handleTutoringApi } from './tutoring'`）之后加：
```ts
import { handleDialogueApi } from './dialogue'
```
- 在 `handleApi` 的委托路由块里，tutoring 委托（约第 769–776 行）之后加：
```ts
if (
  await handleDialogueApi(request, response, requestUrl, {
    dialogue: context.dialogue,
    user
  })
) {
  return
}
```

### 4. `tests/architecture.test.ts`（可选，主控统一补）

如主控希望把 T21 守卫并入公共套件，可照抄本切片 `tests/personaDialogue.test.ts` 第 10 节的三个用例（`server/dialogue` import 守卫、`DialogueTurn` 无分数字段、迁移 CHECK）。**不接线也能跑**——守卫已在本切片自己的测试文件里执行。

### 5. 前端挂载（`src/` 路由/导航注册文件禁改，主控接线）

- 在知识点页 / 题目页加「探究对话」入口，渲染：
```tsx
import { PersonaDialoguePanel } from '../components/dialogue'
{showInquiry ? (
  <PersonaDialoguePanel kpId={kp.id} questionId={question?.id} onClose={() => setShowInquiry(false)} />
) : null}
```
- 顶栏常驻标识可直接用 `DIALOGUE_PRACTICE_NOTICE`（`shared/personaDialogue.ts`）或面板自带的横幅。

---

## 四、测试结果

- `npx tsc --noEmit`：**0 错误**（全仓；并行 agent 的模块若有报错不在本次范围）。
- `npx vitest run tests/personaDialogue.test.ts`：**20/20 通过**。

对应 PRD Done 定义：

| Done 条件 | 覆盖 |
|---|---|
| 1. Demo 人物可多轮对话并结束 | HTTP 全流程 + 轮次上限用例 |
| 2. 全程无 score 写入；UI 标明练习 | provenance 用例 + 存储无分数字段 + 面板横幅 |
| 3. 架构测试：dialogue 不写 MasteryProfile / 不 import AttemptStore | 第 10 节守卫用例 |
| 4. 无 LLM 时模板降级可演示 | 降级用例（source='local-policy' + provenance 仍 llm_inference） |
| 5. 实现报告完成 | 本文档 |

---

## 五、未覆盖项 / 说明

1. **真实 LLM 生成质量**未测（好测试的标准：只测外部行为，不测生成内容）。`FakeLlmGenerator` 覆盖 llm 分支的 provenance/source；真实模型走 `resolveLlmProvider` 环境配置，行为与模板一致。
2. **前端挂载**未注册进导航/路由（禁改名单）；面板为独立组件，随时可接线。
3. **教师挂载 personaId 到题目**（PRD User Story 6/7）未做——MVP 为预置 demo 人物；`personas` 镜像表已就绪，将来可扩。
4. **并发写**未处理（同一会话同时两发 turn）：SQLite 事务内 turn_index 唯一约束会挡住，属已知边界。
5. **`mode` 缺省**（body 不带 mode）返回 400 而非 403——明确要求声明模式。
