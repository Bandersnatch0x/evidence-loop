# [wayfinder:ticket] T23 能力证据包 / 作品集导出

## Question

对齐 DevHub 类「就业/实训就绪」叙事：把学生在编程与项目题上的 **可复现证据** 导出为作品集包（通过的测试、提交摘要、教师批注、时间线），用于实训报告或竞赛材料。不是社交主页，不做公开 feed。

**来源**：国外教育黑客松调研 Wave C-⑨。

**Blocked by**: T01（Attempt）、CodeRunner 证据、T08（teacherAnnotation）

---

## 要定什么

1. **包内容（MVP）**  
   - 选定 Attempt 列表（默认 assessment + code/project 题型）。  
   - 每条：题目元数据、score、evidence[]（通过/失败）、提交文本或代码 hash、教师批注（若有）、时间戳。  
   - 封面：学生化名、教学单元、导出时间、算法/量规版本号。

2. **格式**  
   - `portfolio.json` + 可选 `README.md`（人类可读摘要）。  
   - zip 下载；不上传第三方。

3. **权限**  
   - 学生：仅本人。  
   - 教师：本单元 enrollment 学生。  
   - 导出审计日志。

4. **红线**  
   - 不把 llm 辅导对话默认打进包（可选 opt-in，默认关）。  
   - 不改任何分数。

---

## 建议 MVP 形状

### API

| 方法 | 路径 | 角色 | 说明 |
|------|------|------|------|
| POST | `/api/student/portfolio/export` | student | body: attemptIds? 或 filter |
| POST | `/api/teacher/portfolio/export` | teacher | body: studentId + filter |

### UI

- 学生「我的成绩/错题」旁：**导出证据包**。  
- 教师学员详情：同。

### 测试

- 越权 403。  
- zip/json 含 evidence 与 score 一致。  
- 导出不写 MasteryProfile。

---

## 出界（本票不做）

- 公开作品墙 / 点赞  
- LinkedIn 一键同步  
- 证书 PDF 烫金模板（可后做）  

---

## 验收（Done 定义）

1. Demo 代码题 100 分 Attempt 可导出 JSON 含满证据。  
2. 权限与审计测试通过。  
3. 实现报告 `docs/product-roadmap/reports/T23-implementation-report.md`。

---

## 状态

**OPEN** — Wave C。

## 关联

[[T01-product-data-model]] [[T08-teacher-workflow]] CodeRunner / ADR-0001  
CONTEXT：证据可复现、可审计。
