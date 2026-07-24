# T11 T08 评审扫尾 — 实现报告

## 范围

仅 P4 + S2 + S1（见 `decisions/T11-t08-review-sweep.md`）。

## 完成内容

| ID | 改动 |
|----|------|
| **P4** | `server/data/cohort.ts`：`isAwaitingTeacherAdjudication` / `formalScoreForCohort`；正式中位分排除待终裁；`pendingAdjudication` 计数；`GET /api/cohort` 传 `listResults()`；CohortView 展示「待教师终裁」 |
| **S2** | `AssignmentService.resolveStudents` + `AssignByWeaknessService.resolveStudents`：显式 `studentIds` 必须在 class×term enrollment 内 |
| **S1** | `QuestionBankService.assembleManual` 改用 `getAssignable`（预置库可用） |

## 铁律

- `result.score` 仍只含客观分；终裁写 `teacherAnnotation`，不折叠
- 正式 Cohort 中位分：客观题直接入；主观题**有** `teacherAnnotation` 后才用其 `score`（客观分）入聚合；待终裁不入

## 测试

- `tests/cohortTeacherGate.test.ts` — P4 门
- `tests/teacherWorkflow.test.ts` — S2 not enrolled
- `tests/questionBank.test.ts` — S1 seed assembleManual

## 验证

| 命令 | 结果 |
|------|------|
| vitest (cohort + teacher + questionBank + App + adaptive) | **68/68** |
| `tsc --noEmit` | **EXIT=0** |
