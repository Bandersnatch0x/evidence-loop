# [wayfinder:ticket] T17 多 Agent 产品叙事包装（路演/透明度）

## Question

Google ADK 黑客松获奖项目普遍以「多智能体分工」叙事取胜。循证环**已有**评分/诊断/辅导/推题/教师建议等服务切分，但对外仍像单体。本票**不重写架构**，把现有能力显式包装为可演示的 Agent 编队，并在透明度页与 Demo 口播中讲清：**只有评分 Agent 碰分数，且它不用 LLM**。

**来源**：国外教育黑客松调研 Wave A-③。

**Blocked by**: 无硬依赖（读现有模块即可）；文案需与 ADR-0001 / COMPLIANCE 一致

---

## 要定什么

1. **Agent 编队定义（产品名，非新进程）**

| Agent 名（对外） | 对内模块 | 是否碰 score |
|------------------|----------|--------------|
| 评分 Agent | RunnerRegistry + Rubric | **是**（确定性） |
| 诊断 Agent | 知识匹配 / Intervention | 否（读 evidence） |
| 辅导 Agent | Tutoring / Socratic | 否（`llm_inference`） |
| 组卷/推题 Agent | NextPractice / 薄弱布置 / T16 | 否 |
| 教师建议 Agent | Advisory + 关注队列 + Tips | 否 |

2. **是否上多进程/ADK 运行时**  
   - **MVP：否**。同进程服务编排 + UI/文档命名即可。  
   - 禁止引入新 Agent 框架依赖（YAGNI）；真要编排中间件另开研究票。

3. **透明度页要展示什么**  
   - 五 Agent 卡片：输入/输出/禁止事项。  
   - 流水线：作答 → 评分 → 诊断 →（练习态）辅导 → 推题。  
   - 铁律徽章：「评分路径零 LLM」。

4. **Demo 脚本**  
   - 更新 `DEMO-oral-10min` 或 cue-card 增加 30s「多 Agent 但不碰分」口播。  
   - 可选：工作台 PipelineBar 步骤名与 Agent 名对齐（文案层）。

5. **API**  
   - 可选只读 `GET /api/transparency/agents` 返回静态描述 JSON（便于演示页与外部评审）。  
   - **不**新增会改变评分行为的 endpoint。

---

## 建议 MVP 形状

### 代码

- `shared/agentCatalog.ts` 或 `server/data/agentCatalog.ts`：静态目录 + 类型。  
- 前端「项目透明度」页消费该目录。  
- `tests/architecture.test.ts` 可增加：catalog 声明的评分模块不得 import tutoring LLM 写回路径（若已有隔离测试则交叉引用即可）。

### 文档

- `docs/PROJECT_BRIEF.md` / `PITCH_DECK_OUTLINE.md` 各加一小节「多智能体分工」。  
- 本票实现报告附口播 5 句金句。

### 测试

- catalog 字段完整（id/name/touchesScore/llmAllowed）。  
- `touchesScore === true` 的条目 `llmAllowed` 必须为 false（契约测试）。

---

## 出界（本票不做）

- Google ADK / AutoGen / 新消息总线  
- 把辅导 Agent 接到改分  
- 可视化拖拽 Agent 编排器  
- 多租户计费  

---

## 验收（Done 定义）

1. 透明度页可见 5 Agent 及「评分不用 LLM」。  
2. 契约测试：评分 Agent 与 LLM 写回隔离。  
3. 口播/cue-card 已更新。  
4. 实现报告 `docs/product-roadmap/reports/T17-implementation-report.md`。

---

## 状态

**OPEN** — 待实现。

## 关联

[[T05-ai-tutoring]] [[T06-adaptive-loop]] ADR-0001 `docs/adr/0001-evidence-first-scoring.md`  
CONTEXT：EvaluationAgent 五步；AdvisoryLayer 不入正式分。
