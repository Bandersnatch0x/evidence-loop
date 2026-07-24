# Handoff: EvidenceLoop 产品化 + T14 站内消息

## Mission

GOAI Boundless Agents · AI+教育 — **EvidenceLoop（循证实训 Agent）**。
Wayfinder 十票产品化(`.scratch/wayfinder/MAP.md`,状态 IMPLEMENTED)已全部建成；
T11–T13 评审扫尾 + **T14 教师批量发提示（站内消息）** 已落地；
现场演示脚本、成套交卷计时壳、T14 学生多选 UI 已补齐。

**Authoritative root:** `D:/code_space/evidence-loop`(Node 20,better-sqlite3 ^11)

## Status (2026-07-25)

**十票 + T11–T14 IMPLEMENTED；演示交付件齐；E2E 冒烟绿。**

| 波次 | 内容 | commit |
|------|------|--------|
| T01–T10 | 产品化主路径 | `docs/product-roadmap/PRODUCT-MAP.md` |
| T11–T13 | T08 评审扫尾 | `2eaf693` / `bad7a69` / `d81f0aa` |
| **T14** | 教师批量发提示（站内消息） | `16a65e9` + report |
| Demo 交付件 | 现场脚本 + 成套计时壳 + 提示多选 | `bf6c112` |
| 测试修复 | `App.test` mock `listStudentTips`（收件箱挂载） | `6a615e3` |
| E2E | Playwright demo loops → 16/16 | `scripts/e2e-demo-loops.mjs` |

验证快照：
- `tsc --noEmit` **EXIT=0**；全量 `vitest run` **481 passed + 1 skipped**
- `tests/teacherTips.test.ts` 11/11；`tests/productDataModel.test.ts` 9/9
- E2E baseUrl 用空闲端口（本机 `4173` 可能 EACCES；常用 `http://127.0.0.1:5280`）

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
- **T14 提示是消息不是分**：永不写 score / evidence / MasteryProfile
- Cohort 正式中位分排除待终裁主观题(`pendingAdjudication`)
- T10 egress:学生 PII 永不出境

## Demo 演示路径

**身份常量**:学员 `learner-demo` / 教师 `teacher-demo` / 单元 `tu-demo` / 预置题 `seed:<assignmentId>`。
角色:侧栏「演示角色切换」+ `x-demo-role`(dev-only MockSession)。

- **学生**:我的练习 → **老师提示**收件箱 → 今日该练/双模 → 练习态求助 → 提交 → **成套计时交卷壳** → 错题本 → 重练
- **教师**:教师工作台 → 使用演示单元 tu-demo → 布置 → **发提示（多选/全班）** → 主观题批改(可导出 CSV)→ 终裁
- **学情**:班级学情中位分尊重终裁门;待终裁计数
- **多模态**:`MULTIMODAL_ENABLED=true` + `docs/DEMO-multimodal-*.md`
- **现场脚本**:[`docs/DEMO-live-script.md`](docs/DEMO-live-script.md)（含专家问答备稿）

## Known tails(有意后置,非阻塞 Demo)

| 项 | 说明 |
|----|------|
| 成绩 Excel/PDF 教务导出 | fog;CSV 已有 |
| S4 list 性能 / S5 demo id 耦合 | Demo 可接受 |
| 激励体系 / 家长报告 / 课标对齐 | MAP Not yet specified |
| 短信/推送/家长端提示 | T14 出界 |
| 成套交卷与 Attempt 批量提交 API | 当前为 UI 仪式壳；计分仍在单题 Attempt |
| 全量 vitest 并发 flake | 5 个 .tsx（App/tutoringPanel/Gradebook/MistakeBook/QuestionBankPanel）偶发红，并发起 HTTP server 抢端口所致；重跑必绿。决赛 CI 前建议 `npx vitest run --no-file-parallelism` 或限并发 |

## Next

（空）现场演示与计时壳 / T14 多选已交付。若决赛加码：Excel/PDF 导出、成套批量提交 API、家长端。

## Key docs

| 文档 | 用途 |
|------|------|
| `CONTEXT.md` | 域语言 + Active decisions |
| `docs/DEMO-live-script.md` | 现场演示脚本 + 专家问答 |
| `docs/product-roadmap/decisions/` | T01–T14 裁决 |
| `docs/product-roadmap/reports/` | 实现报告 |
| `docs/adr/0001-0008` | 铁律与架构 |
| `docs/ROADMAP.md` | 决赛时间线 |

## Commands

```powershell
cd D:/code_space/evidence-loop
# 若 4173 EACCES，换端口：
$env:PORT='5280'; npm run dev
# 或：
node output/restart-dev-server.cjs

npx vitest run tests/teacherTips.test.ts tests/productDataModel.test.ts
node node_modules/typescript/lib/tsc.js --noEmit
node scripts/e2e-demo-loops.mjs http://127.0.0.1:5280
```

## Do not re-do

- wayfinder 十票裁决(CLOSED)
- 核心 Agent 环、7 题型 Runner、9 学科 DAG、多模态 Phase 1
- T11–T14（已落地）
- 现场演示脚本 / 成套计时壳 / TipComposer 多选（本轮已落地）
