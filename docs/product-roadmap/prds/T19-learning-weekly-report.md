# PRD: T19 学情周报 / 家长可读导出

**状态**: OPEN
**开建顺序**: 5（可与 T20 并行）
**来源**: PRODUCT-MAP fog「家长报告导出」

---

## Problem Statement

PRODUCT-MAP fog「家长报告导出」与常见的「周报/学情 PDF」导出诉求对齐：教师需要按学期+教学单元切片导出一周学情——完成率、测评分趋势、薄弱 KP、错题 Top、下周计划摘要。当前系统有所有底层数据（Attempt、MasteryProfile、MistakeBook、T14 tips），但缺少一个聚合导出层，且必须分层标注**证据 vs AI 建议**，默认不含可识别隐私超标字段。

## Solution

提供教师可生成的「可转发报告」和学生可看的自己的摘要。按固定章节顺序聚合一周数据（完成与时长 / 测评得分趋势 / 薄弱知识点 / 错题 Top / 练习活动量 / 下周建议 / 教师提示摘录），每章标注证据层或 AI 文案层。MVP-0 输出 JSON + 打印友好 HTML 页（浏览器另存 PDF）。隐私默认展示学号/化名，手机邮箱不进报告，summary 字段过 PIIDetector。

## User Stories

1. 作为教师，我想为一个学生或整个教学单元生成一周学情周报，以便向家长或教务汇报。
2. 作为教师，我想在周报中看到完成率、测评分趋势和薄弱 KP，以便了解学生学习状况。
3. 作为教师，我想在周报中看到错题 Top3–5，以便针对性布置干预。
4. 作为教师，我想在周报中看到下周计划摘要（来自 T18），以便衔接后续教学。
5. 作为教师，我想在周报告中看到我发的教师提示摘录，以便完整呈现干预记录。
6. 作为教师，我想用打印友好 HTML 页直接另存 PDF，以便无需额外工具。
7. 作为学生，我想在侧栏看到自己的周报摘要，以便自我回顾。
8. 作为学生，我不能查看其他同学的周报，以便保护隐私。
9. 作为教师，我只能查看本 TeachingUnit enrollment 学生的报告，以便权限隔离。
10. 作为系统，报告中 practice 分不标为正式掌握，以便守住 D1。
11. 作为系统，无 assessment 数据时趋势为空态文案而非 500 错误，以便优雅降级。
12. 作为系统，summary 字段过 PIIDetector，以便防止隐私超标字段入库。
13. 作为系统，导出操作记录审计日志（谁导出了谁的报告），以便可追溯。

## Implementation Decisions

### 要定什么

1. **受众与权限**：MVP 为教师生成「可转发的报告」；学生可看自己的摘要。不做家长独立账号/登录。教师仅本 TeachingUnit enrollment。

2. **时间窗**：默认最近 7×24h 或「本自然周」；参数 `from`/`to` ISO。切片：`termId` + `teachingUnitId`。

3. **报告章节（固定顺序）**：

| 章节 | 数据源 | 层 |
|------|--------|-----|
| 完成与时长 | Attempt 计数 | evidence |
| 测评得分趋势 | assessment scores | evidence |
| 薄弱知识点 | Mastery + Intervention | evidence |
| 错题 Top3–5 | MistakeBook | evidence |
| 练习活动量 | practice attempts | evidence（标注不入正式掌握） |
| 下周建议 | T18 plan 摘要 | evidence 任务 + 可选 llm 文案 |
| 教师提示摘录 | T14 tips | teacher_annotation 文案 |

4. **导出形态**：MVP-0 为 JSON + 打印友好 HTML 页（浏览器另存 PDF）。MVP-1 服务端 PDF 可选（若引入依赖需评估包体；优先无重依赖方案）。CSV 成绩导出若 T13 已有则复用链接，不重复造轮。

5. **隐私**：默认展示学号/化名；手机邮箱不进报告。PII 检测：summary 字段过现有 PIIDetector。审计：记录谁导出了谁的报告（元数据）。

### API / 数据草案

| 方法 | 路径 | 角色 | 说明 |
|------|------|------|------|
| GET | `/api/teacher/reports/weekly` | teacher | query: teachingUnitId, studentId?, from, to → JSON |
| GET | `/api/student/reports/weekly` | student | 仅本人 → JSON |
| GET | `/api/teacher/reports/weekly.html` | teacher | 打印页 HTML |

### 模块变更

- 新增 `server/reports/` 模块（WeeklyReportService + routes），聚合现有数据源。
- 复用 T01 Attempt、T06 Mastery + Intervention、T07 MistakeBook、T08 班级指标、T14 tips、T18 plan 摘要。
- 复用 `server/pii/` PIIDetector。
- 前端教师学情页学生行增加「周报」入口 → 预览 → 打印/下载 HTML。
- 前端学生侧栏增加「我的周报」入口。

## Testing Decisions

### 测试缝隙

- **主缝隙**：新 `tests/weeklyReport.test.ts` — HTTP API 级集成测试，覆盖权限、PII、空态、章节完整性。
- **次缝隙**：`tests/piiDetector.test.ts`（扩展）— 验证 report summary 字段过 PII 检测。

### 测试内容

1. 学生不能拉他人报告（403）。
2. 教师只能拉本 TeachingUnit enrollment 学生的报告（403 越权）。
3. 报告中 practice 分不标为正式掌握（D1 守护）。
4. 无 assessment 时趋势为空态文案，不 500。
5. 章节含证据层标识；AI 文案有灰标（`llm_inference`）。
6. summary 字段过 PIIDetector（PII 命中拒绝存储）。
7. 导出审计日志记录（谁导出了谁的报告）。

### 好测试的标准

只测外部行为（API 响应 + 权限 + 空态 + PII），不测 HTML 渲染 DOM 结构。参考现有 `tests/teacherWorkflow.test.ts` 和 `tests/piiDetector.test.ts` 的模式。

## Out of Scope

- 家长 App / 微信推送
- 校级大屏对比排行
- 自动邮件定时发送
- 把 AI 建议写成官方成绩

## Further Notes

### 验收（Done 定义）

1. 教师导出 demo 班一生徒周报 HTML 可打印。
2. 章节含证据层标识；AI 文案有灰标。
3. 权限与 PII 测试通过。
4. 无 assessment 时空态文案不报错。
5. 实现报告 `docs/product-roadmap/reports/T19-implementation-report.md`。

### 关联旧票

- [[T06-adaptive-loop]]：Mastery + Intervention 数据源
- [[T07-student-experience]]：MistakeBook 数据源
- [[T08-teacher-workflow]]：班级指标
- [[T14-batch-teacher-tips]]：教师提示摘录数据源
- [[T18-hard-fact-study-plan]]：下周计划摘要数据源
- PRODUCT-MAP fog：家长报告导出
