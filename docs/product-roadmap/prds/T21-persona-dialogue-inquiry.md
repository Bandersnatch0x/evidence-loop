# PRD: T21 人物对话探究（练习态，不入分）

**状态**: OPEN
**开建顺序**: 6（体验加深项，非阻塞主路径）
**来源**: 沉浸式探究学习需求

---

## Problem Statement

政史地等学科如果只有"做题-评分"闭环，缺少沉浸与表达训练。学生需要在练习态与历史人物或观点角色对话探究，提升理解深度。但对话产出只应进 `LearnerNarrative`（`llm_inference`），**永不**进 score/evidence/正式 MasteryProfile——正式评价仍走论述题 + EssayRunner + 教师终裁。

## Solution

在知识点或题目上提供「探究对话」按钮（仅练习态）。教师挂载预置 persona（3–5 个 demo 人物：历史人物或观点角色，非真人师生仿冒）。系统 prompt 约束角色只据提供的「史料/教材摘录」回答，不知则说不知。对话产出只进 `LearnerNarrative`，UI 顶栏常驻「练习探究 · 不计入测评」。轮次上限 8–12，可「结束探究 → 去做论述题」。

## User Stories

1. 作为学生，我想在知识点页或题目上看到「探究对话」按钮，以便选择与历史人物对话探究。
2. 作为学生，我想在练习态与预置人物多轮对话，以便加深对历史事件或观点的理解。
3. 作为学生，我想在对话中看到角色据史料回答、不知则说不知，以便建立对 AI 回答的可信度判断。
4. 作为学生，我想在对话达到轮次上限后看到「结束探究 → 去做论述题」引导，以便从探究转入正式评价。
5. 作为学生，我想在 UI 顶栏看到「练习探究 · 不计入测评」常驻标识，以便明确这不影响成绩。
6. 作为教师，我想在题目/知识点上挂载 personaId，以便为学生提供探究入口。
7. 作为教师，我想使用预置的 demo 人物（非真人师生仿冒），以便合规且开箱即用。
8. 作为系统，关闭对话后不产生 Attempt（除非用户另开测评题），以便对话不进评分链。
9. 作为系统，dialogue 路由不 import AttemptStore 写 score，以便架构层隔离。
10. 作为系统，无 LLM 时模板角色回复仍可演示，以便降级不阻塞。
11. 作为开发者，我想在 CI 中验证 dialogue 路由不写 MasteryProfile，以便守护铁律。
12. 作为系统，对连续低努力索取标准答案的套话行为拒绝剧透（对齐 T05 苏格拉底），以便防止作弊。

## Implementation Decisions

### 要定什么

1. **入口**：知识点或题目上的「探究对话」按钮；仅 `mode` 暗示为 practice。需教师在题目/演示上挂载 `personaId`（预置 3–5 个 demo 人物）。

2. **会话边界**：系统 prompt 约束角色只据提供的「史料/教材摘录」回答；不知则说不知。防套话：对齐 T05 苏格拉底（连续低努力索取提示则拒绝剧透标准答案）。轮次上限 8–12；可「结束探究 → 去做论述题」。

3. **与评分隔离**：类型层 `DialogueTurn` 禁止 evidence 标签。架构测试：dialogue 路由不 import AttemptStore 写 score。UI 顶栏常驻「练习探究 · 不计入测评」。

4. **内容来源**：MVP 为预置 persona + 挂载文本摘录（可来自 T09 solution 或教学演示文字）。不做开放互联网检索（幻觉与合规）。

### API / 数据草案

**数据模型**：

```typescript
Persona {
  id, name, subject, eraOrContext,
  sourceExcerpts: string[],
  disclaimer: string
}
DialogueSession {
  id, studentId, personaId, kpId?, questionId?,
  turns: { role, text, at }[],
  status: 'open' | 'closed'
}
```

**API 端点**：

| 方法 | 路径 | 角色 | 说明 |
|------|------|------|------|
| GET | `/api/personas` | student/teacher | 预置列表 |
| POST | `/api/practice/dialogue` | student | 开会话 |
| POST | `/api/practice/dialogue/:id/turn` | student | 多轮 |
| POST | `/api/practice/dialogue/:id/close` | student | 结束 |

### 模块变更

- 新增 `server/dialogue/` 模块（PersonaService + DialogueService + routes），或扩展 `server/tutoring/`。
- 复用 T05 辅导会话骨架和 LLM 调用层（`callOpenAICompatible`）。
- 复用 T09 solution 文本作为 persona 摘录来源。
- 前端知识点/题目页增加「探究对话」入口 + 对话 UI + 顶栏常驻标识。
- `tests/architecture.test.ts` 增加守护：dialogue 路由不 import AttemptStore 写 score。

## Testing Decisions

### 测试缝隙

- **主缝隙**：新 `tests/personaDialogue.test.ts` — HTTP API 级集成测试，覆盖开会话 → 多轮 → 结束全流程 + 隔离验证。
- **架构守护缝隙**：`tests/architecture.test.ts`（扩展）— 验证 `server/dialogue/` 不 import AttemptStore / mastery / review / runner / scoring 路径。

### 测试内容

1. 关闭后无 Attempt 产生（除非用户另开测评题）。
2. 架构：dialogue 路由不 import AttemptStore 写 score / 不写 MasteryProfile。
3. 无 LLM → 模板角色回复可演示（降级测试）。
4. 轮次上限到达后拒绝继续对话，引导转论述题。
5. `DialogueTurn` 类型层无 evidence/score/weight 字段（契约测试，同 T05 TutoringMessage 模式）。
6. 连续低努力索取标准答案 → 拒绝剧透（对齐 T05 防套话）。

### 好测试的标准

只测外部行为（API 响应 + 隔离边界 + 轮次限制 + 降级），不测 LLM 生成内容质量。参考现有 `tests/tutoring.test.ts` 的模式。

## Out of Scope

- 对话自动评分 / 口试分
- 模仿在世教师声线
- 开放 Web RAG
- 测评态强制对话

## Further Notes

### 验收（Done 定义）

1. Demo 人物可多轮对话并结束。
2. 全程无 score 写入；UI 标明练习。
3. 架构测试通过：dialogue 不写 MasteryProfile。
4. 无 LLM 时模板降级可演示。
5. 实现报告 `docs/product-roadmap/reports/T21-implementation-report.md`。

### 关联旧票

- [[T05-ai-tutoring]]：辅导会话骨架、LLM 调用层、防套话
- [[T09-standard-solution]]：persona 摘录来源
- ADR-0006：provenance 隔离
- CONTEXT：LearnerNarrative 与 MasteryProfile 不可交叉写入
