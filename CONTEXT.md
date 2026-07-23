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

## Active decisions

### 合规基础设施（#5，复赛）
- 评分事实只来自 Runner 产出的 Evidence，LLM 不得改分或捏造事实。
- 当前 Demo 使用本地 JSON 与匿名样例，不连接真实学籍或成绩系统。
- **容器选型（复赛）**：Docker + `--network=none` + 资源限制（`--memory=128m --cpus=0.5`），配合容器池化实现 50-200ms 延迟目标。
- **审计日志**：SQLite WAL 模式 + 哈希链（`prevHash`）+ HMAC-SHA256 签名，异步批量写入队列（5 秒或 100 条批量 flush）。
- **访问控制（Demo）**：假多租户（硬编码 3 个角色）+ 显式警告响应头（`X-Security-Warning: Demo environment - no authentication`），真审计日志记录假角色操作。
- **PII 检测（Demo）**：基础正则检测（中文姓名、手机号、邮箱、学号），入库前扫描 `summary`/`rejectionReason`/`evidence[].actual` 3 个字段，检测到 PII 拒绝存储。

### 多学科扩展（#1，Phase 1 复赛/Phase 2 决赛）
- **Evidence 外延扩展**：`Evidence.type` 枚举包括 `test_case | static_check | cas_check | answer_match | lint_result | structural_metric`。CAS 校验（`simplify(step_n - step_{n+1}) == 0`）与 linter 结果同属可复现验证。
- **多学科统一抽象**：所有学科走 `Runner + Rubric` 模式，评分闭环同构。学科差异下沉到 Runner 实现和 Evidence 子类型。
- **作文分层**：客观证据层（40% 权重，字数/句长/语法/结构等 linter 结果）+ 主观建议层（`AdvisoryLayer`，不入分，教师终裁）。
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
- **生产化前必需**（当前未实施）：
  - 数据分层存储（代码层 90 天 TTL，分数层 5-7 年保留期）
  - 被遗忘权 API（`DELETE /api/evaluations/:id`）
  - Mem0 集成前的脱敏网关（仅发送"脱敏后的问题模式"，不是代码片段）
  - 多模态 Phase 2 数据治理补全（canvas 图像 PII 检测；机构级被遗忘权覆盖语音元数据）
  - **审计 HMAC 密钥 fail-fast**：当前缺失 `AUDIT_HMAC_SECRET` 时静默 fallback 到硬编码 demo 密钥（`AuditStore.ts`）。生产模式必须改为缺失即抛错，否则审计签名形同虚设。
  - **移除 `AuditStore.tamperForTest` 后门**：篡改方法当前暴露在生产 API 上（用于演示链断裂检测）。生产化前应移到测试专用子类或加"仅 `:memory:`/非生产"运行时守卫。
- **PII 检测已知边界（Demo 级）**：学号正则仅匹配 `20` 开头的 8 位数字（`piiDetector.ts`），9–12 位、`19` 开头或其他格式的学号会漏报。中文姓名依赖上下文标记+边界匹配，有意绕过（拼音/编码/分隔符混淆）无法阻止——与 ADR-0003"有意绕过无法阻止"一致。
- **结构性风险**：代码结构、语音声纹、手写笔迹都是不可完全消除的身份指纹（重新识别风险）——这是主动披露的固有风险，不是可消除的漏洞。
