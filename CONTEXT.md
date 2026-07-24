# CONTEXT

## Domain language
- **EvidenceLoop / 循证实训 Agent**: AI+教育赛道作品。学习者提交代码/数学/作文后，系统用可验证证据驱动评分、诊断和再训练。
- **Evidence / 证据**: 由 Runner 产出的可复现验证结果——包括测试用例、静态检查、CAS 校验（数学）、结构化 linter（作文）等。是唯一评分事实来源。
- **Runner / 受限验证器**: 学科无关的验证接口 `run(submission) → Evidence[]`。必须确定性、可沙箱。实现包括 `CodeRunner`（Docker + 测试）、`MathRunner`（CAS 子进程）、`EssayRunner`（linter 管线）。术语从"受限运行"泛化为"受限验证"以覆盖非执行场景。
- **Rubric / 量规**: 由维度与权重构成的确定性评分规则。学科无关。
- **AdvisoryLayer / 建议层**: LLM 生成的主观建议（作文立意、写作洞察等无硬证据的维度），不入正式分，需教师确认后才计入 Cohort 指标。与 LearnerNarrative 是同一概念的不同侧面（前者面向单次评估，后者面向长期画像）。
- **Diagnosis / 知识诊断**: 把失败证据映射到薄弱知识点。
- **Intervention / 干预任务**: 下一轮最短修复任务，不自动改分。
- **Cohort / 班级学情**: 教师视图，展示完成率、中位分和关注队列。
- **MasteryProfile / 掌握度画像**: 硬事实聚合根。`masteryLevel: number` 由确定性算法从 Evidence[] 计算，携带 `evidenceRefs[]` 可溯源，`algorithm` 版本可重算。
- **LearnerNarrative / 学习者叙事**: 软语义聚合根。LLM 从会话/反思文本抽取的偏好、情感、上下文推断。与 MasteryProfile **不可交叉写入**。
- **Provenance / 来源标注**: 学情事实的强制字段，四种类型：`evidence` / `llm_inference` / `learner_self_report` / `teacher_annotation`。TypeScript 层面必填，不允许可选。
- **EvaluationAgent**: 编排"读取任务 → 受限验证 → 量规评分 → 知识匹配 → 反馈生成"的五步闭环。仅第 5 步允许读写记忆；步 3、4 严格"仅本次证据"。
- **SubmissionForm / 提交形态**: `text | latex | dom-structured | canvas-stroke | canvas-image`。DOM-structured 是数学 MVP 的必建域概念，为后续 CAS 解析提供中间表示。
- **Attempt / 尝试（聚合根，T01）**: 产品级做题单元，取代裸 `EvaluationResult`。四个必填判别字段 `mode(practice|assessment)` / `source(test_case|authored_key)` / `termId` / `teachingUnitId` 承载 D1-D4 全部约束。`MasteryProfile`/`ReviewCard` 降为按 `mode` 分流的派生读模型。
- **TeachingUnit / 教学单元（D3）**: 组织单位 = 班级 × 学科 × 学期。两层角色（学生/老师，无校级管理员）。`taughtKpIds` 承载 D4 已教知识点集合，未教 KP 学情不报警。
- **PracticeSession / 练习场次（T07）**: 由 Attempt 元数据派生（非独立存储），一题一交（single）或成套打包（paper）。练习态开 AI 辅导（不入正式掌握度），测评态裸做（入正式掌握度）——D1 双模在 UI 明确标识。
- **MistakeBook / 错题本（T07）**: 错题按 KP/学科自动归集。掌握规则守 D1——仅连续 N 次**测评态**判对才移出活跃本，练习态通过不算。
- **teacherAnnotation / 教师终裁（T08）**: 主观题人工终裁分，写 `EvaluationResult.teacherAnnotation`（`teacher_annotation` provenance），**独立于 `result.score`（客观自动分）**，不折叠、不批量、`requiresTeacherConfirmation` 门。补 AdvisoryLayer 缺的人工终裁环。

## Active decisions

### 合规基础设施（#5，复赛）
- 评分事实只来自 Runner 产出的 Evidence，LLM 不得改分或捏造事实。
- 当前 Demo 使用本地 JSON 与匿名样例，不连接真实学籍或成绩系统。
- **容器选型（复赛）**：Docker + `--network=none` + 资源限制（`--memory=128m --cpus=0.5`），配合容器池化实现 50-200ms 延迟目标。
- **审计日志**：SQLite WAL 模式 + 哈希链（`prevHash`）+ HMAC-SHA256 签名，异步批量写入队列（5 秒或 100 条批量 flush）。
- **访问控制（Demo）**：假多租户（硬编码 3 个角色）+ 显式警告响应头（`X-Security-Warning: Demo environment - no authentication`），真审计日志记录假角色操作。
- **PII 检测（Demo）**：基础正则检测（中文姓名、手机号、邮箱、学号），入库前扫描 `summary`/`rejectionReason`/`evidence[].actual` 3 个字段，检测到 PII 拒绝存储。

### 多学科扩展（#1，Phase 1 复赛/Phase 2 决赛）
- **已实施（7 题型 + 9 学科）**：`QuestionType` 七种引擎（`choice` / `fill_blank` / `numeric` / `expression` / `chem_equation` / `code` / `essay`）经 `RunnerRegistry` 贯通；`assignments` 覆盖 math / physics / chemistry / chinese / english / biology / politics / history / geography 九门，每门至少一道可评分 demo；知识点 DAG 121 个 kp 挂载于 `data/knowledge-points.seed.json`；集成测试 `tests/multiSubjectIntegration.test.ts` + `tests/multiDisciplineScoring.test.ts` 守护评分闭环（ADR-0008）。
- **Evidence 外延扩展**：`Evidence.type` 枚举包括 `test_case | static_check | cas_check | answer_match | lint_result | structural_metric`。CAS 校验（`simplify(step_n - step_{n+1}) == 0`）与 linter 结果同属可复现验证。
- **多学科统一抽象**：所有学科走 `Runner + Rubric` 模式，评分闭环同构。学科差异下沉到 Runner 实现和 Evidence 子类型；**按题型切分评分，不按学科切分**（ADR-0008）。
- **作文分层**：客观证据层（字数/句长/语法/结构等 linter 结果入正式分）+ 主观建议层（`AdvisoryLayer`，`provenance: llm_inference`，`requiresTeacherConfirmation`，不入分，教师终裁）。历史/政治论述同构。
- **视觉指点 Phase 1**（已实施）：DOM 标注优先，输出协议 `[HIGHLIGHT:selector][SPEAK:...][DISPLAY:...][NONE]`。语音走阿里云 NLS/火山引擎（Web Speech API 中文场景国内不可用），Web Speech 仅作兜底。核心评分闭环对 `server/multimodal/*`、`server/stt/*` 的隔离与 `MULTIMODAL_ENABLED` Feature Flag 红线由 `tests/architecture.test.ts` + `tests/multimodal-flag-smoke.test.ts` 守护（失败指向 ADR-0005）。
- **模态级数据治理 Phase 1**（已实施，ADR-0005 §7 / 工单 021–023）：审计 `modality: text|voice`（仅元数据：时长/字数/PII 命中数，无转写原文）；`X-Modality-Mode: voice`；后端音频不落盘；前端 IndexedDB 对话 24h TTL；教师 `GET /api/cohort/multimodal-usage` 只显示次数；演示脚本见 `docs/DEMO-multimodal-*.md`。
- **手写数学 Phase 2**：canvas 局部截图 + 视觉 LLM + stroke 数据辅助。Phase 2 上线前需新 ADR 处理笔迹隐私分类；canvas 图像 PII 检测属 Phase 2。
- **红线**：所有多模态代码 feature flag 一键关闭，主评分闭环绝不因语音重构而回归失败。

### 记忆与自适应（#2，复赛硬事实/决赛语义层）
- **双聚合根强制隔离**：`MasteryProfile`（硬事实）与 `LearnerNarrative`（软语义）不可交叉写入。`MasteryProfile.compute()` 是纯函数 `(Evidence[]) → number`，CI 加架构测试守护。
- **Provenance 必填**：所有学情事实携带 `provenance` 字段，TypeScript 层面强制非可选。
- **学习路径主干-调味分层**：`candidateTasks`（下一题）只由硬输入决定必须可复现；软输入只影响 `presentationHint`（UI 文案节奏）。
- **复赛只做硬事实**（已实施）：`mastery_scores` 表 + `simple.v1` 加权平均算法 + 知识点层级/前置依赖表 + `ts-fsrs` 复习调度。`computeMastery()` 保持纯函数 `(Evidence[]) → number`，`server/mastery/*` 与 `server/review/*` 对 `server/memory/*`、`mem0ai`、`@xenova/transformers`、`ollama` 的隔离由 `tests/architecture.test.ts` 架构守护测试在 CI 中强制（失败指向 ADR-0006）。
- **决赛加语义层**：借鉴 Mem0 v3 设计（Integrity Rules、UUID→整数反幻觉、entity linking、BM25+embedding 混合检索），在 SQLite 上用 `sqlite-vec` 扩展 + `@xenova/transformers` 本地 embedding 自建。**不引入 Mem0 运行时依赖**。
- **同库不同前缀**：语义层与 evaluations 同 SQLite 数据库，`memory_*` 表前缀隔离，复用哈希链审计。
- **UI 三色系统**：evidence（蓝盾牌）/ llm_inference（灰气泡）/ self_report（绿）/ teacher_annotation（橙）。教师面板提供"只看证据层"开关。

### 产品化（学生刷题 + AI 辅导 + 教师学情，T01-T08 已实施）
决策地图见 `docs/product-roadmap/PRODUCT-MAP.md`（状态 IMPLEMENTED ✅）。四波编排 + 接线闭环：
- **T01 数据模型地基**（已实施）：`Attempt` 聚合根 + Drizzle schema + 迁移；四判别字段承载 D1-D4；`JsonEvaluationStore→JsonAttemptStore` expand-contract；架构测试守护"练习态证据字节级不进正式掌握度"。
- **T02 认证会话**（已实施）：学号/邮箱+密码，scrypt 加盐，HTTP-only cookie + 服务端 session；学生账号老师批量导入 + 激活码强制改密；`RealSessionProvider`（生产）/ `MockSessionProvider`（dev-only）。
- **T03 题库 + T09 标准解析**（已实施）：老师私有题库（共享出界），7 题型表单，智能组卷；`Question.solution` 可选，AI 辅导 RAG 挂解析降幻觉，无解析标 `llm_inference` + 免责徽章。
- **T04 扫描导入 OCR**（已实施）：纯 Node 文档解析（.docx/PDF 文本层，无出境）+ `OcrProvider` 接口（Mathpix 可出境/Paddle 本地/Mock），草稿→教师逐题确认→入库闸门（D2）。
- **T05 三层 AI 辅导**（已实施，骨架待通电）：讲解/苏格拉底/对话；D1 仅练习态开放（mode gate 403）；物理隔离——辅导 generator 不接触打分路径，产物 `llm_inference`，永不回写 score/evidence；模板 fallback。`OpenAICompatible` 骨架待配 `LLM_API_KEY`。
- **T06 学情自动闭环**（已实施）：`NextPracticeService` = FSRS due ∩ 依赖链薄弱点 ∩ D4 已教进度；`AssignByWeaknessService` 聚合班级薄弱 KP → 组卷 → 批量布置占位 Attempt（未提交不入掌握度）。
- **T07 学生刷题体验**（已实施）：`PracticeSessionService`（session 由 Attempt 派生）+ `MistakeBookService`（D1 掌握规则）+ 前端 `StudentWorkbench`（双模入口 + 错题本）。
- **T08 教师工作流**（已实施）：`TeachingUnitService`（D3）+ `StudentImportService`（复用 T02 导入 + 补 Enrollment）+ `AssignmentService`（三布置 shape）+ `SubjectiveGradingService`（主观题终裁环，守铁律）+ 前端 `TeacherWorkbench`（建单元→导名单→布置→批改四标签）。
- **接线闭环**（已实施）：`server/index.ts` 主路由挂载 7 个 `handle*Api`（auth/questions/tutoring/import/adaptive/student/teacher）；`productDb` 独立 SQLite 连接承载 questions/auth/org 表；前端 Sidebar 新增学生/教师工作台入口。烟测 `tests/routeWiring.test.ts` + 端到端链路验证。
- **验证基线**：tsc 0 / lint 0 / vitest 427 tests green / vite build ✓。

### 通用
- **教师视图**：只提供干预建议，不自动写入正式成绩。

## Boundaries
- 不把本地 Python 子进程描述为生产沙箱。
- 不把模型反馈当作正式分数。
- 不把 LLM 生成的作文建议当作正式分数——`AdvisoryLayer` 必须经教师确认后才计入 Cohort 指标。
- 不让语义记忆层承载 mastery 数值或改分——LLM 抽取的软语义只用于 tutoring prompt 调味。
- 不让评估闭环步 3（量规评分）、步 4（知识匹配）读取记忆——仅步 5（反馈生成）可读写记忆。
- 不发送学生代码原文/canvas 图像/语音音频给云端 LLM——必须经脱敏网关（"脱敏后的问题模式"）。
- 不把评估成功后的历史/学情刷新失败当成整轮失败。
- **已实施的生产化加固**：
  - ✅ **被遗忘权 API**（`DELETE /api/evaluations/:id`）：学生仅可删自己的记录，教师/管理员可删任意，全程审计（`result: success|denied|not_found`）。
  - ✅ **审计 HMAC 密钥 fail-fast**：`NODE_ENV=production` 且缺失 `AUDIT_HMAC_SECRET` 时抛错拒绝启动；非生产才 fallback 到 demo 密钥（`resolveAuditHmacSecret`）。
  - ✅ **`tamperForTest` 生产守卫**：仅 `:memory:` 库 + 非生产可用，文件库或生产环境调用即抛错——篡改后门不再作为生产 API 存在。
  - ✅ **PII 学号正则扩展**：从仅 `20` 开头 8 位，扩展到 8–12 位纯数字（排除与手机号重叠的 11 位 `1` 开头），覆盖更多学号格式。
- **生产化前仍未实施**：
  - 数据分层存储（代码层 90 天 TTL，分数层 5-7 年保留期）——被遗忘权 API 已提供删除入口，但自动分层保留策略未做。
  - Mem0 集成前的脱敏网关（仅发送"脱敏后的问题模式"，不是代码片段）——Mem0 语义层本身是决赛内容，无调用点，暂缓。
  - 多模态 Phase 2 数据治理补全（canvas 图像 PII 检测；机构级被遗忘权覆盖语音元数据）——Phase 2 手写功能未落地，暂缓。
- **PII 检测已知边界（Demo 级）**：学号正则已扩展到 8–12 位，但中文姓名仍依赖上下文标记+边界匹配，有意绕过（拼音/编码/分隔符混淆）无法阻止——与 ADR-0003"有意绕过无法阻止"一致。
- **结构性风险**：代码结构、语音声纹、手写笔迹都是不可完全消除的身份指纹（重新识别风险）——这是主动披露的固有风险，不是可消除的漏洞。
