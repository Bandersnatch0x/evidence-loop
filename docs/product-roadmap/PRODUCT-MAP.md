# [wayfinder:map] EvidenceLoop 产品化：学生自主刷题 + AI 辅导 + 教师学情

## Destination

把 EvidenceLoop 从"证据评分 Demo"演进为**功能完整的产品原型**：学生真登录后自主刷题并获得三层 AI 辅导（讲解/对话/苏格拉底引导），老师能导入题目（含扫描 OCR）、导入学生名单分配账号、查看班级学情、并按薄弱点一键布置；学情自动闭环成下一批题。数据合规守 Demo 级（测试名单），AI 真正通电（接 LLM）。

**本地图产出规划（决策），不执行**——想清楚"建什么、什么顺序、取舍怎么定"后，交 /to-spec → /to-tickets → /implement。到头的标志：所有决策票关闭，无剩余待决策项，可以直接开建。

## Notes

**领域**：AI+教育，初高中 9 学科刷题辅导产品。每会话先读 CONTEXT.md（域语言）+ ADR 0001-0008（尤其 0001 证据铁律、0008 题型评分架构）。

**每会话应遵循的技能**：`/grilling` + `/domain-modeling`（HITL 决策票默认）；`/research`（AFK 事实票）；`/prototype`（"怎么看/怎么交互"票）。

**已钉边界（9 条）**：
1. 题库来源：老师导入/扫描（OCR + 结构化）
2. AI 辅导：三层全做（单向讲解 / 追问对话 / 苏格拉底引导）
3. 真登录 + 真会话（非假多租户切换）
4. 两层角色：学生—老师（无校级管理员）
5. 学情自动闭环（FSRS + 依赖链诊断通电成推题引擎）
6. 账号/导入功能真做，数据喂测试名单
7. 合规守 Demo 级，"不连真实学籍"边界保留
8. AI 真接 LLM（现为模板 LocalFeedbackGenerator）
9. 铁律不变：LLM 不改分，分数只来自可复现证据

**已裁决决策（charting 阶段定，非开放票）**：
- **D1 双模做题**：练习态（AI 辅导全开，证据只喂 FSRS/练习掌握度，不入正式测评）vs 测评态（AI 关，裸做，证据进正式 MasteryProfile）。复用 provenance + `mode` 元数据。
- **D2 教学单元**：保留两层角色；组织单位从"班"升级为"教学单元 = 班级 × 学科"。行政班 `Enrollment(student,class)` + `TeachingUnit(teacher,class,subject)`，加法不改结构。
- **D3 证据分级 + OCR 校对闸门**：Evidence 来源标记 `test_case`（机器验证，最高）vs `authored_key`（老师填答案，人工权威）；OCR 导入必过"老师逐题确认"闸门才入库，未确认不可用于测评态。
- **D4 学期切片**：引入 Term + 已教知识点集合；学情默认按当前学期切片；未教知识点薄弱不报警。

**关键地基发现**：D1-D4 联合暴露"当前数据模型撑不起产品"——它们共同收敛到一个**产品级数据模型**决策，是全图最底层地基，认证/题库/闭环都挂其上。

## Decisions so far

<!-- 每关闭一票追加一行 -->

- [TR1 OCR 题目结构化调研](tickets/TR1-ocr-research.md) — 分层方案：MVP-0 电子文档解析(.docx/PDF 文本层，纯 Node/无出境)+ 校对 UI；MVP-1 按合规接公式识别(Mathpix 出境 / PaddleOCR 本地)；MVP-2 切题+化学结构图。统一"草稿→教师校对→入库"闸门（印证 D2）。上抛"OCR 出境合规"为独立裁决点。落盘 `docs/research/ocr-question-import.md`
- [T01 产品级数据模型](tickets/T01-product-data-model.md) — **全图地基**。核心裁决：把散落的 EvaluationResult 收敛成 **Attempt 聚合根**，`mode(practice|assessment)/source(test_case|authored_key)/termId/teachingUnitId` 四个必填判别字段承载 D1-D4 全部约束。四聚合根：Person / OrgUnit(Class·Subject·TeachingUnit·Enrollment·Term) / Question·QuestionBank / Attempt。MasteryProfile·ReviewCard 降为按 mode 分流的**派生读模型**（practice 证据字节级不进正式掌握度，CI 架构测试守护）。存储：SQLite + Drizzle 迁移 + 内容寻址媒体(`data/media/<hash>`)，接口隔离保证换 Postgres 零改业务。JsonEvaluationStore→AttemptStore 走 expand-contract 渐进迁移。学情按 `termId`+`taughtKpIds` 交集裁剪，未教 KP 不报警。合规：判别字段即审计字段，authored_key 可追溯可推翻，AI 辅导类型层禁止贴 evidence 标签。
- [TR2 LLM 三层辅导调研](tickets/TR2-llm-tutoring-research.md) — 复用 `OpenAICompatibleFeedbackGenerator` 骨架抽 `callOpenAICompatible()`，新增 `TutoringGenerator`/`SocraticGenerator` 只换 prompt。苏格拉底移植 Khanmigo 公开指令（含防套话：连续3次低努力索取→拒绝放提示、只用同构例题）。降幻觉靠 RAG 挂标准解析("不让 LLM 自己算")。铁律靠物理隔离（辅导 generator 不接触打分路径，只读 FeedbackContext 不回写 score/evidence）。选型首选境内已备案 DeepSeek/Qwen/豆包/GLM（数据出境约束）。MVP 顺序：讲解+RAG→苏格拉底→多轮追问。上抛"数据出境合规"（与 TR1 同）。落盘 `docs/research/llm-tutoring-approach.md`
- [T10 数据出境合规裁决](tickets/T10-data-egress-compliance.md) — **全局约束（egress gate）**。按数据敏感度分级：①学生 PII/答题/画像/音频 = 强 PII，**永不出境**，只走境内已备案（LLM→DeepSeek/Qwen/豆包/GLM）或本地（OCR→PaddleOCR 微服务）；②题目内容（不含学生 PII）可出境，MVP-1 允许 Mathpix 公式识别，但导入前须确认无手写签名/学号。Demo 阶段默认全境内/本地栈，出境能力做成配置开关（`LLM_PROVIDER`/`OCR_PROVIDER`），演示喂测试数据时可关。守 CONTEXT"不连真实学籍"边界。
- [T02 认证与会话系统](tickets/T02-auth-system.md) — 学号+密码登录（老师用邮箱/工号），会话用 HTTP-only cookie + 服务端 session（守现有 ADR，不裸 JWT）。密码 `scrypt`/`argon2id` 哈希加盐。老师自助注册开通（两层无管理员）；学生账号由老师导入名单批量生成，首次登录用激活码/初始密码强制改密。`SessionProvider` 接口保留，`MockSessionProvider` 降级为 dev-only 演示后门（`NODE_ENV!=production` 且显式开关），生产走 `RealSessionProvider`。演示态可一键切假角色但带 `X-Demo-Mode` 头。
- [T03 题库系统](tickets/T03-question-bank.md) — 老师私有题库（共享出界）。手工录入：7 题型各自表单（复用已有 validator spec 形状：Choice/FillBlank/Numeric/Expression/ChemEquation/Essay/Code）。Question 结构对齐 T01（题干/选项/答案/知识点标注/难度/标准解析/source）。组卷：单题布置 + 按知识点/薄弱点智能组卷（喂 T06）。现有硬编码 assignments 迁移为"系统预置题库"（demo seed），与老师私有库共存。
- [T09 题目标准解析](tickets/T09-standard-solution.md) — 标准解析 `Question.solution` **可选但强烈推荐**。取舍：有标准解析时 AI 辅导走 RAG 复述/补充（不自己算，降幻觉——对齐 TR2）；无解析时 AI 可生成讲解但标 `llm_inference` provenance + "AI 生成，可能有误"免责徽章。老师可把 AI 讲解"采纳"为标准解析（人工权威化，翻转 provenance→teacher_annotation）。这是 AI 辅导内容质量的地基。
- [T05 三层 AI 辅导 + LLM 通电](tickets/T05-ai-tutoring.md) — D1 铁律：仅练习态开放辅导。三层：讲解（答错后针对性，RAG 挂标准解析）/追问对话（多轮，滚动窗口 4-6 轮+摘要）/苏格拉底（Khanmigo prompt，防套话）。复用 `OpenAICompatibleFeedbackGenerator` 抽 `callOpenAICompatible()`，新增 `TutoringGenerator`/`SocraticGenerator`。物理隔离：辅导 generator **不接触打分路径**，只读 `FeedbackContext`、产物走 `AdvisorySuggestion`（类型层禁贴 evidence 标签），永不回写 score/evidence。保留模板 fallback（LLM 挂/限流时降级）。境内 provider（T10 egress gate）。MVP：讲解+RAG→苏格拉底→多轮。
- [T06 学情自动闭环](tickets/T06-adaptive-loop.md) — 把 FSRS+依赖链诊断从孤立 API 接成产品。学生"今天该练的" = FSRS due 卡片 ∩ 依赖链薄弱点，且经 D4 已教进度（`taughtKpIds`）过滤，未教不推。老师"一键按薄弱点给全班布置" = 聚合 cohort 薄弱 KP → 从题库智能组卷 → 批量布置。练习态证据喂 FSRS 复习调度（D1：喂调度但不入测评掌握度）。推题从老师题库/预置库选，与 T03 耦合。
- [T07 学生刷题体验](tickets/T07-student-experience.md) — 补充刚需1。**练习场次模型**：支持一题一交（快速练）+ 一套卷打包（计时/交卷/统一看，测评态默认打包）。**错题本**：错题自动归集（按 KP/学科/时间聚合），支持重刷（重刷进练习态）。入口区分练习态/测评态（D1，UI 明确标识 + 不同视觉）。求助中间态：不会做→先要提示（联动 T05 苏格拉底），非直接看答案。移动端：拉进范围（响应式优先，学生刷题手机场景），复用已有 mobile 痕迹。
- [T08 教师工作流](tickets/T08-teacher-workflow.md) — 补充刚需2。建教学单元（班级×学科，D3）+ 导入学生名单批量分配账号（T02 激活码流）。布置作业：单题/组卷/按薄弱点（联动 T06）。**主观题批改界面**（补 AdvisoryLayer 缺失的人工终裁环）：展示 EssayRunner 客观指标 + AdvisoryService 的 AI 建议（灰色"AI 推断"标识）+ 教师打终裁分（`teacher_annotation` provenance，`requiresTeacherConfirmation` 门），终裁后才入 Cohort 指标。批量操作限本教学单元。
- [T11 T08 评审扫尾](decisions/T11-t08-review-sweep.md) — 仅三项：P4 Cohort 消费 teacherAnnotation 门 / S2 布置 enrollment 校验 / S1 assembleManual 认预置库。其余评审 fog 后置。
- [T12 T08 评审剩余项](decisions/T12-t08-review-remainder.md) — P1 截止时间 / P2 先建班 / P3 CSV 上传 / S3 主观满分可编辑。P5 签名、P6 导出/发提示仍出界。
- [T13 T08 评审收口](decisions/T13-t08-review-closeout.md) — P5 终裁 HMAC 签名 / P6 成绩与激活码 CSV 导出 / S6 list 装配失败可见。批量发提示仍出界。
- [T14 教师批量发提示](decisions/T14-batch-teacher-tips.md) — **IMPLEMENTED**。站内消息通道（TeachingUnit fan-out + 学生收件箱），不碰 score。见 reports/T14-implementation-report.md。

## Not yet specified

<!-- 已在范围内、但还不够清晰无法开票的雾。以下多数已被主决策票吸收，剩余为"建设期再定"的次级项 -->

- **激励体系**：打卡/进度/掌握度升级动画，与"证据严肃调性"的取舍（未决，建设期再定）
- **家长报告导出**：学情导出成 PDF 给家长（未决，可 graduate 为独立小票）
- **课标对齐**：121 知识点 DAG 是否对齐真实课标（人教/部编版章节）——内容工作，非架构，建设期对齐
- **数据导出**：学情/成绩/错题导出 Excel/PDF（教务对接过渡，未决）

<!-- 已被主决策票解答，不再是雾：
  AI 讲解可信度 → T05/T09（AI 讲解标 llm_inference，RAG 挂标准解析降幻觉）
  AI 辅导成本/延迟/限流 → T05（境内模型 + try/catch 模板 fallback）
  移动端 → T07（响应式优先，学生刷题手机场景）
  空状态/冷启动 → T08（教师引导流程：建单元→导入→建/导题）
  教师批量发提示 → T14（站内消息通道，IMPLEMENTED）
-->

## 地图状态：CLEARED ✅ → IMPLEMENTED ✅

所有主决策票（T01-T10）与研究票（TR1/TR2）已关闭。四个先验裁决（D1 双模 / D2 证据分级+OCR闸门 / D3 教学单元 / D4 学期切片）+ D5 数据出境已落定。

### 实现状态（全部落地 ✅）

四波编排 + 接线闭环，全产品实现完成：

| 波次 | 票 | 内容 | 落地 commit |
|------|----|------|------------|
| 1 | T01 | 产品数据模型地基（Attempt 聚合根 + Drizzle schema + 迁移） | `7c1b7bd` |
| 2 | T02/T03/T09 | 认证会话 / 题库系统 / 标准解析 | `c33f89c` |
| 3 | T04/T05/T06 | 扫描导入 OCR / 三层 AI 辅导 / 学情自动闭环 | `7e446bf` |
| 4 | T07/T08 | 学生刷题体验 / 教师工作流 | `3b3f84f` |
| 接线 | — | 主路由挂载 7 模块 + 前端工作台入口 | `wiring + ui` |
| 评审修复 | — | 生产认证后门关闭 / 错题本占位过滤 / 归属校验 / paperId 显式字段 | `5c98b22` |
| 贯通 | T07 | attemptId 评价路径 + D1 掌握度分流 + 前端双模入口 | `e2c0102+` |

**验证基线**：tsc 0 错误 / lint 0 问题 / vitest 442 tests green / vite build ✓。

**铁律守护落地**（CI 测试断言）：
- D1 双模：练习态证据不进正式 MasteryProfile（架构测试 + MistakeBook 只认 assessment 判对）
- T05 物理隔离：辅导 generator 不接触打分路径，产物 `llm_inference` provenance，永不回写 score
- T08 主观题终裁：`teacher_annotation` 写 `result.teacherAnnotation`，**不进 `result.score`**，provenance 不翻转，单份批改无批量 API（结构性禁止）

**仍未通电（建设期项，非本轮范围）**：真实 LLM provider 密钥（现 `LocalFeedbackGenerator` 模板 + `OpenAICompatible` 骨架待配 `LLM_API_KEY`）；真实 OCR 服务（现 `MockOcrProvider`，`createOcrProvider` 按 `OCR_PROVIDER` 切 Mathpix/Paddle）；生产数据库（现 SQLite，接口隔离可换 Postgres）。

剩余 fog 均为建设期可定的次级项，不阻塞。

## Out of scope

<!-- 出界，不 graduate；重画目的地才以新 effort 回归 -->

- 老师间题库共享（先私有，规模化再说）
- 多校 / SaaS 化
- AI 自动出题（题目来源限定老师导入/扫描）
- 支付 / 商业化
- 直播 / 录课 / 社交（PK / 排行榜）
- 遗忘曲线之外的学习科学模型
