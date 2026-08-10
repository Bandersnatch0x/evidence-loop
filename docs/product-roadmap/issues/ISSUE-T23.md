# Issue T23 — 能力证据包 / 作品集导出

**Triage**: ready-for-agent
**Source PRD**: [prds/T23-evidence-portfolio-export.md](../prds/T23-evidence-portfolio-export.md)
**Build order**: 8（体验加深项）

## What to build

一条端到端纵向切片：新增 `PortfolioExportService` 聚合选定 Attempt 列表（默认 assessment + code/project 题型）→ 每条含题目元数据、score、`evidence[]`（通过/失败）、提交文本或代码 hash、教师批注、时间戳 → 输出 `portfolio.json` + 可选 `README.md` → `POST /api/student/portfolio/export` 与 `POST /api/teacher/portfolio/export`（zip 下载，不上传第三方）→ 学生「我的成绩/错题」旁 + 教师学员详情「导出证据包」入口 → 权限：学生仅本人、教师仅本单元 enrollment → 导出记审计日志 → 架构守护（导出不写 MasteryProfile）→ 红线：LLM 辅导对话默认不打入包（opt-in 默认关）。

封面含学生化名、教学单元、导出时间、算法/量规版本号。

## Acceptance criteria

- [ ] Demo 代码题 100 分 Attempt 可导出 JSON 含满证据
- [ ] 权限与审计测试通过：越权 403 + 审计日志
- [ ] 架构测试通过：导出不写 MasteryProfile
- [ ] LLM 辅导对话默认不打入包
- [ ] 实现报告 `docs/product-roadmap/reports/T23-implementation-report.md` 完成

## Blocked by

None — can start immediately（依赖 T01/CodeRunner/T08 均已 IMPLEMENTED，无 intra-batch 阻塞）
