# Handoff: EvidenceLoop 产品化 + T14 站内消息

## Mission

GOAI Boundless Agents · AI+教育 — **EvidenceLoop（循证实训 Agent）**。
Wayfinder 十票产品化(`.scratch/wayfinder/MAP.md`,状态 IMPLEMENTED)已全部建成；
T11–T13 评审扫尾 + **T14 教师批量发提示（站内消息）** 已落地。

**Authoritative root:** `D:/code_space/evidence-loop`(Node 20,better-sqlite3 ^11)

## Status (2026-07-25)

**十票 + T11–T14 IMPLEMENTED；E2E 浏览器冒烟绿。**

| 波次 | 内容 | 代表 |
|------|------|------|
| T01–T10 | 产品化主路径 | `docs/product-roadmap/PRODUCT-MAP.md` |
| T11–T13 | T08 评审扫尾 | commits `2eaf693` / `bad7a69` / `d81f0aa` |
| **T14** | 教师批量发提示（站内消息） | `docs/product-roadmap/reports/T14-implementation-report.md` |
| E2E | Playwright demo loops | `scripts/e2e-demo-loops.mjs` → 16/16 |

验证快照：
- `tests/teacherTips.test.ts` **11/11**
- `tests/productDataModel.test.ts` **9/9**
- E2E baseUrl 建议用空闲端口（本机默认 `4173` 可能 EACCES；常用 `http://127.0.0.1:5280`）

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

- **学生**:我的练习 → **老师提示**收件箱 → 今日该练/双模 → 练习态求助 → 提交 → 错题本 → 重练
- **教师**:教师工作台 → 使用演示单元 tu-demo → 布置 → **发提示** → 主观题批改(可导出 CSV)→ 终裁
- **学情**:班级学情中位分尊重终裁门;待终裁计数
- **多模态**:`MULTIMODAL_ENABLED=true` + `docs/DEMO-multimodal-*.md`

## Known tails(有意后置,非阻塞 Demo)

| 项 | 说明 |
|----|------|
| 成套卷计时交卷 UI | T07 fog;paper 后端已有 |
| 成绩 Excel/PDF 教务导出 | fog;CSV 已有 |
| S4 list 性能 / S5 demo id 耦合 | Demo 可接受 |
| 激励体系 / 家长报告 / 课标对齐 | MAP Not yet specified |
| 短信/推送/家长端提示 | T14 出界 |

## Next

1. 现场演示脚本 + 专家问答准备
2. 决赛若需「测评态成套交卷」仪式感再做计时壳
3. 可选：T14 学生多选 UI（当前逗号分隔 studentIds，与布置作业一致）

## Key docs

| 文档 | 用途 |
|------|------|
| `CONTEXT.md` | 域语言 + Active decisions |
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
