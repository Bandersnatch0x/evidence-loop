# 循证环 · EvidenceRing · 专家问答库

> 决赛现场答辩备稿，按评审 5 维度组织。每条问答均可直接念出口；`支撑` 列出现场可指给评委的代码路径 / 数据 / 演示动作 / 文档。`铁律映射` 对应开场六条铁律：①证据打分 ②LLM 不改分 ③练习≠正式掌握 ④终裁不折叠 ⑤提示不是分 ⑥PII 不出境。
> 覆盖赛道要求来源：[competition-requirements.md](./research/competition-requirements.md)「评审关注」5 条。
> 未实现功能一律按"有意后置、诚实说边界"原则回答，不假装已做。

---

## 维度一 · 行业场景价值

### Q1.1：AI+教育已经有一堆产品，循证环的差异化场景价值到底是什么？

**A：** 别家把算力花在让 AI 老师更像人，我们把工程花在让分数更像证据。一句话定义：学生作答之后，系统用题型 Runner 产出可复现的证据，分数只来自这些证据；大模型可以辅导讲解，但永远不能改分。我们不是又一个对话即分数的聊天家教，而是可解释、可审计、可复现的评分闭环。这在自动批改越权改分、练习与考试掌握度混计、教师缺少可审计终裁的当下，是真实痛点。

**支撑：** 口播稿 [DEMO-oral-10min.md](./DEMO-oral-10min.md) 0:00–0:40 开场铁律段；[CONTEXT.md](../CONTEXT.md) Domain language「Evidence / Runner / Rubric」。

**铁律映射：** ①②

### Q1.2：自动批改给对错、AI 讲评给反馈，这些市面上都有，你们到底解决了什么没被解决的问题？

**A：** 现有产品有三道暗箱：第一，AI 讲评越权改分，学生不知道分是模型编的还是算出来的；第二，练习和考试掌握度混计，练着练着就算考了；第三，教师终裁被自动分淹没，看不清哪一题是机器给的、哪一题是老师裁的。循证环把这三道暗箱全部显式化：分数只来自证据、练习与测评硬分流、终裁与客观分并列不折叠。我们解决的不是"能不能批改"，而是"分数能不能被信任、能不能被审计"。

**支撑：** [DEMO-live-script.md](./DEMO-live-script.md) Q1/Q2/Q3；D1 双模对照表；`pendingAdjudication` 门禁。

**铁律映射：** ①②③④

### Q1.3：为什么死磕"分数可信"？一线老师真的在意 LLM 改不改分吗？

**A：** 非常在意。分数是教育里最敏感的信任载体--它决定升学、决定家长沟通、决定教师问责。一旦分数来源不可解释，老师就要花大量时间为"模型觉得你 80 分"兜底。我们把分数锚定在可复现证据上，等于把"为什么是这个分"变成可回答的问题：测试用例过没过、CAS 校验等不等于零、linter 命中哪条。这对老师是减负，对学生是公平，对机构是合规底线。

**支撑：** 现场演示练习态求助前后 score 不变（验收信号）；[COMPLIANCE.md](./COMPLIANCE.md)「评分与模型边界」。

**铁律映射：** ①②

### Q1.4：练习和测评分流（D1）在业务上到底解决了什么问题？

**A：** 解决"刷题污染正式成绩"。传统系统里学生随便练一练，练习记录就被算进掌握度，导致掌握画像虚高或失真。我们做硬分流：练习态可以开 AI 辅导、可以喂 FSRS 复习调度，但不进入正式 MasteryProfile；只有测评态（作业/成套测评）才进正式掌握度。UI 用徽章显式标识，避免"练着练着变成考了"。错题本移出也守这条--仅连续 N 次测评态判对才算掌握。

**支撑：** [DEMO-oral-10min.md](./DEMO-oral-10min.md) 1:40–3:20 练习态段；[CONTEXT.md](../CONTEXT.md)「PracticeSession / MistakeBook」；`tests/architecture.test.ts` 守护"练习态证据字节级不进正式掌握度"。

**铁律映射：** ③

### Q1.5：教师终裁为什么不做"一键全班给分"？效率难道不比审计重要吗？

**A：** 我们故意不做批量一键给分，因为终裁是责任行为，不是灌分工具。一旦支持一键给分，老师就不再逐题确认，终裁退化成橡皮图章，审计链也就断了。我们的做法是终裁写入 `teacherAnnotation`、带来源与签名语义、与自动算出的 `score` 并列--老师看得到哪是机器分、哪是人工裁，改了哪一题、什么时候改的、谁改的，全可追溯。效率我们用 CSV 导出和学情面板补，但分数权威不让步。

**支撑：** [DEMO-oral-10min.md](./DEMO-oral-10min.md) 7:20–8:30 终裁段；`SubjectiveGradingService` 终裁不进 score；T13 终裁 `signature` HMAC。

**铁律映射：** ④

### Q1.6：目标用户和可持续使用场景在哪？这能变成一个真应用雏形吗？

**A：** 目标用户是中小学/高校实训学员、任课教师与助教，以及需要可复用 Agent 模板的课程和产品团队。场景痛点是自动批改只给对错、AI 讲评易幻觉越权、练习考试混计、教师缺可审计终裁。我们已交付可演示可验证的任务闭环：布置→作答→证据分→辅导/重练→终裁/学情，覆盖代码到多学科客观/主观题。赛道要求"形成可持续使用的应用雏形"，我们对应的不是 PPT 功能清单，而是能现场跑通的闭环。

**支撑：** [SUBMISSION_GUIDE.md](./SUBMISSION_GUIDE.md) 目标用户/场景痛点/核心任务闭环；[ROADMAP.md](./ROADMAP.md) 已完成项。

**铁律映射：** 无（场景价值题）

### Q1.7：和现有 LMS/作业平台比，你们的护城河是什么？会不会被轻易复制？

**A：** 护城河不是某个功能，而是"证据优先评分"这条架构红线和它配套的守护测试。LMS 平台加一个 AI 批改容易，但要把"LLM 永不碰分、练习测评硬分流、终裁不折叠、PII 不出境"变成 CI 里硬性拦截的契约，需要从头重构评分闭环。我们把这六条铁律做成了架构守护测试和 feature flag 红线--碰分数的 Agent 一旦被标成允许 LLM，构建就红灯。这是别人短期抄不走的工程纪律，不是模型能力。

**支撑：** `tests/architecture.test.ts`（ADR-0006 双聚合根隔离）、`tests/multimodal-flag-smoke.test.ts`（ADR-0005）；`GET /api/transparency/agents` CI 契约测试。

**铁律映射：** ①②⑥

---

## 维度二 · Agent 能力与任务闭环

### Q2.1：你们的 Agent 编排到底是什么？是不是套了一层 LLM 做调度？

**A：** 不是套层 LLM。核心编排是 `EvaluationAgent` 的五步闭环：读取任务→受限验证→量规评分→知识匹配→反馈生成。只有第 5 步反馈生成允许读写记忆，第 3、4 步严格"仅本次证据"。对外我们又把这五步切分成五个 Agent 对外命名：评分、诊断、辅导、组卷推题、教师建议。每张卡写清三件事：输入、输出、禁止事项。这是现有模块的对外切分，不是新增了 Agent 框架或多进程编排。

**支撑：** [CONTEXT.md](../CONTEXT.md)「EvaluationAgent」；[DEMO-oral-10min.md](./DEMO-oral-10min.md) 附录 D 多 Agent 插播；`GET /api/transparency/agents`。

**铁律映射：** ①②

### Q2.2：五步闭环里到底哪步用 LLM？为什么这么切？

**A：** 第 1 步读取任务是纯数据；第 2 步受限验证是 Runner（Docker/子进程/CAS/linter），确定性、零 LLM；第 3 步量规评分是 Rubric 权重汇总，零 LLM；第 4 步知识匹配是把失败证据映射到薄弱知识点，确定性；只有第 5 步反馈生成可调用 LLM 生成讲解文案，且产物标 `llm_inference`。这么切是为了让"碰分的步骤"和"碰模型的步骤"在架构上物理隔离--评分步永远只看本轮证据，记忆和模型只在反馈调味里出现。

**支撑：** [CONTEXT.md](../CONTEXT.md) Boundaries「不让评估闭环步 3、步 4 读取记忆」；[COMPLIANCE.md](./COMPLIANCE.md)「评分与模型边界」。

**铁律映射：** ①②

### Q2.3：五个 Agent 怎么协作？有没有一个中心 LLM 做调度？

**A：** 没有中心 LLM 调度。五个 Agent 各有明确边界：评分 Agent 是 `RunnerRegistry + Rubric`，确定性、零 LLM；诊断 Agent 做证据到薄弱知识点的映射；辅导 Agent 可用 LLM 但产物标 `llm_inference`；组卷推题 Agent 是 `NextPracticeService`，组合 FSRS due ∩ 依赖链薄弱点 ∩ 已教进度；教师建议 Agent 给干预建议不自动写成绩。协作靠的是共享数据契约（Evidence/Attempt/Provenance），不是 LLM 互相喊话。一句话：多 Agent 是分工，不是分数的多个来源。

**支撑：** [DEMO-cue-card.md](./DEMO-cue-card.md) 多 Agent 插播（T17）；`NextPracticeService` / `AssignByWeaknessService`。

**铁律映射：** ①②

### Q2.4：评分 Agent 零 LLM，那它还能叫"Agent"吗？不就是个判题器？

**A：** 它就是确定性判题器，我们故意不把它做成 LLM。Agent 的价值不在于"用不用大模型"，而在于有没有明确的能力边界和可审计的输入输出。评分 Agent 的输入是 submission，输出是 Evidence，禁止事项是"调用任何大模型"--这三件事写在代码目录里，是单一事实源，CI 还有契约测试盯着。赛道要的是"具备任务理解、流程编排、工具调用、结果交付能力的智能体"，我们五个 Agent 合起来覆盖整条闭环，评分这一环用确定性反而更可信、更可复现。

**支撑：** `GET /api/transparency/agents` 评分卡「禁止事项：调用 LLM」；[competition-requirements.md](./research/competition-requirements.md) 赛道定位。

**铁律映射：** ①②

### Q2.5：从布置到学情的任务闭环现场能端到端跑通吗？怎么验证？

**A：** 能，现场就走这条链：教师布置（手选/按知识点/按薄弱点）→学生作答（练习态或测评态）→Runner 产出证据→量规归约分数→练习态可求助不改分→错题重练/复习调度→教师终裁→班级学情。我们还有一条 E2E 自检脚本 `node scripts/e2e-demo-loops.mjs http://127.0.0.1:5280`，目标 16/16，上场前可以跑一遍证明闭环健康。验收信号也很具体：求助前后 score 不变、提示投递后成绩区无变化、终裁后客观分未被覆写。

**支撑：** [DEMO-live-script.md](./DEMO-live-script.md) 主演示路径 A–D；`scripts/e2e-demo-loops.mjs`；[DEMO-cue-card.md](./DEMO-cue-card.md) 验收信号。

**铁律映射：** ①②④⑤

### Q2.6：自适应推题怎么避免"推了就算掌握"这种典型漏洞？

**A：** 关键在于布置生成的是占位 Attempt，学生没交就不入掌握度。`NextPracticeService` 组合三个硬输入：FSRS 到期的复习项 ∩ 依赖链上的薄弱知识点 ∩ D4 已教进度，这三项全部可复现、全部来自证据。`AssignByWeaknessService` 聚合班级薄弱 KP 后批量布置，但同样是占位 Attempt，未提交不入 MasteryProfile。这样"推题"和"掌握"是两个独立动作，不会出现"老师布置了就当学生会了"。

**支撑：** [CONTEXT.md](../CONTEXT.md)「T06 学情自动闭环」「学习路径主干-调味分层」；[DEMO-live-script.md](./DEMO-live-script.md) Q8。

**铁律映射：** ③

### Q2.7：多模态语音指点算 Agent 能力吗？它和评分闭环什么关系？

**A：** 语音指点是辅导 Agent 的一个模态延伸，和评分闭环物理隔离。它走的是独立的语音管线：阿里云 NLS 做 STT、Web Speech 做 TTS，输出协议是 `[HIGHLIGHT][SPEAK][DISPLAY]`，只读证据和高亮、不改分。架构守护测试硬性拦截评分闭环 import 多模态模块，feature flag 一关全站回到复赛前状态。所以多模态是"辅导更自然"，不是"评分多了一个来源"。

**支撑：** [DEMO-multimodal-code.md](./DEMO-multimodal-code.md) 合规话术；`tests/architecture.test.ts` + `tests/multimodal-flag-smoke.test.ts`；ADR-0005 §5。

**铁律映射：** ②

---

## 维度三 · 产品体验与 Demo 完成度

### Q3.1：现场演示如果 LLM 失败或没网，Demo 还能跑吗？

**A：** 能。主评分闭环根本不依赖 LLM，LLM 只在辅导反馈里出现。求助慢或失败时我们的话术是"主评分不依赖大模型，我直接提交展示证据分"，然后走正常提交→Runner→证据→分数。多模态语音在无阿里云密钥或断网时切 Web Speech 兜底，再不行就 `MULTIMODAL_ENABLED=false` 整体关闭，评分闭环零回归。我们在 [DEMO-multimodal-fallback.md](./DEMO-multimodal-fallback.md) 里专门做了弱网演练。

**支撑：** [DEMO-oral-10min.md](./DEMO-oral-10min.md) 附录 C 故障插话「求助慢/失败」；[DEMO-multimodal-fallback.md](./DEMO-multimodal-fallback.md) 演练 A/B/C。

**铁律映射：** ②

### Q3.2：学生侧体验和"聊天式 AI 家教"比，会不会太重、不够自然？

**A：** 不会。学生工作台是聚合视图：老师提示、今日该练、练习场次、错题本在一个地方，不是让学生在聊天框里摸索。练习态可以求助，AI 会开口朗读讲解（点"朗读讲解"按钮），交互并不比聊天家教重。差别在于我们多了一个"分数区纹丝不动"的可视保证--学生在用 AI 的同时，能直观看到 AI 没有偷偷改分。这是体验上的信任感，不是负担。

**支撑：** [DEMO-oral-10min.md](./DEMO-oral-10min.md) 0:40–3:20 学生段；`StudentWorkbench` 前端组件（T07 报告）。

**铁律映射：** ②

### Q3.3：错题本和 FSRS 复习调度是真在跑，还是 mock 给评委看的？

**A：** 真在跑。错题本按 KP/学科自动归集，移出规则守 D1--仅连续 N 次测评态判对才移出活跃本，练习态通过不算。复习调度用 `ts-fsrs` 库，`mastery_scores` 表 + `simple.v1` 加权平均算法，`computeMastery()` 是纯函数。这些都是 T06/T07 已实施项，有集成测试守护。现场错题本点"重练"会进练习态，不会伪装成测评掌握。

**支撑：** [CONTEXT.md](../CONTEXT.md)「MistakeBook」「复赛只做硬事实」；T07-implementation-report.md；`server/review/*` + `server/mastery/*`。

**铁律映射：** ③

### Q3.4：成套测评的倒计时和统一交卷是真功能吗？是不是第二套计分？

**A：** 倒计时是 UI 仪式；交卷从 localStorage 仪式升级为**服务端确认**（`POST /api/student/papers/:paperId/submit`，`95765ea`）：校验卷面已布置 + 子女在读，统计已答/未答，写审计事件，返回只读报告投影。但**没有第二套计分 API** —— 每题的分数仍落在各自 Attempt 的评价闭环里（D1 双保险：练习态 Attempt 结构性不入卷）。成套是组织方式，Attempt 才是成绩聚合根。我们宁可把边界说清楚，也不用"成套测评"四个字暗示有另一套计分。

**支撑：** [DEMO-oral-10min.md](./DEMO-oral-10min.md) 4:20–5:10 成套段；[CONTEXT.md](../CONTEXT.md)「PracticeSession」；migration 0020 `paper_id/due_at`。

**铁律映射：** ①

### Q3.5：教师布置→发提示→终裁这条链路现场能完整走一遍吗？

**A：** 能，这是主路径的 C 段。教师侧用演示单元 `tu-demo`，布置作业支持手选题/按知识点/按薄弱点三种形态、可带截止时间、可指定学生；发提示支持多选或留空全班，发送后看到已投递人数；切回学生收件箱能看到新消息且成绩区无变化；主观题终裁写 `teacherAnnotation` 与 `score` 并列。如果现场某环数据为空，我们有故障插话：收件箱空就先在教师侧发一条，无待终裁就改讲数据模型。链路是通的，降级是有备的。

**支撑：** [DEMO-live-script.md](./DEMO-live-script.md) C 段；T08/T14-implementation-report.md；[DEMO-oral-10min.md](./DEMO-oral-10min.md) 附录 C。

**铁律映射：** ④⑤

### Q3.6：多模态语音现场如果没麦克风或断网，怎么不露怯？

**A：** 三级降级。第一级，阿里云 STT 失败就切 `STT_PROVIDER=webspeech`，用浏览器原生识别；第二级，Web Speech 也不行就用预录转写或英短句，或者在控制台触发 pipeline；第三级，现场完全无麦就走预录短视频或自动化测试。每级都有衔接口播句，比如"我切到浏览器本地识别"或"语音只读不改分，我直接展示证据区高亮"。核心是评分闭环不依赖语音，flag 关掉一切照跑，所以不会露怯。

**支撑：** [DEMO-multimodal-fallback.md](./DEMO-multimodal-fallback.md) 故障应急速查；[DEMO-weaknetwork-drill.md](./DEMO-weaknetwork-drill.md) 弱网演练清单。

**铁律映射：** ②

### Q3.7：Demo 用的是假会话和本地数据，怎么证明产品能用在真实课堂？

**A：** 我们诚实说边界：现场角色是演示用的假会话，有 `X-Security-Warning` 安全警告头，我们展示的是访问控制与审计模型，不是宣称已经上线生产级多租户和密钥托管。但模型本身是可迁移的：`SessionProvider` 接口便于替换为真实 CAS/JWT，`SqliteAttemptStore` 支持多实例，审计链和 PII 扫描是真代码不是 mock。真实课堂还需要数据分层存储、被遗忘权完整流程、机构授权--这些我们列在生产化前必需里，不假装已做。

**支撑：** [COMPLIANCE.md](./COMPLIANCE.md)「当前合规状态」「生产化前必需」；[DEMO-oral-10min.md](./DEMO-oral-10min.md) 8:30–9:20 诚实 50 秒段。

**铁律映射：** ⑥

---

## 维度四 · 技术实现深度与工程可复现性

### Q4.1：7 题型 Runner 怎么保证评分确定性和可复现？

**A：** 两层保证。第一层，Runner 接口是 `run(submission) -> Evidence[]`，必须确定性、可沙箱--同一提交同一环境跑两次结果一致。第二层，客观题用 `ObjectiveValidator`（answer_match，容差）、数学用 `ExpressionValidator`（CAS 校验 `simplify(step_n - step_{n+1}) == 0`）、化学方程式用 `ChemEquationValidator`、代码用 Python Runner 跑测试用例 + 静态检查、作文客观维度用 linter 管线。所有 Evidence 带 `provenance`，Rubric 按权重归约，全程零 LLM。集成测试 `tests/multiSubjectIntegration.test.ts` + `tests/multiDisciplineScoring.test.ts` 守护。

**支撑：** [CONTEXT.md](../CONTEXT.md)「Runner」「Evidence 外延扩展」；[COMPLIANCE.md](./COMPLIANCE.md)「多学科评分能力」表；ADR-0008。

**铁律映射：** ①②

### Q4.2：Docker 容器隔离到了什么程度？能防住恶意代码逃逸吗？

**A：** 复赛已落地真实 Docker daemon 集成。池容器用 `--network=none` 阻断外连，配合 `--memory=128m --cpus=0.5` 资源限制、只读根文件系统、受限 tmpfs、非 root 用户、`no-new-privileges`、capability 全量丢弃。验收测试 `tests/dockerDaemonAcceptance.test.ts` 5 用例覆盖 daemon 探活/镜像就绪→池预热真实提交→出站 TCP 隔离→逃逸提交被拒止→dispose 无残留。我们也诚实说边界：容器隔离不等于微虚拟机，Docker daemon 本身仍是高权限基础设施，`--network=none` 不等于"无任何网络接口"（loopback 仍在）。公开生产部署前还需镜像签名、daemon 隔离等加固。

**支撑：** [COMPLIANCE.md](./COMPLIANCE.md)「运行安全」「Docker 模式剩余边界」；`server/runner/DockerPythonRunner.ts` `buildDockerRunArgs`/`verifyNetworkIsolation`；`scripts/accept-docker.mjs`。

**铁律映射：** 无（技术深度题）

### Q4.3：审计哈希链 + HMAC 怎么防篡改？现场能演示吗？

**A：** 审计日志存在 `.data/audit.sqlite`，SQLite WAL 模式 + 哈希链（每条记 `prevHash`）+ HMAC-SHA256 签名，异步批量写入（5 秒或 100 条 flush）。防篡改的原理是改任何一条都会断链，`verifyIntegrity()` 能检测出来。教师/管理员可通过 `GET /api/audit?studentId=&from=&to=` 查询。生产环境缺 `AUDIT_HMAC_SECRET` 会 fail-fast 拒绝启动；`tamperForTest` 后门仅 `:memory:` 库 + 非生产可用，文件库或生产调用即抛错。现场可打开审计查询接口指给评委看记录结构。

**支撑：** [COMPLIANCE.md](./COMPLIANCE.md)「真审计日志」；`server/audit/AuditStore.ts` `verifyIntegrity()`/`tamperForTest()`；CONTEXT「已实施的生产化加固」。

**铁律映射：** 无（技术深度题）

### Q4.4：双聚合根隔离（ADR-0006）是架构测试守护的吗？怎么保证不被破坏？

**A：** 是。`MasteryProfile`（硬事实）和 `LearnerNarrative`（软语义）不可交叉写入。`computeMastery()` 是纯函数 `(Evidence[]) => number`，`server/mastery/*` 和 `server/review/*` 不得 import `server/memory/*`、`mem0ai`、`@xenova/transformers`、`ollama`。`tests/architecture.test.ts` 在 CI 中硬性拦截违规，失败消息直接指向 ADR-0006。这不是文档约定，是构建级红线--有人偷偷在掌握度里调 LLM，CI 立刻红灯。

**支撑：** [CONTEXT.md](../CONTEXT.md)「记忆与自适应 #2」「Boundaries」；`tests/architecture.test.ts`。

**铁律映射：** ①②

### Q4.5：代码仓库能一键复现吗？评委拿到代码需要什么环境？

**A：** 能。`scripts/reproduce.mjs` 一键跑全链：lint→test→build→budget→e2e→启动冒烟，跨平台可跳步。`docs/DEPLOYMENT.md` 写清数据布局、SQLite 迁移、端口与 ABI 坑、隔离运行器、零外网运行。本地启动就三步：`npm install` → `$env:PORT='5280'; npm run dev` → 浏览器开 `http://127.0.0.1:5280`。环境要求 Node 20、better-sqlite3 ^11（v13 会段错误）、可选 Docker daemon 跑容器运行器、可选 LLM_API_KEY 跑辅导（不配也能离线跑）。

**支撑：** [SUBMISSION_GUIDE.md](./SUBMISSION_GUIDE.md) 本地演示段；[ROADMAP.md](./ROADMAP.md) 复赛第 5 项；`scripts/reproduce.mjs` / `docs/DEPLOYMENT.md`。

**铁律映射：** 无（工程可复现题）

### Q4.6：FSRS 复习调度和知识点 DAG（121 个 kp）是怎么结合的？

**A：** 知识点 DAG 存在 `data/knowledge-points.seed.json`，121 个 kp 按九门学科归属，带前置依赖关系。复习调度上，`NextPracticeService` 取的是三个集合的交集：FSRS 到期该复习的项 ∩ 依赖链上还没掌握的薄弱 kp ∩ D4 已教进度（`taughtKpIds`，未教的不报警）。这样推出来的下一题既符合记忆曲线，又针对薄弱点，还不会推没教过的内容。`computeMastery()` 按知识点层级加权平均，`mastery_scores` 表存结果，可重算。

**支撑：** [CONTEXT.md](../CONTEXT.md)「TeachingUnit（D4）」「复赛只做硬事实」「T06 学情自动闭环」；`data/knowledge-points.seed.json`。

**铁律映射：** ③

### Q4.7：你们说有五个 Agent，到底是真有 Agent 框架，还是现有模块换个名字？

**A：** 诚实说：是现有模块切分的对外命名，没有新增 Agent 框架，也没有多进程编排。评分 Agent 就是 `RunnerRegistry + Rubric`，诊断就是知识匹配，辅导就是 `AdvisoryService`/三层辅导，组卷推题就是 `NextPracticeService`，教师建议就是干预建议。我们不做多进程编排的宣称。但这个切分有真实价值：它把"谁能碰分"显式化了，目录是代码里的单一事实源，`GET /api/transparency/agents` 可拉，CI 契约测试盯着"碰分数的 Agent 不允许 LLM"。价值在边界清晰和可审计，不在"Agent"这个词。

**支撑：** [DEMO-cue-card.md](./DEMO-cue-card.md) 多 Agent 插播「不要说」注；[DEMO-oral-10min.md](./DEMO-oral-10min.md) 附录 D。

**铁律映射：** ①②

### Q4.8：Attempt 为什么是聚合根？比直接存 EvaluationResult 好在哪？

**A：** `EvaluationResult` 只是一次评分结果，承载不了业务约束。`Attempt` 是产品级做题单元，带四个判别字段：`mode(practice|assessment)` / `source(test_case|authored_key)` / `termId` / `teachingUnitId`，这四个字段承载了 D1-D4 全部约束。比如 `mode` 决定进不进正式掌握度，`source` 决定证据来源可信度，`teachingUnitId` 决定归属哪个班哪门课哪学期。`MasteryProfile` 和 `ReviewCard` 降为按 `mode` 分流的派生读模型。这样评分事实和业务上下文绑定在一起，不会出现"知道分但不知道这是练习还是考试"的脏数据。

**支撑：** [CONTEXT.md](../CONTEXT.md)「Attempt / 尝试（聚合根，T01）」；T01-implementation-report；`EvidenceProjector` 按 D1 分流。

**铁律映射：** ③

---

## 维度五 · 安全、合规与开放复用价值

### Q5.1：学生 PII 不出境怎么保证？是代码层面强制还是只是文档约定？

**A：** 代码层面强制。第一，PII 检测在入库前扫描 `summary`、`rejectionReason`、`evidence[].actual` 三个自由文本字段，命中中文姓名、手机号、邮箱、学号即拒绝存储（返回 422）；学号正则已扩展到 8–12 位。第二，多模态语音后端不写原始音频到磁盘，审计只记 `durationMs`/`transcriptChars`/`piiHitCount` 不记转写原文，转写含 PII 时 STT finalize / PII 门返回 422 拒存。第三，我们诚实说边界：当前是 Demo 级 PII 检测，有意绕过（拼音/编码混淆）无法完全阻止，真上线前还需脱敏网关和数据分层。但"学生 PII 设计上不做出境"是架构意图，不是空话。

**支撑：** [COMPLIANCE.md](./COMPLIANCE.md)「PII 检测」「模态级数据治理」；`server/pii/PIIDetector.ts` `detectEvaluationPII`；CONTEXT「PII 检测已知边界」。

**铁律映射：** ⑥

### Q5.2：语音转写不落盘，那审计里到底能看到什么？教师面板能看到什么？

**A：** 审计事件含 `modality: 'text' | 'voice'`，语音会话只记三个元数据：`durationMs`（时长）、`transcriptChars`（字数）、`piiHitCount`（PII 命中数），不记转写原文，也不记音频路径。教师 `GET /api/cohort/multimodal-usage?classId=` 只返回 `{ studentId, voiceCount, lastVoiceAt }`，也就是只看到"谁用了几次语音辅导"，看不到说了什么。学生访问这个接口直接 403。前端对话历史走 IndexedDB，每条带 `expiresAt`（24h TTL），启动和 `beforeunload` 时 purge。`POST /api/multimodal/ask` 成功响应带 `X-Modality-Mode: voice` 标识。

**支撑：** [COMPLIANCE.md](./COMPLIANCE.md)「模态级数据治理（ADR-0005 §7 / 工单 021）」；[DEMO-multimodal-code.md](./DEMO-multimodal-code.md) 预期输出。

**铁律映射：** ⑥

### Q5.3：Demo 是假多租户，真上线怎么办？这条路走通了吗？

**A：** 假多租户是 `X-Demo-Role` 头 + `MockSessionProvider` 提供学生/教师/管理员三角色，所有响应带 `X-Security-Warning` 显式警告头，真审计日志仍记录伪角色操作。真上线路径已经留好：`SessionProvider` 接口便于替换为真实 CAS/JWT（T02 已实现 `RealSessionProvider` 生产版，scrypt 加盐 + HTTP-only cookie + 服务端 session）。但生产化前还必须完成数据分层存储（代码层 90 天 TTL / 分数层 5-7 年保留期）、被遗忘权完整流程、Mem0 集成前的脱敏网关、镜像签名和 daemon 隔离。我们不宣称已上线生产级，这条路是画清楚的，不是假装走完的。

**支撑：** [COMPLIANCE.md](./COMPLIANCE.md)「访问控制」「生产化前必需」；CONTEXT「T02 认证会话」「已实施的生产化加固」。

**铁律映射：** ⑥

### Q5.4：Apache-2.0 开源，别人能复用什么？哪些是不可改的红线？

**A：** 可复用的是 Runner/量规模板、知识点 seed（121 kp DAG）、ADR 决策文档、演示脚本和 E2E。模型和 STT 可替换--不配 `LLM_API_KEY` 完全离线可跑，STT 可在阿里云/Web Speech 间切。不可替换的红线是证据门禁与 D1/终裁红线：评分事实只来自 Evidence、LLM 不得改分、练习测评硬分流、终裁不折叠、PII 不出境。这些红线由架构守护测试在 CI 里硬性拦截，换 fork 也不能绕过。我们鼓励复用模板，但守住评分闭环的可信性。

**支撑：** [SUBMISSION_GUIDE.md](./SUBMISSION_GUIDE.md) 开源与复用段；`tests/architecture.test.ts`；[COMPLIANCE.md](./COMPLIANCE.md)「开源与第三方依赖」。

**铁律映射：** ①②③④⑥

### Q5.5：用了商业模型 API（阿里云 STT / LLM），怎么披露依赖？关键依赖断了怎么办？

**A：** 我们在材料里明确披露：可使用商业模型 API 但必须在材料中说明，模型与 STT 可替换。关键依赖层面，未配置 `LLM_API_KEY` 时完全离线可运行，主评分闭环不依赖任何外部模型；阿里云 STT 断了切 Web Speech 兜底，再不行关 `MULTIMODAL_ENABLED` flag 全站回归复赛前状态。所以商业 API 是"可摘掉的能力增强"，不是"摘了就瘫的硬依赖"。这也是我们把多模态做成 feature flag 红线的原因。

**支撑：** [COMPLIANCE.md](./COMPLIANCE.md)「开源与第三方依赖」「未配置 LLM_API_KEY 时完全离线可运行」；[DEMO-multimodal-fallback.md](./DEMO-multimodal-fallback.md) 演练 C。

**铁律映射：** ②

### Q5.6：被遗忘权做了吗？数据分层存储呢？

**A：** 被遗忘权 API 已实施：`DELETE /api/evaluations/:id`，学生仅可删自己的记录，教师/管理员可删任意，全程审计记 `result: success|denied|not_found`。但数据分层存储还没做--代码层（90 天 TTL，学生可提前删）和分数层（5-7 年保留期，不可由学生删）的分表、差异化 TTL、保留期策略未实施，这是生产化前必需项。我们诚实标注：被遗忘权提供了删除入口，但自动分层保留策略未做；这是边界，不是已完成的宣称。

**支撑：** [COMPLIANCE.md](./COMPLIANCE.md)「当前合规状态」表「数据分层存储 ⚠️ 未实施」「被遗忘权 ⚠️ 未实施」+ CONTEXT「已实施的生产化加固」被遗忘权 API ✅。

**铁律映射：** ⑥

### Q5.7：学生提交 Python 代码执行，怎么防恶意代码？能跑 `os.system('rm -rf')` 吗？

**A：** 默认本地 Python 子进程带超时、输出上限和基础静态约束，但我们明确说：默认模式没有内核级网络或资源隔离，不得直接暴露给不可信公网。真隔离靠 `PYTHON_RUNNER=docker`：预热容器池用 `--network=none`（`os.system` 外连会被阻断）、`--memory=128m --cpus=0.5`、只读根、`cap-drop=ALL`、`no-new-privileges`、非 root 用户。Docker 模式启动必须成功预热，daemon 或镜像不可用会阻止服务启动，不会静默降级到子进程。验收测试里有"逃逸提交被拒止"用例。我们也诚实说：容器隔离不等于微虚拟机，daemon 本身仍是高权限基础设施。

**支撑：** [COMPLIANCE.md](./COMPLIANCE.md)「运行安全」「Docker 模式剩余边界」；`tests/dockerDaemonAcceptance.test.ts` 出站 TCP 隔离 + 逃逸提交被拒止用例。

**铁律映射：** 无（安全题）

### Q5.8：合规边界里那些"未实施"的部分，会不会被认定为不安全、不能用于真实学生？

**A：** 不会，因为我们从不宣称当前能用于真实学生。当前 Demo 仅使用本地匿名样例，不连接真实学籍、成绩、身份认证或 LMS，`.data/` 被 gitignore。我们展示的是"访问控制与审计模型"和"评分闭环的可信架构"，不是"已上线的生产系统"。真处理学生数据前必须完成的措施--数据分层、被遗忘权完整流程、脱敏网关、机构授权、隐私政策--全部列在 [COMPLIANCE.md](./COMPLIANCE.md)「生产化前必需」里主动披露。诚实标注边界本身就是合规态度，也是我们的核心卖点。

**支撑：** [COMPLIANCE.md](./COMPLIANCE.md)「数据范围」「当前合规状态」「生产化前必需」；[DEMO-oral-10min.md](./DEMO-oral-10min.md) 8:30–9:20 诚实 50 秒。

**铁律映射：** ⑥

---

## 铁律六条快答卡（评委质疑时秒回，每条 ≤15 秒）

> 用法：评委一旦质疑某条铁律被破坏，直接念对应句，不要展开，先把立场钉死，再请评委看支撑。

### 铁律① · 证据打分

**快答：** 分数只来自 Runner 产出的可复现 Evidence（测试用例/CAS/linter/answer_match），不来自模型抽样，Rubric 按权重归约，全程零 LLM。

### 铁律② · LLM 不改分

**快答：** 辅导和评分物理隔离，LLM 产物一律标 `llm_inference`，永不回写 `score`/`evidence`/`MasteryProfile`；求助前后分数纹丝不动，现场可证伪。

### 铁律③ · 练习不等于正式掌握

**快答：** 练习态开辅导、喂 FSRS，但不进 MasteryProfile；只有测评态才进正式掌握度，错题移出也只认测评态连续判对。

### 铁律④ · 终裁不折叠进客观分

**快答：** 教师终裁写 `teacherAnnotation` 带 HMAC 签名，与自动 `score` 并列展示，不合并、不批量灌分，待终裁主观题排除在正式中位分外。

### 铁律⑤ · 提示不是分

**快答：** T14 站内消息只碰消息存储和已读状态，不写 `score`/`evidence`/`MasteryProfile`，发提示后学生成绩区零变化。

### 铁律⑥ · 学生隐私数据不出境

**快答：** 学生 PII 设计上不做出境，PII 扫描命中即拒存（422），语音不落盘、审计不记原文，本地匿名样例不接真实学籍。

---

## 相关文档

| 文档 | 用途 |
|------|------|
| [DEMO-oral-10min.md](./DEMO-oral-10min.md) | 10 分钟口播逐字稿（铁律六条来源） |
| [DEMO-cue-card.md](./DEMO-cue-card.md) | 一页现场卡点 + 脱口 Q&A |
| [DEMO-live-script.md](./DEMO-live-script.md) | 完整脚本 + Q&A 备稿 |
| [DEMO-weaknetwork-drill.md](./DEMO-weaknetwork-drill.md) | 弱网演练清单 |
| [DEMO-final-preflight.md](./DEMO-final-preflight.md) | 决赛现场 SOP |
| [COMPLIANCE.md](./COMPLIANCE.md) | 合规边界与实现一致性核对 |
| [CONTEXT.md](../CONTEXT.md) | 域语言与 Active decisions |
| [ROADMAP.md](./ROADMAP.md) | 已做/未做边界 |
| [research/competition-requirements.md](./research/competition-requirements.md) | 赛道评审 5 维度 |
