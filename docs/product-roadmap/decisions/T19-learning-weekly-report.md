# [wayfinder:ticket] T19 学情周报 / 家长可读导出

## Question

PRODUCT-MAP fog「家长报告导出」与黑客松常见「周报/学情 PDF」对齐：按学期+教学单元切片导出一周学情——完成率、测评分趋势、薄弱 KP、错题 Top、下周计划摘要。必须分层标注 **证据 vs AI 建议**，且默认 **不含可识别隐私超标字段**（Demo：测试名单可用）。

**来源**：国外教育黑客松调研 Wave B-⑤；PRODUCT-MAP Not yet specified。

**Blocked by**: T01（term/unit）、T06/T18（薄弱与计划）、T07（错题本）、T08（班级指标）

---

## 要定什么

1. **受众与权限**  
   - MVP：教师生成「可转发的报告」；学生可看自己的摘要。  
   - **不做**家长独立账号/登录。  
   - 教师仅本 TeachingUnit enrollment。

2. **时间窗**  
   - 默认：最近 7×24h 或「本自然周」；参数 `from`/`to` ISO。  
   - 切片：`termId` + `teachingUnitId`。

3. **报告章节（固定顺序）**

| 章节 | 数据源 | 层 |
|------|--------|-----|
| 完成与时长 | Attempt 计数 | evidence |
| 测评得分趋势 | assessment scores | evidence |
| 薄弱知识点 | Mastery + Intervention | evidence |
| 错题 Top3–5 | MistakeBook | evidence |
| 练习活动量 | practice attempts | evidence（标注不入正式掌握） |
| 下周建议 | T18 plan 摘要 | evidence 任务 + 可选 llm 文案 |
| 教师提示摘录 | T14 tips | teacher_annotation 文案 |

4. **导出形态**  
   - MVP-0：JSON + 打印友好 HTML 页（浏览器另存 PDF）。  
   - MVP-1：服务端 PDF 可选（若引入依赖需评估包体；优先无重依赖方案）。  
   - CSV 成绩导出若 T13 已有则复用链接，不重复造轮。

5. **隐私**  
   - 默认展示：学号/化名；手机邮箱不进报告。  
   - PII 检测：summary 字段过现有 PIIDetector。  
   - 审计：记录谁导出了谁的报告（元数据）。

---

## 建议 MVP 形状

### API

| 方法 | 路径 | 角色 | 说明 |
|------|------|------|------|
| GET | `/api/teacher/reports/weekly` | teacher | query: teachingUnitId, studentId?, from, to |
| GET | `/api/student/reports/weekly` | student | 仅本人 |
| GET | `/api/teacher/reports/weekly.html` | teacher | 打印页 |

### UI

- 教师学情：学生行「周报」→ 预览 → 打印/下载 HTML。  
- 学生：侧栏「我的周报」。

### 测试

- 学生不能拉他人报告。  
- 报告中 practice 分不标为正式掌握。  
- 无 assessment 时趋势为空态文案，不 500。

---

## 出界（本票不做）

- 家长 App / 微信推送  
- 校级大屏对比排行  
- 自动邮件定时发送  
- 把 AI 建议写成官方成绩  

---

## 验收（Done 定义）

1. 教师导出 demo 班一生徒周报 HTML 可打印。  
2. 章节含证据层标识；AI 文案有灰标。  
3. 权限与 PII 测试通过。  
4. 实现报告 `docs/product-roadmap/reports/T19-implementation-report.md`。

---

## 状态

**OPEN** — 待实现。

## 关联

[[T06-adaptive-loop]] [[T07-student-experience]] [[T08-teacher-workflow]] [[T14-batch-teacher-tips]] [[T18-hard-fact-study-plan]]  
PRODUCT-MAP fog：家长报告导出。
