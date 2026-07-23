# [wayfinder:grilling] T03 题库系统（导入/结构化/组卷）

## Question
老师把题弄进系统。要定：
- 手工录入界面：各题型（选择/填空/数值/表达式/化学/作文/代码）的录入表单
- 结构化模型：题干/选项/答案/知识点标注/难度/标准解析（对齐 T01 Question）
- 组卷：单题布置 vs 按知识点/薄弱点智能组卷
- 题库归属：老师私有（共享出界）
- 与现有硬编码 assignments 的关系（迁移/共存？）

**Blocked by**: T01

---

## 状态：已关闭

## Resolution（裁决）

**手工录入界面**：每题型一个录入表单（复用 T30 前端已建的 7 种题型提交表单的**镜像**——学生做题填答案，老师录入填「题干+正确答案+知识点+难度+标准解析」）。共用 `QuestionEditor` 外壳 + 按 `questionType` 分发到各题型字段编辑器。

**结构化模型**（对齐 T01 的 Question 聚合）：
```
Question {
  id, questionBankId, subject, questionType
  stem: string                    // 题干（支持 LaTeX/KaTeX）
  payload: RunnerSpec             // 各题型的答案规格（复用现有 7 种 RunnerSpec）
  kpIds: string[]                 // 知识点标注（挂 121 DAG）
  difficulty: 1..5
  standardSolution?: string       // 标准解析（T09 定，RAG 喂 AI 辅导）
  source: 'test_case' | 'authored_key'   // D2 可信度来源
  authorId: string                // 老师私有归属
  createdAt, termId?
}
```

**组卷**：**两种都做,分阶段**：
- MVP：**单题布置** + **手动组卷**（老师勾选题目成一套）
- 进阶：**按薄弱点智能组卷**——复用 T06 自动闭环引擎（FSRS due + 依赖链薄弱点 + 已教进度过滤），老师"一键按全班薄弱点组卷"。智能组卷是 T06 闭环的教师侧出口，不重复造。

**题库归属**：**老师私有**（共享出界，守 Out of scope）。`Question.authorId` + `QuestionBank` 按老师隔离。跨老师复用留到规模化。

**与现有硬编码 assignments 的关系（expand-contract）**：
- 现有 14 个硬编码 assignment（各学科标杆题）→ 作为 **seed 数据**灌入 questions 表（归属一个"系统内置"虚拟作者），演示即用
- `AssignmentRegistry` 接口保留，实现从"硬编码 Map"演进为"查 questions 表"
- RunnerRegistry 按 questionType 路由的机制**完全不变**（T024 的抽象正确，题库只是换了数据来源）

**守铁律**：录入题的答案标 `source:'authored_key'`（老师填的，可追溯可推翻，≠机器验证的 test_case）——直接落地 T01/D2 的证据分级。老师改答案 = 翻转 authored_key + 重算受影响 Attempt。

**graduate 的 fog**：题目版本管理（老师改题后历史 Attempt 怎么办）→ Not yet specified；题目质量审核 → 出界（老师私有自负责）。
