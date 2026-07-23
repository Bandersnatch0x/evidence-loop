# [wayfinder:grilling] T06 学情自动闭环（推题引擎通电）

## Question
学情→薄弱点→自动组下一批题。把已有 FSRS+依赖链诊断从孤立 API 接成产品。D4 已裁决：只在已教进度内判薄弱，未教不报警。要定：
- 学生"今天该练的"如何生成（FSRS due + 依赖链薄弱点 + 已教进度过滤）
- 老师"一键按薄弱点给全班布置巩固题"的流程
- 练习态证据如何喂回 FSRS（D1：不入测评分但喂复习调度）
- 推题与题库的耦合（推出来的题从题库选）

**Blocked by**: T01, T03

---

## ✅ 已解决（resolution）

**状态**：closed。把已有 FSRS + 依赖链诊断从孤立 API 接成产品闭环。基于 D1/D4 + 现有 `MasteryService`/`ReviewScheduler`/`InterventionService`。

### 学生"今天该练的"生成算法（三源合流）
按优先级合并成一个待练队列：
1. **FSRS due**（`ReviewScheduler.listDue`）——到期该复习的知识点卡片，最高优先。
2. **依赖链薄弱点**（`InterventionService.suggestNextIntervention`）——沿前置 DAG 找到的"该先补的前置知识点"。
3. **已教进度过滤**（D4）——只在 `TeachingUnit.taughtKpIds` 范围内取，未教 KP 不进队列（未教薄弱是正常，不报警不推题）。
- 输出：`GET /api/today?studentId` → 有序 kp 列表，每个 kp 从题库（T03）选题填充。

### 老师"一键按薄弱点布置"
- 教师在班级学情矩阵（T08）选中薄弱 kp（或"全班共性薄弱"聚合）→ 一键从题库按 kp 组巩固题 → 布置给全班/指定学生。
- 组题走 T03 的按知识点组卷能力，题目来源限题库。

### 练习态证据喂回（D1 关键分流）
- 练习态 Attempt 的证据**喂 FSRS**（`applyFromEvaluation` 更新 ReviewCard 的 due/stability）——练习也是复习信号。
- 但**不写正式 MasteryProfile**（D1：practice 证据字节级不进测评掌握度）。
- 测评态 Attempt 两者都喂（既更新 FSRS 也更新正式掌握度）。
- 分流在派生读模型投影器里按 `mode` 判别（T01 已裁决）。

### 推题与题库耦合
- 推题引擎只产出"该练哪些 kp + 优先级"，**具体选哪道题委托题库**（T03 按 kp 查询 + 难度/避免最近做过）。
- 闭环不持有题目内容，只持 kp 决策——保持 T01 聚合根边界。

### 关联
[[T01-product-data-model]] [[T03-question-bank]] [[T08-teacher-workflow]]，落实 D1/D4。现有 `server/mastery/` `server/review/` 零重写，只加 `/api/today` 编排端点 + 投影器 mode 分流。
