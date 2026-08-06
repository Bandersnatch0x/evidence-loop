# CONTEXT

## Domain language
- **循证环 · EvidenceRing / 循证实训 Agent**: AI+教育赛道作品。学习者提交代码/数学/作文后，系统用可验证证据驱动评分、诊断和再训练。
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
- **TeachingUnit / 教学单元（D3）**: 组织单位 = 班级 × 学科 × 学期。教学业务保持两层角色（学生/老师，无校级管理员）。`taughtKpIds` 承载 D4 已教知识点集合，未教 KP 学情不报警。
- **PublicationReview / 发布审核流**: 私有草稿 → 提交审核（`submitted`）→ 审核员批准（`approved`，成为当前发布版本）或驳回（`rejected`，附理由，草稿可修改）→ 修改后重新提交为新审核轮次。同一教学演示最多一个待审版本。已发布作品的更新 = 提交新版本再审；旧发布版本在新版本获批前继续展示并接受既有固定引用，获批后停止接受新引用。驳回与批准都只改变版本状态，不改变版本内容。
- **PublicLibraryReviewer / 公共库审核员**: 平台级内容治理角色，只负责公共教学演示的审核、下架与申诉，不进入教学组织，不管理学校、成绩或教学账号。
- **PracticeSession / 练习场次（T07）**: 由 Attempt 元数据派生（非独立存储），一题一交（single）或成套打包（paper）。练习态开 AI 辅导（不入正式掌握度），测评态裸做（入正式掌握度）——D1 双模在 UI 明确标识。
- **MistakeBook / 错题本（T07）**: 错题按 KP/学科自动归集。掌握规则守 D1——仅连续 N 次**测评态**判对才移出活跃本，练习态通过不算。
- **TeachingDemonstration / 教学演示**: 教师创作成品的小型聚合根，承载作者、当前管理元数据、来源链及草稿与版本的生命周期关系；自身不内嵌持续变化的场景/视频内容或历史版本。它关联唯一的独立草稿和多个独立版本。删除只隐藏作品身份；草稿、版本或外部固定引用仍在使用的内容与素材 blob 必须保留，只有不再受任何保留引用保护且超过保留期后才能回收。派生公共作品会创建新的教学演示和草稿，并永久记录来源版本；派生作品生命周期、审核和发布独立，可共享不可变素材 blob。采用多维分类：格式为可编辑场景或视频；场景空间为 2D 或 3D；行为为静态、动画或互动，因此可准确表达“3D 动画”等组合。题目与知识点引用它的已发布版本，但它不从属于题库，也不进入评分证据链。
- **DemonstrationDraft / 演示草稿**: 与一个教学演示一对一关联的独立可变聚合，支持专业编辑器频繁保存；不能被题目、知识点或公共库直接引用。
- **DemonstrationVersion / 演示版本**: 与一个教学演示关联的独立版本聚合；其内容是在提交审核时从演示草稿生成的不可变、可播放快照，包含标题、说明、多维分类、许可、场景/视频内容和素材清单。审核只改变版本状态，不改变版本内容，教师可继续编辑草稿。候选版本获批时只使该版本成为当前发布版本；提交后继续编辑的草稿保持不变，不回退、不覆盖也不自动合并，并在后续提交时形成新版本。同一教学演示最多一个待审版本，再次提交前必须等待或撤回。公共库只展示最新发布版本；旧发布版本停止接受新引用，但已有题目和知识点固定引用继续播放。后续修改必须形成新版本。
- **MediaAsset / 素材**: 可被多个教学演示复用的独立资源身份，如图片、模型、音频、纹理或视频。实际文件按内容哈希保存为不可变 blob；草稿和演示版本引用具体 blob，替换文件必须产生新内容引用，因此历史版本不会静默变化。删除只隐藏素材身份；被草稿、待审版本、已发布版本或固定引用使用的 blob 必须保留，只有零引用且超过保留期后才能物理回收。素材不是教学演示成品，不能代替演示的组合、交互与版本语义。
- **teacherAnnotation / 教师终裁（T08）**: 主观题人工终裁分，写 `EvaluationResult.teacherAnnotation`（`teacher_annotation` provenance），**独立于 `result.score`（客观自动分）**，不折叠、不批量、`requiresTeacherConfirmation` 门。补 AdvisoryLayer 缺的人工终裁环。
- **PublicReference / 公共引用**: 题目或知识点对公共教学演示的引用，建立时固定为当时的最新发布版本（记录作品 ID + 具体发布版本 ID），内容不可变；上游发布新版本后，既有引用继续播放旧版本内容，绝不静默漂移，仅显示「有新版本可用」并允许教师手动确认后升级引用到新版本。引用是外链式固定版本，教学演示不从属题库。
- **上游更新通知**: 引用处（题目/知识点编辑界面与引用列表）显示「有新版本」徽标，同时向引用者发平台站内消息（复用 T14 站内消息通道或公共库通知中心）；教师逐条确认升级或忽略，不自动更改引用。
- **派生作品来源链**: 派生作品永久记录「来源作品 + 来源具体版本 + 原作作者」；公共库与派生详情页显示「派生自《源作品》vX · 原作作者」归属；派生版本的许可不得严于来源版本许可（继承或放宽），除非作者已移除全部来源内容。AI 参与披露照常必填。
- **源作品失效语义**: 源作品下架、删除、撤回许可或作者账号失效时，已固定引用与已发布派生继续播放，不自动删除、不改写历史；引用处显示「源不可用」状态标记并通知引用者，可保留或替换；新引用与新派生随即停止。版权侵权或违法违规经裁定后审核员可强制处置，届时通知受影响引用者并限期替换，替换期后播放位显示故障态。
- **AIAssistantBoundary / AI 创作助手边界**: AI 是可选创作助手，可生成结构化场景对象（几何/素材参数/节点图）、参数化动画时间线（补间数据）与编排元数据（标题/说明/多维分类/封面选择）；不生成可执行脚本、插件或运行时求值代码（脚本沙箱能力未定，延后）；不生成题型与判分逻辑。产物为可编辑草稿，教师确认后才保存或发布，不直接发布内容。
- **AI 草稿机制**: AI 对场景文档做结构化操作（创建/替换节点、设置属性），每次生成写草稿检查点快照；教师可逐项接受/拒绝或整体回滚到任一检查点；提交审核时展示「AI 生成 · 教师已确认」来源标注（ADR-0015 同立场，`llm_inference` provenance）。
- **AI 可用性与配额**: 模型未配置、超限或超时时，生成入口显示能力禁用说明，不阻塞手动编辑（降级为手动作业）；每教师每时段生成次数与 token 上限，配额在创建生成请求前预留，超配额提示（v1 仅提示不收费）；与票 03 上传配额「先预留后完成」同构。
- **AI 安全边界**: LLM 只能输出预定义结构化 JSON（zod 信任边界，同 visualizationSchema 模式），生成物只含确定性数据、无脚本可注入；用户描述文本作数据不作指令，与系统指令隔离；生成涉及的素材上传/引用复用票 03 门禁（类型白名单、扫描、fail-closed）；教师确认是发布前强制关卡，AI 参与披露随审核证据面板走（票 04）。
- **公共库元数据**: 强制字段 = 标题/说明、学科、学段（年级段）、知识点（可选关联现有 KnowledgePoint）、多维分类（格式可编辑场景|视频 × 空间 2D|3D × 行为 静态|动画|互动）、作者、许可、来源（原创/派生自）、健康状态；派生与质量信号为附加非强制字段。检索 = 字段加权 + 全文；筛选 = 结构化 facet（学科/学段/格式/空间/行为/许可）。
- **元数据维护**: 作者提交时填写标签与元数据，审核员在证据面板核对并修正后随版本冻结；知识图谱自动建议仅作辅助提示，不自动写库。
- **发现与质量信号**: 默认排序 = 结构化相关性（学科/学段/知识点匹配）优先，质量信号用「被引用次数」（引用需教师显式确认，是可信信号）、审核状态、健康状态；播放/收藏热度只作辅助展示，不参与默认排序；预览点击后加载（不自动拉取外链）；收藏与派生入口明确区分，派生必须记录来源链（票 08）。
- **专业 3D 深度**: 采纳 **PlayCanvas 引擎迁移**（Q4 裁决，覆盖 Q1 的 R3F 保留选项）：首版产品内含网格拓扑/UV/骨骼创建等专业 DCC 能力，配套 PlayCanvas Editor 能力或引擎 API 自建编辑器；承担引擎迁移、后端适配、资源格式迁移与团队重学成本，v1 交付期相应拉长。不再默认保留 Three.js/R3F 为 3D 创作内核；播放端/运行时边界由后续票 06/07/10 细化。
- **动画与导入边界**: 产品内动画使用 PlayCanvas 动画系统（骨骼动画、形态键、参数化补间与关键帧均可产品内编辑）；glTF 2.0 白名单导入（复用票 03 GLB 门禁的资源上限与解析思路），不支持的扩展/特性（高级粒子、IK、自定义 shader）明确拒绝或显式降级为静态显示并提示，绝不静默错渲染；降级资产在播放端仍保证可播。发布快照含 glTF 源引用与导入后的场景文档。
- **创作工作台交互模型（票 06）**: 桌面工作台三区布局——左：对象树 + 资源面板（MediaAsset 库/glTF 导入件）；中：画布/视口（2D/3D 场景切换，PlayCanvas 运行时）；右：属性检查器 + 动画时间线（补间/关键帧）+ AI 起稿抽屉（票 09 边界）；顶栏：公共库检索/派生（票 11 筛选 + 票 08 来源链）、预览、版本保存、提交审核（票 04）。教学可理解性：预置模板场景 + 向导式「建场景 → 加对象 → 调动画 → 预览 → 提交」五步引导，AI 起稿一键落草稿。
- **学生播放器运行时（票 07）**: 统一播放器确定性解释静态 2D/3D 场景（SVG/glTF/PlayCanvas）、时间线补间动画与视频编排（封面/章节/播放区间，不剪辑）；作者可开放预定义互动类型（相机旋转/缩放、视角切换、步骤显隐、对象点击高亮），不开放任意脚本（与票 09 一致，脚本沙箱未定）。确定性渲染——场景文档全部内容确定性求值（固定相机/灯光/材质参数，无随机或环境依赖）；资源预算 = 节点/三角面/纹理像素/动画时长上限（复用票 03 GLB 门禁阈值思路，v1 配置化）；首屏只加载入口场景与必需资源，章节/视频/3D 模型按需懒加载；超预算资产拒绝加载并显示降级提示，不静默截断。播放控制统一（播放/暂停、时间轴跳转、章节跳转、全屏——全端原生控件）；低性能降级分级（完整 3D → 简化渲染 → 静态替代物，能力探测决定并提示）；桌面/平板/手机渲染同一份场景文档，视口自适应不改场景语义，跨端结果一致。无障碍替代：alt 文本/静态封面/WebVTT 字幕 + 文字替代视图，WCAG AA、颜色不单独表意、非指针替代，降级路径合并。评分链隔离（铁律）：播放器零耦合评分路径——不产生/接收/透传 evidence/score/Attempt/MasteryProfile，播放行为至多匿名展示统计不进证据链，不做 render_artifact；播放器不接收学生提交；题型引用演示为纯展示语义。新播放器替代旧 Visualizer registry，迁移期按票 05 分类走适配器/只读兼容，不长期双轨。
- **SceneDocument / 场景文档（票 10）**: 产品自有规范化 JSON 文档，唯一事实源——编辑器写入、版本快照冻结、播放器只读求值、AI 起稿产物、导入导出归一格式全部指向同一文档；纯数据、确定性、零脚本（无引擎私有序列化/脚本，换内核 = 换解释器）。开放标准承载资产内容（SVG 子集/glTF 2.0/WebVTT/LaTeX 子集/JSON），产品 schema 承载编排语义（对象树/时间线/互动/媒体编排/编辑器元数据），显式命名空间 + 版本化。zod 信任边界校验（hard 拒存/soft 提示），读时容错降级；能力协商 full→simplified→static-alternative→refuse 加载前完成；N-2 版本向前迁移（读旧版本内存纯迁移、永不回写快照）；导入 glTF 2.0 白名单（票 03 门禁）+ SVG 子集，导出发布快照 + 静态封面，只承诺资产级 round-trip；零脚本、URL/字体白名单、SVG 无实体展开（XXE 防御）、资源上限。
- **DemonstrationReference / 演示引用（票 12）**: `Question`/`KnowledgePoint` 与 `DemonstrationVersion` 多对多有序引用，`role: primary|supplementary`（每题最多 1 主 + 补充上限 8）；引用对象 = 作品 ID + 版本 ID 复合固定（同票 08），建立时固定当时最新发布版本；教师可为自己私有题绑定已发布公共作品或本人私有版本，学生不可绑定；回退链 静态封面 → 文字替代视图 + 「源不可用」标记与通知；仅存新表 `demonstration_references`（questionId|kpId + demoVersionId + role + order），与题目判定数据物理隔离，绝不进入 QuestionType/Runner/Rubric/Evidence；架构测试守护评分路径零读取引用表。
- **演示模块架构（票 14）**: 同部署新模块 `server/demonstration/`（领域服务 + store，对齐 questionbank 模式），`server/media/` 保留扩展（paths.ts CAS 契约不可改，新增 BlobStore/UploadStore/MediaProcessor 接口，v1 FsBlobStore 生产换 S3）；前端 TeacherStudio 教师路由专属 chunk / StudentPlayer 只读；审核员用 `public_library_reviewer` 标志列不扩 role 枚举；migration 0008+（teaching_demonstrations 小根 / demonstration_drafts 一对一 / demonstration_versions 不可变快照 / 媒体族 / demonstration_references）；API：创作/审核/检索 /api/library/媒体 tus/引用升级端点；expand-contract 迁移（Phase E 双读：无损转换映射 SceneDocument、适配器加「新引用表优先、旧字段回退」只读分支 → Phase C 写路径切换、学生生成入口裁决去留、旧列删除 → 回滚逐文件、不覆盖用户改动）；架构测试守护评分路径零读演示表、播放器零写。
- **发现与播放交互（票 13）**: 教师侧题目/知识点编辑器内嵌共用「教学演示」抽屉（facet+全文检索→预览→主/补充引用→拖拽排序→二次确认移除；版本徽标手动升级、源不可用置灰保留播放）；学生侧主演示题干下方静态封面+手动播放、解析/知识点页补充折叠列表，唯一只读播放器、来源徽标（作者+许可+版本/我的演示）只影响展示不影响能力；桌面流式内嵌、移动不悬浮不嵌套不自动全屏；原型 = 复用票 06 壳的可点击 HTML 高保真（5 条闭环路径 + mock 检索 + 1 真实 PlayCanvas 场景 + 2 静态 SVG），3–5 名教师 60–90 分钟任务走查 + 结构化访谈，2 天内完成。

## 治理权限
- **发布审核**：作者提交/撤回自己的待审版本；`PublicLibraryReviewer` 批准、驳回、下架并处理申诉；任何登录用户可举报，举报进入审核员队列；作者可主动下架自己的已发布作品，但公共固定引用继续播放。不引入校级管理员参与公共库治理。
- **审核证据面板**：批准/驳回时审核员看到版本快照可播放预览、素材清单（blob hash/类型/尺寸/处理状态）、外链引用与健康状态、来源链（派生作品显示源版本与归属）、版权/许可声明与 AI 参与披露、举报与历史审核记录；永不暴露学生、成绩或教学组织私有数据。
- **版权、许可与归属**：每个上传素材声明来源（原创/已授权/可自由使用）与许可；版本整体选择一个分发许可（v1 固定白名单，如 CC BY 系列，具体集合另定）；AI 参与披露为提交必填；派生作品强制记录来源版本并在公共库显示归属。外链视频平台只保存引用与编排元数据，播放权责与内容责任在 provider 与作者声明。

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
- **T03 题库 + T09 标准解析**（已闭合，报告见 `docs/product-roadmap/reports/T03|T09-implementation-report.md`）：老师私有题库（共享出界），7 题型校验+组卷+教师手录 UI（工作台「题库录入」）；`Question.solution` 可选，AI 辅导 RAG 挂解析降幻觉，无解析标 `llm_inference` + 免责徽章；老师可「采纳 AI 讲解」为 `source:authored` 标准解析。主进程 `seedDemoProduct` 冷启动灌预置库。
- **T04 扫描导入 OCR**（已实施）：纯 Node 文档解析（.docx/PDF 文本层，无出境）+ `OcrProvider` 接口（Mathpix 可出境/Paddle 本地/Mock），草稿→教师逐题确认→入库闸门（D2）。
- **T05 三层 AI 辅导**（已实施，骨架待通电）：讲解/苏格拉底/对话；D1 仅练习态开放（mode gate 403）；物理隔离——辅导 generator 不接触打分路径，产物 `llm_inference`，永不回写 score/evidence；模板 fallback。`OpenAICompatible` 骨架待配 `LLM_API_KEY`。
- **T06 学情自动闭环**（已实施）：`NextPracticeService` = FSRS due ∩ 依赖链薄弱点 ∩ D4 已教进度；`AssignByWeaknessService` 聚合班级薄弱 KP → 组卷 → 批量布置占位 Attempt（未提交不入掌握度）。
- **T07 学生刷题体验**（已实施，报告见 `docs/product-roadmap/reports/T07-implementation-report.md`）：`PracticeSessionService` + `MistakeBookService` + 前端 `StudentWorkbench`（今日该练 / 双模入口 / 错题重练 / 练习态提交前求助）。成套计时交卷 UI 仍为增强项。
- **T08 教师工作流**（已实施，报告见 `docs/product-roadmap/reports/T08-implementation-report.md`）：`TeachingUnitService`（D3 + 列表）+ `StudentImportService`（T02 激活码）+ `AssignmentService`（三布置；预置库可布置）+ `SubjectiveGradingService`（终裁不进 score）+ 前端 `TeacherWorkbench`（选/建单元→题库→名单→布置→批改）。Demo：`tu-demo` 归属 `teacher-demo`。
- **T11 T08 评审扫尾**（P4/S2/S1）：Cohort 正式中位分排除待终裁主观题（`pendingAdjudication`）；布置 `studentIds` 必须在 enrollment 内；`assembleManual` 认预置库。
- **T12 T08 评审剩余**（P1/P2/P3/S3）：布置 `dueAt`；建单元自动建行政班；名单 CSV 上传；Gradebook 主观满分可编辑。
- **T13 T08 评审收口**（P5/P6/S6）：终裁 `signature` HMAC；成绩/激活码 CSV 导出；list 装配缺失抛错。
- **T14 教师批量发提示**（**IMPLEMENTED**，见 `docs/product-roadmap/reports/T14-implementation-report.md`）：站内消息通道，TeachingUnit 范围 fan-out + 学生收件箱；永不写 score。短信/推送/家长端出界。
- **接线闭环**（已实施）：`server/index.ts` 主路由挂载 7 个 `handle*Api`（auth/questions/tutoring/import/adaptive/student/teacher）；`productDb` 独立 SQLite 连接承载 questions/auth/org 表；前端 Sidebar 新增学生/教师工作台入口。烟测 `tests/routeWiring.test.ts` + 端到端链路验证。
- **attemptId 评价贯通**（已实施）：`POST /api/evaluations` 接受可选 `attemptId`，就地更新 Attempt 并保留 mode/paperId；`EvidenceProjector` 按 D1 分流（practice 只喂 FSRS，assessment 才重算正式 MasteryProfile）。学生工作台双模入口 → 工作台提交自动带 attemptId。
- **验证基线**：tsc 0 / lint 0 / vitest 442 tests green / vite build ✓。

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
