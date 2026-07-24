# Handoff: EvidenceLoop 产品化十票全部落地（T01–T10）

## Mission

GOAI Boundless Agents · AI+教育 — **EvidenceLoop（循证实训 Agent）**。
Wayfinder 十票产品化(`.scratch/wayfinder/MAP.md`,状态 IMPLEMENTED)已全部建成:
学生真登录自主刷题 + 三层 AI 辅导 + 教师建单元/导入/布置/终裁 + 学情自动闭环。

**Authoritative root:** `D:/code_space/evidence-loop`(Node 20,better-sqlite3 ^11)

## Status (2026-07-24)

**十票全部 IMPLEMENTED,九份实现报告齐(T10 为全局约束票,无需实现报告)。**
全量验证:`npx vitest run` **55 文件 / 458 passed + 1 skipped**,`tsc --noEmit` **EXIT=0**。

| 票 | 内容 | 提交 | 报告 |
|----|------|------|------|
| T01 | 产品数据模型(Attempt 聚合根 + Drizzle) | `7c1b7bd` | ✅ |
| T02 | 认证会话(scrypt + HTTP-only cookie) | `c33f89c` | ✅ |
| T03 | 题库系统(7 题型手录 + seed 预置库) | `c33f89c` + 未提交收尾 | ✅* |
| T04 | 扫描导入 OCR(校对闸门) | `7e446bf` | ✅ |
| T05 | 三层 AI 辅导(讲解/苏格拉底/追问,物理隔离) | `7e446bf` | ✅ |
| T06 | 学情自动闭环(FSRS ∩ 依赖链 ∩ 已教) | `7e446bf` | ✅ |
| T07 | 学生刷题体验(双模/今日该练/错题本) | `3b3f84f`+`e2c0102` + 未提交收尾 | ✅* |
| T08 | 教师工作流(建单元/导入/布置/终裁) | `3b3f84f` + 未提交收尾 | ✅* |
| T09 | 标准解析(RAG 地基,AI 采纳可权威化) | `c33f89c` | ✅* |
| T10 | 数据出境合规(egress gate,境内/本地栈) | 贯穿各票 | 决策票 |

## ⚠️ 第一件事:提交工作区

**约 27 个修改 + 12 个新文件未提交**,包含三个逻辑批次(测试/类型已全绿):

1. **T07 Demo 缺口批**:错题本「重练」、练习态提交前求助、「今日该练」(`TodayPractice.tsx`)、`seedDemoProduct.ts` 冷启动灌库
2. **T08 Demo 缺口批**:`tu-demo` 归属 `teacher-demo`(否则演示教师全 Forbidden)、预置库可布置、单元选择器、Gradebook 批后乐观更新、教师侧题库面板(`QuestionBankPanel`/`QuestionEditor`)
3. **questionId 双形态修复**:`assignmentIdToQuestionId()`(`src/lib/api.ts`),App 两处开练入口统一写 `seed:` 题库形态,否则错题本同题分裂两行且学科/知识点解析失败;回归测试在 `tests/App.test.tsx`
4. 四份实现报告(T03/T07/T08/T09)

建议拆 3-4 笔 conventional commits(feat(T07)… / feat(T08)… / fix(ui): questionId 归一 / docs: 实现报告)。

## Product invariants(铁律,勿破坏)

- 分数只来自可复现证据;LLM 永不改分(ADR-0001)
- **D1 双模**:练习态证据只喂 FSRS,不进正式 MasteryProfile(`EvidenceProjector.ts:50` 早退 + `tests/attemptEvaluatePath.test.ts` 守护);测评态关辅导
- 辅导 generator 物理隔离打分路径,产物走 `AdvisorySuggestion`
- 教师终裁写 `result.teacherAnnotation`,永不折叠进 `result.score`;无批量给分端点
- T10 egress gate:学生 PII 永不出境,LLM/OCR 默认境内或本地,`LLM_PROVIDER`/`OCR_PROVIDER` 开关

## Demo 演示路径

- **学生闭环**:侧栏切学生 →「我的练习」→ 今日该练/双模入口 → 练习态作答前求助(苏格拉底)→ 提交 → 错题本 → 重练
- **教师闭环**:侧栏切教师 → 教师工作台 →「使用演示单元 tu-demo」→ 布置(handpick `seed:…` / 按 KP 组卷 / 按薄弱点)→ 学生提交作文后「主观题批改」终裁
- **多模态**:`MULTIMODAL_ENABLED=true` + `docs/DEMO-multimodal-*.md` 四份脚本

## Known tails(有意后置,非阻塞 Demo)

- T07:成套卷计时 + 统一交卷向导(paper 后端分组已有);场次回放详情页
- T08:布置导出 Excel/PDF、批量消息(fog);工作台内嵌学情矩阵(已有独立「班级学情」入口)
- `tests/multimodalAskApi.test.ts` 偶发并发端口 flake(单独跑必绿,本轮全量也绿)
- product.sqlite 旧裸 questionId 历史数据不迁移(demo 库 seed 重置即可)
- 建设期 fog:激励体系 / 家长报告 / 课标对齐 / 数据导出(MAP.md「Not yet specified」)

## Next(决赛 9/22-23,见 docs/ROADMAP.md)

1. 提交工作区(上述)
2. E2E 浏览器实测两条闭环真实可点通(建议 e2e-runner/Playwright,而非仅单测)
3. 现场演示脚本固化 + 专家问答准备(评分边界/安全/开源复用)
4. 决赛若需「测评态成套交卷」仪式感,再做 T07 后置的计时交卷壳

## Commands

```powershell
cd D:/code_space/evidence-loop
npm run dev          # Vite + Node 原生 HTTP
npx vitest run       # 55 文件全量
node node_modules/typescript/lib/tsc.js --noEmit
```

## Do not re-do

- 赛道选择、wayfinder 十票裁决(全部 CLOSED,见 docs/product-roadmap/decisions/)
- 核心 Agent 环、7 题型 Runner、9 学科 DAG、多模态 Phase 1
- 每会话先读 CONTEXT.md(域语言)+ ADR 0001-0008
