# [wayfinder:ticket] T14 教师批量发提示（站内消息通道）

## Question

T08 决策写明批量操作含「发提示」，但实现时**故意出界**——缺消息通道，不能塞进批改/布置服务而不污染评分铁律。T11–T13 评审扫尾已收口可落地项；本票**单独开盘**建「教师 → 教学单元内学生」的提示通道。

**来源**：T08 批量范围（导入/布置/发提示/导出）；T13 明确「批量发提示仍出界」。

**Blocked by**: T02（会话/角色）、T08（TeachingUnit + Enrollment 范围）

---

## 要定什么

1. **消息是什么**  
   - 教师手写短提示（非 AI 自动改分、非系统布置作业）。  
   - 可选挂载：薄弱 KP 标签、关联 paperId / questionId（只作链接，不写 score）。

2. **投递范围**  
   - 默认：本 TeachingUnit 已 enrollment 全班。  
   - 可选：显式 `studentIds ⊆ enrollment`（复用 T11/S2 门）。  
   - **禁止**：跨教学单元、跨班广播。

3. **学生如何收到**  
   - MVP：学生工作台「老师提示」列表（未读角标）。  
   - 不接短信/邮件/推送（T10 + Demo 边界）。

4. **与铁律的边界**  
   - 消息**永不**写 `result.score` / evidence / MasteryProfile。  
   - 不替代 Intervention（系统诊断任务）；可链接到「去练习」但不自动开测评。  
   - provenance 若展示：`teacher_annotation` 文案层，非评分层。

5. **是否批量**  
   - **允许批量投递**（一人一信封 fan-out），与「主观题禁止批量给分」不冲突——这是消息，不是分。

---

## 建议 MVP 形状（开建时可微调）

### 数据

```
TeacherTip {
  id, teachingUnitId, teacherId,
  body: string,           // 纯文本, max ~2000
  createdAt,
  kpIds?: string[],
  paperId?: string,
  questionId?: string
}
TeacherTipDelivery {
  tipId, studentId,
  readAt?: string         // null = 未读
}
```

存储：product SQLite 新表（或 JSON store 若想更薄），接口隔离便于换库。

### API（草案）

| 方法 | 路径 | 角色 | 说明 |
|------|------|------|------|
| POST | `/api/teacher/tips` | teacher | body: teachingUnitId, body, studentIds?, kpIds? |
| GET | `/api/teacher/tips?teachingUnitId=` | teacher | 本单元已发列表 + 已读计数 |
| GET | `/api/student/tips` | student | 我的收件箱（未读优先） |
| POST | `/api/student/tips/:id/read` | student | 标记已读 |

### UI

- 教师工作台新标签或布置页旁：**「发提示」**（选全班/多选学生 + 文本）。  
- 学生「我的练习」顶栏：**老师提示**（列表 + 未读）。

### 测试

- 归属：非本单元教师 403；studentIds 不在 enrollment → 422。  
- 铁律：发 tip 后 Attempt/score 字节级不变。  
- 学生只能读自己的 delivery。

---

## 出界（本票不做）

- 短信 / 邮件 / App 推送 / 微信  
- 家长端  
- AI 自动生成班级群发文案（可后挂 T05，非本票）  
- 聊天室 / 多轮对话  
- 把 tip 写进正式成绩或 Cohort 中位分  

---

## 验收（Done 定义）

1. 教师对 `tu-demo` 全班或指定学员发一条提示，API 201。  
2. 学生侧可见未读 → 点读后 `readAt` 有值。  
3. 跨单元 / 未 enrollment 目标被拒绝。  
4. 架构或集成测试：发 tip 不改任何 `result.score`。  
5. 实现报告 `docs/product-roadmap/reports/T14-implementation-report.md`。

---

## 状态

**IMPLEMENTED** — 见 docs/product-roadmap/reports/T14-implementation-report.md。

## 关联

[[T08-teacher-workflow]] [[T02-auth-system]] [[T11-t08-review-sweep]] [[T13-t08-review-closeout]]  
CONTEXT：教师视图只提供干预建议，不自动写正式成绩。
