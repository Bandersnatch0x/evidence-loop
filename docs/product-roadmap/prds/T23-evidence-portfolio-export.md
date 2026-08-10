# PRD: T23 能力证据包 / 作品集导出

**状态**: OPEN
**开建顺序**: 8（体验加深项）
**来源**: 实训成果导出需求

---

## Problem Statement

学生在编程与项目题上的**可复现证据**（通过的测试、提交摘要、教师批注、时间线）目前散落在 Attempt 和 Evidence 中，无法导出为一份可提交的作品集包。学生需要把实训成果导出用于实训报告或竞赛材料，但当前没有聚合导出层。

## Solution

提供证据包导出功能：学生选定 Attempt 列表（默认 assessment + code/project 题型）→ 系统聚合题目元数据、score、evidence[]（通过/失败）、提交文本或代码 hash、教师批注、时间戳 → 输出 `portfolio.json` + 可选 `README.md`（人类可读摘要）→ zip 下载，不上传第三方。学生仅本人可导出，教师可导出本单元 enrollment 学生。导出操作记录审计日志。LLM 辅导对话默认不打入包（可选 opt-in，默认关）。

## User Stories

1. 作为学生，我想选择自己的 assessment Attempt 导出为作品集包，以便用于实训报告或竞赛材料。
2. 作为学生，我想在作品集包中看到每条 Attempt 的题目元数据、分数和证据列表，以便完整呈现学习成果。
3. 作为学生，我想在作品集包中看到通过的测试用例详情，以便证明代码质量。
4. 作为学生，我想在作品集包中看到教师批注（若有），以便展示教师认可。
5. 作为学生，我想在作品集包封面看到学生化名、教学单元、导出时间和算法/量规版本号，以便可追溯。
6. 作为学生，我想下载 zip 文件不上传第三方，以便保护数据。
7. 作为学生，我不想把 LLM 辅导对话默认打入包（可选 opt-in），以便保护隐私。
8. 作为教师，我想为本单元 enrollment 学生导出证据包，以便用于教务汇报。
9. 作为学生，我不能导出其他同学的作品集，以便保护隐私。
10. 作为教师，我不能导出非本单元学生的作品集，以便权限隔离。
11. 作为系统，导出不写 MasteryProfile，以便守护铁律。
12. 作为系统，导出操作记录审计日志，以便可追溯。
13. 作为开发者，我想验证 zip/json 含 evidence 与 score 一致，以便数据完整性。

## Implementation Decisions

### 要定什么

1. **包内容（MVP）**：选定 Attempt 列表（默认 assessment + code/project 题型）。每条：题目元数据、score、evidence[]（通过/失败）、提交文本或代码 hash、教师批注（若有）、时间戳。封面：学生化名、教学单元、导出时间、算法/量规版本号。

2. **格式**：`portfolio.json` + 可选 `README.md`（人类可读摘要）。zip 下载；不上传第三方。

3. **权限**：学生仅本人。教师本单元 enrollment 学生。导出审计日志。

4. **红线**：不把 llm 辅导对话默认打进包（可选 opt-in，默认关）。不改任何分数。

### API / 数据草案

| 方法 | 路径 | 角色 | 说明 |
|------|------|------|------|
| POST | `/api/student/portfolio/export` | student | body: attemptIds? 或 filter → zip |
| POST | `/api/teacher/portfolio/export` | teacher | body: studentId + filter → zip |

**数据结构**：

```typescript
PortfolioPackage {
  meta: {
    studentAlias: string,
    teachingUnitId: string,
    exportedAt: string,         // ISO
    algorithmVersion: string,   // 量规/算法版本
    rubricVersion: string
  },
  attempts: Array<{
    attemptId: string,
    questionMeta: { title, subject, questionType, kpIds },
    score: number,
    evidence: Array<{ id, type, passed, weight, actual?, expected? }>,
    submissionHash: string,     // 代码/文本 hash，不含原文（可选 opt-in 含原文）
    teacherAnnotation?: { score, comment, teacherId, at },
    timestamp: string
  }>
}
```

### 模块变更

- 新增 `server/portfolio/` 模块（PortfolioExportService + routes），聚合现有 Attempt + Evidence + teacherAnnotation。
- 复用 T01 Attempt 聚合根、CodeRunner 证据、T08 teacherAnnotation。
- 前端学生「我的成绩/错题」旁增加「导出证据包」入口。
- 前端教师学员详情增加同入口。
- `tests/architecture.test.ts` 增加守护：portfolio 模块不写 MasteryProfile。

## Testing Decisions

### 测试缝隙

- **主缝隙**：新 `tests/portfolioExport.test.ts` — HTTP API 级集成测试，覆盖权限、数据完整性、审计。
- **架构守护缝隙**：`tests/architecture.test.ts`（扩展）— 验证 `server/portfolio/` 不 import mastery/review/runner/scoring 写路径。

### 测试内容

1. 越权 403（学生不能拉他人包；教师不能拉非本单元学生包）。
2. zip/json 含 evidence 与 score 一致（数据完整性）。
3. 导出不写 MasteryProfile（架构守护）。
4. 导出审计日志记录（谁导出了谁的包）。
5. LLM 辅导对话默认不打入包（opt-in 默认关）。
6. 默认筛选 assessment + code/project 题型。
7. 封面含学生化名、教学单元、导出时间、算法/量规版本号。

### 好测试的标准

只测外部行为（API 响应 + 权限 + 数据完整性 + 审计），不测 zip 文件内部结构。参考现有 `tests/teacherWorkflow.test.ts` 的权限测试模式和 `tests/auditStore.test.ts` 的审计测试模式。

## Out of Scope

- 公开作品墙 / 点赞
- LinkedIn 一键同步
- 证书 PDF 烫金模板（可后做）

## Further Notes

### 验收（Done 定义）

1. Demo 代码题 100 分 Attempt 可导出 JSON 含满证据。
2. 权限与审计测试通过（越权 403 + 审计日志）。
3. 架构测试：导出不写 MasteryProfile。
4. LLM 辅导对话默认不打入包。
5. 实现报告 `docs/product-roadmap/reports/T23-implementation-report.md`。

### 关联旧票

- [[T01-product-data-model]]：Attempt 聚合根
- [[T08-teacher-workflow]]：teacherAnnotation
- CodeRunner / ADR-0001：证据可复现、可审计
- CONTEXT：证据可复现、可审计
