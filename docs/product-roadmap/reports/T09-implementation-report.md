# T09 题目标准解析 — 实现报告

## 状态结论

| 维度 | 状态 | 说明 |
|------|------|------|
| `Question.solution` 可选模型 | ✅ | `StandardSolution` + `solution_json` |
| 校验/序列化 | ✅ | `solution.ts` |
| AI 辅导分级（有解析 RAG / 无解析免责） | ✅ | `buildTutoringContext` |
| 前端免责徽章 | ✅ | `AiInferenceBadge` |
| T05 generators 挂 RAG | ✅ | Explain / Socratic / Dialogue |
| 老师「采纳 AI 讲解为标准解析」 | ✅ | `adoptSolution` + `POST .../adopt-solution` + 编辑器 UI |
| 实现报告 | ✅ | 本文件 |

**一句话**：T09 **内容质量地基完整**——有解析走 RAG 复述，无解析免责生成，老师可一键采纳 AI 讲解为人工权威解析。

## 完成内容

1. **存取与信任分层**（既有）
   - 有 solution → `rag_restate`，无免责
   - 无 solution → `llm_generate` + 免责徽章

2. **采纳（本轮补尾巴）**
   - `QuestionBankService.adoptSolution(id, authorId, draft)`
   - 强制 `source: 'authored'` + 会话 `authorId`（D2 人工权威）
   - 路由：`POST /api/questions/:id/adopt-solution`
   - UI：`QuestionEditor` 编辑模式「采纳 AI 讲解为标准解析」
   - 采纳后 tutoring mode 翻转为 `rag_restate`
   - **不改分、不写 evidence**

3. **测试**
   - `tests/questionSolution.test.ts`：adopt + 跨老师拒绝
   - `tests/QuestionBankPanel.test.tsx`：UI 采纳回调
   - `tests/routeWiring.test.ts`：HTTP 201 create → 200 adopt

## 仍建设期（非阻塞）
- 作文 `rubricGuide` 独立字段（现可写在 solution.content）
- T04 导入校对 UI 提示「补解析」（非强制）
