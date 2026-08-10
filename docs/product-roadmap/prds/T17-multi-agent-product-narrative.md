# PRD: T17 多 Agent 产品叙事包装（路演 / 透明度）

**状态**: OPEN
**开建顺序**: 1（最薄、利路演）
**来源**: 产品叙事增强需求（与现有服务切分对齐）

---

## Problem Statement

行业通用做法常以「多智能体分工」的叙事来呈现产品能力。循证环**已有**评分 / 诊断 / 辅导 / 推题 / 教师建议等服务切分，但对外仍像单体应用。评委和外部观察者无法一眼看出"哪个 Agent 碰分数、哪个不碰"，削弱了"评分不用 LLM"这一核心信任主张。

## Solution

**不重写架构**。把现有能力显式包装为可演示的 Agent 编队——在透明度页展示五 Agent 卡片（输入 / 输出 / 禁止事项），在工作台 PipelineBar 步骤名上与 Agent 名对齐，并在 Demo 口播中讲清：**只有评分 Agent 碰分数，且它不用 LLM**。

## User Stories

1. 作为评委，我想在透明度页一眼看到所有 Agent 及其职责边界，以便判断架构可信度。
2. 作为评委，我想看到"评分 Agent"与"辅导 Agent"是否碰分数的明确标注，以便验证"LLM 不改分"铁律。
3. 作为开发者，我想有一个静态 Agent 目录作为单一事实源，以便透明度页、口播脚本和文档引用同一份数据。
4. 作为开发者，我想在 CI 中自动验证"评分 Agent 不允许 LLM"的契约，以便防止未来代码回归。
5. 作为教师，我想在透明度页理解系统的五步流程如何对应到具体 Agent，以便建立对自动评分的信任。
6. 作为学生，我想在工作台 PipelineBar 上看到当前执行步骤对应的 Agent 名称，以便理解系统在做什么。
7. 作为路演者，我想有一段 30 秒口播稿讲清"多 Agent 但不碰分"，以便在 Demo 中高效传达核心叙事。
8. 作为产品团队成员，我想在 PROJECT_BRIEF 和 PITCH_DECK 中引用 Agent 编队图，以便对外材料一致性。
9. 作为外部评审，我想通过只读 API 获取 Agent 目录 JSON，以便自动化检查或引用。
10. 作为开发者，我想确保 Agent 目录的声明与实际代码隔离一致（评分模块不 import 辅导 LLM 写回路径），以便目录不是空话。

## Implementation Decisions

### 要定什么

1. **Agent 编队定义（产品名，非新进程）**

| Agent 名（对外） | 对内模块 | 是否碰 score |
|------------------|----------|--------------|
| 评分 Agent | RunnerRegistry + Rubric | 是（确定性） |
| 诊断 Agent | 知识匹配 / Intervention | 否（读 evidence） |
| 辅导 Agent | Tutoring / Socratic | 否（`llm_inference`） |
| 组卷/推题 Agent | NextPractice / 薄弱布置 / T16 | 否 |
| 教师建议 Agent | Advisory + 关注队列 + Tips | 否 |

2. **是否上多进程 / ADK 运行时**：MVP 为否。同进程服务编排 + UI / 文档命名即可。禁止引入新 Agent 框架依赖（YAGNI）。

3. **透明度页展示内容**：五 Agent 卡片（输入 / 输出 / 禁止事项）+ 流水线（作答 → 评分 → 诊断 → 练习态辅导 → 推题）+ 铁律徽章「评分路径零 LLM」。

4. **Demo 脚本**：更新 `DEMO-oral-10min` 或 cue-card 增加 30s「多 Agent 但不碰分」口播。可选：工作台 PipelineBar 步骤名与 Agent 名对齐（文案层）。

### API / 数据草案

- **静态目录**：`shared/agentCatalog.ts` 或 `server/data/agentCatalog.ts`，导出类型化静态数组。
- **只读 API**：`GET /api/transparency/agents` — 返回静态描述 JSON（便于演示页与外部评审）。不新增会改变评分行为的 endpoint。

```typescript
interface AgentCatalogEntry {
  id: string                    // 'scoring' | 'diagnosis' | 'tutoring' | 'assignment' | 'advisory'
  name: string                  // 对外名称
  internalModule: string        // 对内模块路径描述
  touchesScore: boolean         // 是否碰 score
  llmAllowed: boolean           // 是否允许使用 LLM
  inputs: string[]              // 输入描述
  outputs: string[]             // 输出描述
  prohibitions: string[]        // 禁止事项
}
```

### 模块变更

- 新增 `shared/agentCatalog.ts`：静态目录 + 类型定义。
- 前端「项目透明度」页消费该目录，渲染五 Agent 卡片。
- `tests/architecture.test.ts` 增加契约测试：catalog 声明的评分模块不得 import tutoring LLM 写回路径。
- `docs/PROJECT_BRIEF.md` / `PITCH_DECK_OUTLINE.md` 各加一小节「多智能体分工」。
- 实现报告附口播 5 句金句。

## Testing Decisions

### 测试缝隙

- **主缝隙**：`tests/architecture.test.ts`（扩展现有架构守护测试）— 契约测试验证 catalog 声明与代码隔离一致。
- **次缝隙**：`tests/serverApi.test.ts` 或新 `tests/agentCatalog.test.ts` — 验证 `GET /api/transparency/agents` 返回完整目录。

### 测试内容

1. catalog 字段完整性：每条 entry 必须有 id / name / touchesScore / llmAllowed / inputs / outputs / prohibitions。
2. 契约测试：`touchesScore === true` 的条目 `llmAllowed` 必须为 `false`。
3. API 返回 5 个 Agent 条目，且评分 Agent 的 `touchesScore` 为 true、`llmAllowed` 为 false。
4. 透明度页渲染：前端组件能消费 catalog 并展示卡片（组件级测试）。

### 好测试的标准

只测外部行为（catalog 数据形状 + API 响应 + 契约约束），不测实现细节（不测渲染 DOM 结构）。参考现有 `tests/architecture.test.ts` 的 file-read + regex 模式。

## Out of Scope

- 新 Agent 框架依赖 / 新消息总线
- 把辅导 Agent 接到改分路径
- 可视化拖拽 Agent 编排器
- 多租户计费
- 多进程 / 多容器编排

## Further Notes

### 验收（Done 定义）

1. 透明度页可见 5 Agent 及「评分不用 LLM」徽章。
2. 契约测试通过：评分 Agent 与 LLM 写回隔离。
3. 口播 / cue-card 已更新，含 30s 多 Agent 段落。
4. `GET /api/transparency/agents` 返回完整目录 JSON。
5. 实现报告 `docs/product-roadmap/reports/T17-implementation-report.md`。

### 关联旧票

- [[T05-ai-tutoring]]：辅导 Agent 物理隔离打分路径
- [[T06-adaptive-loop]]：推题 Agent 基于硬事实
- ADR-0001 `docs/adr/0001-evidence-first-scoring.md`：证据铁律
- CONTEXT：EvaluationAgent 五步；AdvisoryLayer 不入正式分
