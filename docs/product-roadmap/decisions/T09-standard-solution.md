# [wayfinder:grilling] T09 题目标准解析（内容质量地基）

## Question
补充刚需3。决定 AI 辅导是"唯一内容源"还是"补充"。要定：
- 导入题是否必须带标准解析，还是可选
- 纯 AI 生成讲解 vs 老师提供标准解析 vs 两者结合的取舍
- 标准解析在数据模型中的位置（Question.solution）
- 对 T05 AI 辅导的影响（有标准解析时 AI 是复述还是补充）

**Blocked by**: T01, T03

## 状态：已关闭 ✅

## 裁决（决策）

**核心：标准解析是 `Question` 的可选字段，但导入题"强烈建议"填；AI 辅导 = 有解析则复述+展开，无解析则生成+标免责。分级内容质量。**

### 1. 标准解析可选，但按题型分级要求
- `Question.solution?: StandardSolution`（可选字段，对齐 T01 Question 聚合）
- **客观题**（选择/填空/数值）：解析可选——答案本身即"证据"，解析只增强 AI 辅导质量
- **表达式/化学**：解析可选但强烈建议——CAS/配平能验证对错，但"为什么"需要解析
- **作文/主观题**：无"标准解析"概念，代之以 `rubricGuide`（评分要点），供教师批改 + AI 建议参考
- **代码题**：已有 test suite + 参考实现，`solution` 即参考解

### 2. StandardSolution 结构
```typescript
interface StandardSolution {
  content: string          // LaTeX/富文本，题目的标准解法
  keyPoints?: string[]     // 解题关键步骤/得分点
  authorId: string         // 谁写的（老师）
  source: 'authored'       // 人工权威（对齐 D2 authored_key 精神）
}
```

### 3. AI 辅导对解析的依赖（对齐 TR2 降幻觉）
- **有 `solution`**：AI 辅导 = RAG 挂标准解析，"不让 LLM 自己算"，只**复述+展开+换角度讲**。幻觉风险最低（TR2 核心降幻觉手段）
- **无 `solution`**：AI 辅导 = 自主生成讲解，但**必标 `provenance.kind='llm_inference'` + "AI 生成，可能有误"免责徽章**（灰色，对齐 ADR-0006 UI 三色）
- 这就是 fog 里"AI 讲解可信度"的裁决：**有解析=复述可信，无解析=生成免责**，用有无 solution 分级可信度

### 4. 内容质量地基结论
标准解析**不是硬门槛**（否则老师导入负担过重，冷启动死）。但产品明示："带标准解析的题，AI 辅导质量显著更高、幻觉更低"——用**质量差异**而非**强制**引导老师填。导入校对闸门（T04）里可提示补充。

**一句话**：solution 可选、按题型分级建议，有则 AI 复述（可信）无则 AI 生成（免责）——用有无解析给 AI 辅导内容分级可信度，同时不给老师设硬门槛。
