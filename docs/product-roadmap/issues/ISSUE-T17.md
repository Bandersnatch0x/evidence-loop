# Issue T17 — 多 Agent 产品叙事包装（路演 / 透明度）

**Triage**: ready-for-agent
**Source PRD**: [prds/T17-multi-agent-product-narrative.md](../prds/T17-multi-agent-product-narrative.md)
**Build order**: 1

## What to build

一条端到端纵向切片：在 `shared/agentCatalog.ts` 定义 5 个 Agent 静态目录（评分/诊断/辅导/组卷/教师建议，含 `touchesScore` 与 `llmAllowed` 字段）→ 透明度页渲染五张 Agent 卡片（输入/输出/禁止事项 + 铁律徽章「评分路径零 LLM」）→ 新增只读 `GET /api/transparency/agents` 返回静态 JSON → 加契约测试（`touchesScore===true` 必 `llmAllowed===false`）+ 架构守护（catalog 声明的评分模块不得 import tutoring LLM 写回路径）→ 更新 `DEMO-oral-10min` / cue-card 增加 30s 多 Agent 口播。

本票**不引入任何新框架/多进程**，只做产品叙事层包装，复用现有模块切分。

## Acceptance criteria

- [ ] 透明度页可见 5 个 Agent 卡片及「评分不用 LLM」铁律徽章
- [ ] 契约测试通过：`touchesScore===true` 的条目 `llmAllowed` 必为 `false`
- [ ] 架构守护通过：评分模块不 import tutoring LLM 写回路径
- [ ] `GET /api/transparency/agents` 返回完整 5 条目目录 JSON
- [ ] 口播 / cue-card 已更新，含 30s「多 Agent 但不碰分」段落
- [ ] 实现报告 `docs/product-roadmap/reports/T17-implementation-report.md` 完成

## Blocked by

None — can start immediately（仅读现有模块，无 intra-batch 依赖）
