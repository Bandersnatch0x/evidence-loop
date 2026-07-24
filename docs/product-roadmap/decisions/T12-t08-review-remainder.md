# [wayfinder:ticket] T12 T08 评审剩余项

## Question
T11 做完 P4/S2/S1 后，T08 评审清单仍剩可落地项。本票收敛剩余**可 Demo 价值**项，不扩到导出/消息/签名密码学。

**Blocked by**: T08, T11

**范围**：
| ID | 项 |
|----|-----|
| **P1** | 布置支持 `dueAt` 截止时间 |
| **P2** | 建教学单元时行政班不存在则先建班 |
| **P3** | 名单支持上传 CSV（前端读文件 → 既有导入 API） |
| **S3** | Gradebook 主观满分可编辑，不写死 10 |

**出界**：P5 签名、P6 发提示/导出成绩、S4–S6 性能/Demo 耦合。

---

## ✅ 已解决（resolution）

**状态**：closed。见 `docs/product-roadmap/reports/T12-implementation-report.md`。

| ID | 落地 |
|----|------|
| P1 | `dueAt` 入 CreateAssignment + Attempt；UI datetime-local |
| P2 | `TeachingUnitService.ensureClass` + `OrgReader.saveClass` |
| P3 | StudentImport 文件 input 读 CSV/TSV |
| S3 | Gradebook「满分」可编辑，默认 10 |

## 关联
[[T08-teacher-workflow]] [[T11-t08-review-sweep]]
