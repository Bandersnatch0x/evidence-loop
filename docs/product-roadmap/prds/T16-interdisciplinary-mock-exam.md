# PRD: T16 跨学科模拟考（Paper 智能组卷）

**状态**: OPEN
**开建顺序**: 3
**来源**: 跨学科模拟考需求

---

## Problem Statement

「跨学科模拟考」能力：教师需要按教学进度与薄弱点生成一套限时 paper，学生测评态打包作答，交卷后获得统一证据报告与 KP 诊断。当前系统有组卷（T03）、薄弱 KP 聚合（T06）和 paper 场次（T07），但缺少"一键月考"的智能组卷向导和跨学科分科报告，无法支撑演示叙事。

## Solution

在教师学情/布置页增加「生成模拟考」向导：教师选教学单元（可跨学科）→ 系统按 cohort 薄弱 KP ∩ taughtKpIds 确定性组卷 → 教师预览调整 → 布置全班 → 学生测评态打包作答（AI 关闭，D1）→ 交卷后看分科+KP 报告。组卷算法确定性优先：薄弱 KP 轮转选题、同 KP 去重、未教不入选。

## User Stories

1. 作为教师，我想选择一个或多个教学单元后自动生成一套建议模拟卷，以便省去逐题挑选的时间。
2. 作为教师，我想在建议卷中看到题目按学科和知识点分布的预览，以便判断覆盖面是否合理。
3. 作为教师，我想在建议卷上删题、换题后发布，以便保留人工把关。
4. 作为教师，我想设置模拟考的时长和题量约束，以便控制考试规模。
5. 作为教师，我想只教一科时退化为单科模拟考（同一 API），以便无需特殊路径。
6. 作为教师，我想确认卷面后一键布置给全班或指定 enrollment，以便快速发布。
7. 作为学生，我想在测评入口看到卷名、时长和学科标签，以便了解考试范围。
8. 作为学生，我想在测评态下打包作答并计时交卷，AI 辅导关闭，以便模拟真实考试。
9. 作为学生，我想交卷后看到分科得分和 KP 诊断报告，以便了解各科薄弱点。
10. 作为学生，我想在报告中看到失败证据 TopN 和「去错题本」入口，以便针对性重练。
11. 作为教师，我想在交卷报告中看到跨学科「共性薄弱」列表，以便布置针对性干预。
12. 作为系统，未教 KP 和 draft 题不得入卷，以便守住 D4 和 D2 约束。
13. 作为系统，交卷报告只聚合 assessment Attempt，以便练习态不污染正式数据。
14. 作为开发者，我想在 CI 中验证组卷过滤和跨单元权限，以便防止越权选题。

## Implementation Decisions

### 要定什么

1. **组卷输入**：必填 `teachingUnitId` 或显式 `subject` 列表（跨学科时同一行政班下多个 TeachingUnit 选题合并）。约束：`taughtKpIds` 并集过滤（D4）；题库仅 `published` + 有权威答案。可选：目标题量、时长分钟、薄弱优先（默认 true）、题型配比。

2. **跨学科边界（MVP）**：支持同一 `classId` 下教师有权限的多个 TeachingUnit 抽题组成一份 paper。不支持跨班、跨校、无权限题库。当前教师只教一科：退化为单科模拟考（同一 API）。

3. **学生作答**：默认 `mode: assessment`，AI 辅导关闭（D1）。计时沿用 T07 paper 打包（截止/交卷）；超时策略与现网一致。每题独立 Attempt，共享 `paperId`。

4. **交卷报告**：客观分汇总 + 分 KP 诊断 + 失败证据 TopN。跨学科按 subject 分节展示，再给「共性薄弱」列表。Advisory 仅 essay 等主观题，仍需教师终裁（T08），不自动进中位分。

5. **一键布置**：教师确认 paper 草稿 → 布置全班/指定 enrollment。系统「建议卷」可预填，教师可删题/换题后发布。

### API / 数据草案

**数据模型**：

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

**API 端点**：

| 方法 | 路径 | 角色 | 说明 |
|------|------|------|------|
| POST | `/api/teacher/mock-exams/suggest` | teacher | body: classId, teachingUnitIds?, count, duration → 建议卷 |
| POST | `/api/teacher/mock-exams` | teacher | 保存 draft / 发布布置 |
| GET | `/api/teacher/mock-exams/:id` | teacher | 卷面 + 覆盖 KP |
| GET | `/api/student/papers/:paperId/report` | student/teacher | 交卷后统一报告 |

**组卷算法（确定性优先）**：

1. 聚合 cohort 薄弱 KP（T06）∩ taughtKpIds。
2. 按 subject 配额轮转选题（避免一科占满）。
3. 同 KP 去重最近 N 天做过（assessment）。
4. 题量不足 → 返回 `warnings[]`，允许短卷发布。

### 模块变更

- 新增 `server/mockExam/` 模块（MockExamService + 组卷算法 + routes），或扩展 `server/adaptive/` 和 `server/teacher/`。
- 复用 T03 组卷、T06 薄弱 KP 聚合、T07 paper 场次、T08 布置。
- 前端教师学情/布置页增加「生成模拟考」向导。
- 前端学生测评入口显示卷名/时长/学科标签。
- 前端报告页：分节得分 + 证据失败列表 + 「去错题本」。

## Testing Decisions

### 测试缝隙

- **主缝隙**：新 `tests/mockExam.test.ts` — HTTP API 级集成测试，覆盖 suggest → adjust → assign → student paper → report 全链路。
- **组卷算法单测**：纯函数测试，固定 cohort 薄弱 KP 夹具 → 验证选题过滤。

### 测试内容

1. 未教 KP 不得入卷（D4 守护）。
2. draft 题 / 无答案题不得入卷（D2 守护）。
3. 跨单元权限：只能含本师 TeachingUnit。
4. 交卷报告只聚合 assessment Attempt（D1 守护）。
5. 单科教师退化为单科模拟考（同一 API 路径）。
6. 题量不足时返回 warnings，允许短卷发布。

### 好测试的标准

只测外部行为（API 响应 + 组卷结果的 KP 覆盖 + 权限边界），不测选题算法内部数据结构。参考现有 `tests/adaptiveLoop.test.ts` 和 `tests/teacherWorkflow.test.ts` 的模式。

## Out of Scope

- AI 当场现造新题填卷（用 T15 入库后再选）
- 自适应逐题难度（CAT）
- 官方中高考真卷版权库
- 家长报告（→ T19）

## Further Notes

### 验收（Done 定义）

1. 教师对 demo 班生成建议卷并布置成功。
2. 学生 assessment 交卷后看到分科+KP 报告。
3. 卷内无 draft/未教 KP。
4. 集成测试覆盖组卷过滤与权限。
5. 实现报告 `docs/product-roadmap/reports/T16-implementation-report.md`。

### 关联旧票

- [[T03-question-bank]]：组卷、选题
- [[T06-adaptive-loop]]：薄弱 KP 聚合
- [[T07-student-experience]]：paper 场次、打包作答
- [[T08-teacher-workflow]]：布置、Assignment 模型
- [[T15-material-to-draft-questions]]：T15 入库的题可被 T16 选用
- CONTEXT：D1 测评态；D4 已教进度
