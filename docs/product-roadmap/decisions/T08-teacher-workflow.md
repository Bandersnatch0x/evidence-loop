# [wayfinder:grilling] T08 教师工作流（建班/导入学生/布置/批改）

## Question
补充刚需2。老师的完整日常。要定：
- 建教学单元（班级×学科，D3）、导入学生名单分配账号
- 布置作业（单题/组卷/按薄弱点）
- **主观题批改界面**：AI 建议展示 + 教师终裁打分（守 AdvisoryLayer 铁律——现在缺这一环）
- 批量操作范围

**Blocked by**: T01, T02, T03

---

## ✅ 已解决（resolution）

**状态**：closed。补充刚需2（主观题批改界面）落地——补上 AdvisoryLayer 铁律缺失的人工终裁环。类型偏 prototype，此处定工作流，实建用 /prototype 打磨。

### 建教学单元 + 导入学生（D3 + T02）
- 老师自助建 **TeachingUnit**（选行政班 + 学科 + 学期）。行政班不存在则先建班。
- **导入学生名单**：粘贴/上传 CSV（姓名+学号）→ 系统批量建 Student User + Enrollment + 生成激活码（T02）。演示喂测试名单（守合规边界）。
- 导出激活码清单给老师线下分发。

### 布置作业（复用 T03 组卷 + T06 推题）
- 三种布置：**手选题** / **按知识点组卷** / **一键按全班薄弱点组卷**（T06）。
- 布置 = 创建一批 assessment 态 Attempt 占位，指定截止时间，绑定 TeachingUnit。

### 主观题批改界面（补充刚需2 — 铁律闭环）
- **这是 AdvisoryLayer 之前缺的人工终裁 UI**。作文/主观题提交后：
  - EssayRunner 产出的**客观 evidence**（字数/结构/语法）已自动入分（~40%，可复现）。
  - **AdvisoryService 的 LLM 建议**（立意/论证）展示在批改界面，标灰色"AI 推断"徽章（ADR-0006）。
  - 老师**读 AI 建议 + 读原文 → 打主观维度终裁分**，写入 `teacher_annotation`（带 teacherId+签名，D4/ADR-0006）。
  - 终裁分才计入 Cohort 指标；`requiresTeacherConfirmation` 门守住"无人不入分"。
- **批改队列**：按 TeachingUnit 聚合待批主观题，支持逐个批改。

### 批量操作范围
- 批量：导入学生、布置作业、发提示、导出成绩。
- **不批量**：主观题终裁打分（每份需人工判断，禁止批量给分——守铁律）。

### 关联
[[T01-product-data-model]] [[T02-auth-system]]（导入/激活）[[T03-question-bank]]（组卷）[[T06-adaptive-loop]]（薄弱点布置）。AdvisoryLayer 终裁对齐 ADR-0006 §3「只看证据层」开关——终裁分可被过滤，证据层与教师判断层可分辨。
