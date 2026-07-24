# [wayfinder:ticket] T13 T08 评审收口

## Question
T11/T12 之后评审清单仍剩：P5 签名、P6 导出、S6 列表装配静默。本票收口；**不**做「批量发提示」（需消息通道，出界）。

**Blocked by**: T08, T11, T12

| ID | 项 |
|----|-----|
| **P5** | 终裁写 `signature`（HMAC-SHA256，payload = attemptId+teacherId+score+max+note+at） |
| **P6** | Gradebook 导出成绩 CSV；名单导入结果导出激活码 CSV |
| **S6** | `listForTeacher` 在 org 无 list 能力时抛错（不再静默 `[]`） |

**出界**：批量发提示/站内消息 → 已 graduate 为 [[T14-batch-teacher-tips]]（open）。

## ✅ 已解决（resolution）

**状态**：closed。见 `docs/product-roadmap/reports/T13-implementation-report.md`。

| ID | 落地 |
|----|------|
| P5 | `TeacherAnnotation.signature` HMAC-SHA256；`verifyTeacherAnnotation` |
| P6 | Gradebook / 激活码清单「导出 CSV」 |
| S6 | `listForTeacher` 缺 helper 时抛 `TeachingUnitError` |

## 关联
[[T08-teacher-workflow]] [[T11-t08-review-sweep]] [[T12-t08-review-remainder]]
