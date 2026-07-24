# Handoff: EvidenceLoop 产品化十票全部落地（T01–T10）+ T08 评审扫尾

## Mission

GOAI Boundless Agents · AI+教育 — **EvidenceLoop（循证实训 Agent）**。
Wayfinder 十票产品化(`.scratch/wayfinder/MAP.md`,状态 IMPLEMENTED)已全部建成:
学生真登录自主刷题 + 三层 AI 辅导 + 教师建单元/导入/布置/终裁 + 学情自动闭环。

**Authoritative root:** `D:/code_space/evidence-loop`(Node 20,better-sqlite3 ^11)

## Status (2026-07-24)

**十票 IMPLEMENTED + T08 评审扫尾 T11–T13 已提交。**

| 波次 | 内容 | 代表 commit |
|------|------|-------------|
| T01–T10 | 产品化主路径 | 见 `docs/product-roadmap/PRODUCT-MAP.md` |
| T07/T08 Demo 缺口 | 今日该练/重练/tu-demo/预置库可布置/单元选择器 | `365157a` |
| **T11** | P4 Cohort 终裁门 / S2 enrollment / S1 assembleManual seed | `2eaf693` |
| **T12** | P1 dueAt / P2 先建班 / P3 CSV 上传 / S3 主观满分可编辑 | `bad7a69` |
| **T13** | P5 终裁 HMAC 签名 / P6 成绩·激活码 CSV / S6 list 装配抛错 | `d81f0aa` |

全量基线（T13 前）: vitest **458+** / tsc **0**。T13 相关: teacherWorkflow+Gradebook **22/22** + tsc **0**。

## 复赛已交付(产品化十票之前的地基,勿重做)

- **多模态 Phase 1**(ADR-0005): VoiceCompanion / DOM 高亮 / STT / feature flag 红线
- **多学科题型引擎**(ADR-0008): 7 题型 Runner + 9 学科 121 KP DAG
- **记忆与自适应硬事实层**: FSRS + 依赖链 + MasteryProfile
- **合规**(ADR-0002/0003): 容器隔离、HMAC 审计链、PII、被遗忘权 API

## Product invariants(铁律,勿破坏)

- 分数只来自可复现证据;LLM 永不改分(ADR-0001)
- **D1 双模**:练习态只喂 FSRS,不进正式 MasteryProfile
- 辅导 generator 物理隔离打分路径
- 教师终裁写 `result.teacherAnnotation`(+`signature`),永不折叠进 `result.score`;无批量给分
- Cohort 正式中位分排除待终裁主观题(`pendingAdjudication`)
- T10 egress:学生 PII 永不出境

## Demo 演示路径

**身份常量**:学员 `learner-demo` / 教师 `teacher-demo` / 单元 `tu-demo` / 预置题 `seed:<assignmentId>`。
角色:侧栏「演示角色切换」+ `x-demo-role`(dev-only MockSession)。

- **学生**:我的练习 → 今日该练/双模 → 练习态求助 → 提交 → 错题本 → 重练
- **教师**:教师工作台 → 使用演示单元 tu-demo → 布置(含 dueAt)→ 主观题批改(可导出 CSV)→ 终裁
- **学情**:班级学情中位分尊重终裁门;待终裁计数
- **多模态**:`MULTIMODAL_ENABLED=true` + `docs/DEMO-multimodal-*.md`

## Known tails(有意后置,非阻塞 Demo)

| 项 | 说明 |
|----|------|
| 成套卷计时交卷 UI | T07 fog;paper 后端已有 |
| 批量发提示/站内消息 | T08 评审出界(需消息通道) |
| 成绩 Excel/PDF 教务导出 | fog;CSV 已有 |
| S4 list 性能 / S5 demo id 耦合 | Demo 可接受 |
| 激励体系 / 家长报告 / 课标对齐 | MAP Not yet specified |

## Next

1. **E2E 浏览器实测**:`npm run dev` 后 `node scripts/e2e-demo-loops.mjs`（Playwright,截图进 `output/playwright/e2e/`）
2. 现场演示脚本 + 专家问答准备
3. 决赛若需「测评态成套交卷」仪式感再做计时壳

## Key docs

| 文档 | 用途 |
|------|------|
| `CONTEXT.md` | 域语言 + Active decisions |
| `docs/product-roadmap/decisions/` | T01–T13 裁决 |
| `docs/product-roadmap/reports/` | 实现报告 |
| `docs/adr/0001-0008` | 铁律与架构 |
| `docs/ROADMAP.md` | 决赛时间线 |

## Commands

```powershell
cd D:/code_space/evidence-loop
npm run dev
npx vitest run
node node_modules/typescript/lib/tsc.js --noEmit
# 需先 npm run dev,另开终端:
node scripts/e2e-demo-loops.mjs
# 或指定 baseUrl:
node scripts/e2e-demo-loops.mjs http://127.0.0.1:5173
```

## Do not re-do

- wayfinder 十票裁决(CLOSED)
- 核心 Agent 环、7 题型 Runner、9 学科 DAG、多模态 Phase 1
- T11–T13 评审扫尾(已提交)
