# T13 T08 评审收口 — 实现报告

## 范围

P5 签名 / P6 CSV 导出 / S6 list 装配失败可见。批量发提示仍出界。

## 完成

| ID | 改动 |
|----|------|
| **P5** | `TeacherAnnotation` 类型 + `signature`；`teacherAnnotationSignature.ts`；grade 时 HMAC |
| **P6** | `downloadCsv`；Gradebook 导出成绩；StudentImport 导出激活码 |
| **S6** | `listForTeacher` 无 `listTeachingUnitsByTeacher` 时抛错 |

## 验证

| 命令 | 期望 |
|------|------|
| vitest teacherWorkflow + Gradebook | green |
| tsc --noEmit | EXIT=0 |
