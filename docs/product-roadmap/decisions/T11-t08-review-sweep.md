# [wayfinder:ticket] T11 T08 评审扫尾

## Question
T08 实现评审（Standards + Spec）留下的高优先级尾巴，单开一票收敛，不扩范围。

**Blocked by**: T08

**范围（仅三项）**：
| ID | 项 | 来源 |
|----|----|------|
| **P4** | Cohort 消费 `teacherAnnotation`：终裁后才入正式学情指标 | Spec / 决策 L32 |
| **S2** | 布置时校验 `studentIds ⊆ enrollment` | Standards |
| **S1** | `assembleManual` 与 handpick/assemble_by_kp 对齐，认预置库 | Standards |

**出界（本票不做）**：截止时间 P1、行政班创建 P2、CSV 上传 P3、签名 P5、导出/发提示 P6、UI 满分写死 10 (S3)。

---

## ✅ 已解决（resolution）

**状态**：closed。三项均落地，见实现报告 `docs/product-roadmap/reports/T11-implementation-report.md`。

| ID | 落地 |
|----|------|
| P4 | `formalScoreForCohort` / `isAwaitingTeacherAdjudication`；`CohortSnapshot.pendingAdjudication`；`/api/cohort` 传 `listResults()` |
| S2 | `AssignmentService` + `AssignByWeaknessService` 显式 studentIds 必须 enrollment |
| S1 | `assembleManual` → `getAssignable` |

## 关联
[[T08-teacher-workflow]] [[T03-question-bank]] ADR-0006 §3
