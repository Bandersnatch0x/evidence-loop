# T12 T08 评审剩余项 — 实现报告

## 范围

P1 截止时间 / P2 先建班 / P3 CSV 上传 / S3 主观满分可编辑。

## 完成

| ID | 改动 |
|----|------|
| **P1** | `CreateAssignmentInput.dueAt` → Attempt.dueAt；AssignmentComposer `datetime-local` |
| **P2** | `SqliteOrgReader`/`InMemoryOrgReader.saveClass`；建单元时 `ensureClass` |
| **P3** | `StudentImport` 上传 CSV/TSV 填入名单框；跳过表头行 |
| **S3** | Gradebook 满分输入，默认 10，提交用教师值 |

## 仍出界

- P5 签名、P6 发提示/导出成绩
- S4–S6 Demo 性能/耦合

## 验证

| 命令 | 结果 |
|------|------|
| vitest teacherWorkflow + Gradebook + adaptive | **31/31** |
| tsc --noEmit | **EXIT=0** |
