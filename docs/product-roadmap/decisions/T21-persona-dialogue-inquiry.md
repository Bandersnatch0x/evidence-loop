# [wayfinder:ticket] T21 人物对话探究（练习态，不入分）

## Question

对齐 Dialogues Through Time / 历史人物对话类黑客松项目：政史地等学科提供 **练习态** 人物/立场对话探究，提升沉浸与表达。对话产出只进 `LearnerNarrative`（`llm_inference`），**永不**进 score/evidence/正式 MasteryProfile。正式评价仍走论述题 + EssayRunner + 教师终裁。

**来源**：国外教育黑客松调研 Wave C-⑦。

**Blocked by**: T05（辅导会话骨架）、T01（narrative 隔离）、多模态可选

---

## 要定什么

1. **入口**  
   - 知识点或题目上的「探究对话」按钮；仅 `mode` 暗示为 practice。  
   - 需教师在题目/演示上挂载 `personaId`（预置 3–5 个 demo 人物：历史人物或观点角色，**非**真人师生仿冒）。

2. **会话边界**  
   - 系统 prompt：角色只据提供的「史料/教材摘录」回答；不知则说不知。  
   - 防套话：对齐 T05 苏格拉底（连续低努力索取提示则拒绝剧透标准答案）。  
   - 轮次上限 8–12；可「结束探究 → 去做论述题」。

3. **与评分隔离**  
   - 类型层：DialogueTurn 禁止 evidence 标签。  
   - 架构测试：dialogue 路由不 import AttemptStore 写 score。  
   - UI 顶栏常驻：「练习探究 · 不计入测评」。

4. **内容来源**  
   - MVP：预置 persona + 挂载文本摘录（可来自 T09 solution 或教学演示文字）。  
   - 不做开放互联网检索（幻觉与合规）。

---

## 建议 MVP 形状

### 数据

```
Persona {
  id, name, subject, eraOrContext, sourceExcerpts: string[],
  disclaimer: string
}
DialogueSession {
  id, studentId, personaId, kpId?, questionId?,
  turns: { role, text, at }[],
  status: 'open' | 'closed'
}
```

### API

| 方法 | 路径 | 角色 | 说明 |
|------|------|------|------|
| GET | `/api/personas` | student/teacher | 预置列表 |
| POST | `/api/practice/dialogue` | student | 开会话 |
| POST | `/api/practice/dialogue/:id/turn` | student | 多轮 |
| POST | `/api/practice/dialogue/:id/close` | student | 结束 |

### 测试

- 关闭后无 Attempt 产生（除非用户另开测评题）。  
- 架构：不写 MasteryProfile。  
- 无 LLM → 模板角色回复可演示。

---

## 出界（本票不做）

- 对话自动评分 / 口试分  
- 模仿在世教师声线  
- 开放 Web RAG  
- 测评态强制对话  

---

## 验收（Done 定义）

1. Demo 人物可多轮对话并结束。  
2. 全程无 score 写入；UI 标明练习。  
3. 实现报告 `docs/product-roadmap/reports/T21-implementation-report.md`。

---

## 状态

**OPEN** — Wave C，非阻塞主路径。

## 关联

[[T05-ai-tutoring]] [[T09-standard-solution]] ADR-0006 provenance  
CONTEXT：LearnerNarrative 与 MasteryProfile 不可交叉写入。
