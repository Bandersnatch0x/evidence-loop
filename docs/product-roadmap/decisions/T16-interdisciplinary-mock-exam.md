# [wayfinder:ticket] T16 跨学科模拟考（Paper 智能组卷）

## Question

对齐 Edu.AI 黑客松能力「跨学科模拟考」：教师（或系统建议）按教学进度与薄弱点生成一套限时 `paper`，学生测评态打包作答，交卷后统一证据报告与 KP 诊断。强化「一键月考」演示叙事，复用 T03 组卷 + T06 薄弱点 + T07 paper 场次。

**来源**：国外教育黑客松调研 Wave A-②。

**Blocked by**: T03（组卷）、T06（薄弱 KP 聚合）、T07（paper 场次）、T08（布置）

---

## 要定什么

1. **组卷输入**  
   - 必填：`teachingUnitId` 或显式 `subject` 列表（跨学科时多 TeachingUnit 或同班多科——MVP 先支持**同一行政班下多个 TeachingUnit** 选题合并）。  
   - 约束：`taughtKpIds` 并集过滤（D4）；题库仅 `published` + 有权威答案。  
   - 可选：目标题量、时长分钟、薄弱优先（默认 true）、题型配比。

2. **跨学科边界（MVP）**  
   - **支持**：同一 `classId` 下教师有权限的多个 TeachingUnit 抽题组成一份 paper。  
   - **不支持**：跨班、跨校、无权限题库。  
   - 若当前教师只教一科：退化为单科模拟考（仍走同一 API）。

3. **学生作答**  
   - 默认 `mode: assessment`，AI 辅导关闭（D1）。  
   - 计时：沿用 T07 paper 打包（截止/交卷）；超时策略与现网一致。  
   - 每题独立 Attempt，共享 `paperId`。

4. **交卷报告**  
   - 客观分汇总 + 分 KP 诊断 + 失败证据 TopN。  
   - 跨学科：按 subject 分节展示，再给「共性薄弱」列表。  
   - Advisory 仅 essay 等主观题，仍需教师终裁（T08），不自动进中位分。

5. **一键布置**  
   - 教师确认 paper 草稿 → 布置全班/指定 enrollment。  
   - 系统「建议卷」可预填，教师可删题/换题后发布。

---

## 建议 MVP 形状

### 数据

```
MockExamPlan {
  id, creatorId, classId,
  teachingUnitIds: string[],
  title, durationMinutes,
  questionIds: string[],      // 有序
  kpCoverage: { kpId, subject }[],
  status: 'draft' | 'assigned' | 'archived',
  createdAt
}
// 布置后复用现有 Assignment/Paper 模型（T07/T08），planId 可选外键
```

### API（草案）

| 方法 | 路径 | 角色 | 说明 |
|------|------|------|------|
| POST | `/api/teacher/mock-exams/suggest` | teacher | body: classId, teachingUnitIds?, count, duration → 建议卷 |
| POST | `/api/teacher/mock-exams` | teacher | 保存 draft / 发布布置 |
| GET | `/api/teacher/mock-exams/:id` | teacher | 卷面 + 覆盖 KP |
| GET | `/api/student/papers/:paperId/report` | student/teacher | 交卷后统一报告 |

### 组卷算法（确定性优先）

1. 聚合 cohort 薄弱 KP（T06）∩ taughtKpIds。  
2. 按 subject 配额轮转选题（避免一科占满）。  
3. 同 KP 去重最近 N 天做过（assessment）。  
4. 题量不足 → 返回 `warnings[]`，允许短卷发布。

### UI

- 教师学情/布置：**「生成模拟考」** 向导（选单元 → 预览题单 → 调整 → 布置）。  
- 学生：测评入口显示卷名、时长、学科标签。  
- 报告页：分节得分 + 证据失败列表 + 「去错题本」。

### 测试

- 未教 KP 不得入卷。  
- draft 题 / 无答案题不得入卷。  
- 跨单元权限：只能含本师 TeachingUnit。  
- 交卷报告只聚合 assessment Attempt。

---

## 出界（本票不做）

- AI 当场现造新题填卷（用 T15 入库后再选）  
- 自适应逐题难度（CAT）  
- 官方中高考真卷版权库  
- 家长报告（→ T19）  

---

## 验收（Done 定义）

1. 教师对 demo 班生成建议卷并布置成功。  
2. 学生 assessment 交卷后看到分科+KP 报告。  
3. 卷内无 draft/未教 KP。  
4. 集成测试覆盖组卷过滤与权限。  
5. 实现报告 `docs/product-roadmap/reports/T16-implementation-report.md`。

---

## 状态

**OPEN** — 待实现。

## 关联

[[T03-question-bank]] [[T06-adaptive-loop]] [[T07-student-experience]] [[T08-teacher-workflow]] [[T15-material-to-draft-questions]]  
CONTEXT：D1 测评态；D4 已教进度。
