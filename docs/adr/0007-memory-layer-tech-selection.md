# ADR 0007：记忆层技术选型

## 状态

已采纳（覆盖 #2 记忆与自适应方向的技术实现）

## 背景

ADR-0006 从域建模层面定义了双聚合根、Provenance、路径分层等边界规则。技术实现需要回答：
- 记忆层部署方案：Mem0 OSS vs 借鉴架构自建
- 本地 LLM 依赖：Ollama vs 云端
- 间隔复习算法：SM-2 vs FSRS
- 掌握度数据模型 schema
- 与 #5 合规工单的协同

Mem0 研究关键结论（详见 `docs/research/mem0-memory-architecture.md`）：
- License Apache-2.0，可完全本地部署
- v3 架构（ADD-only + entity linking + BM25+embedding 混合检索）优于论文所述 v2
- 已移除图数据库依赖
- OSS 效果依赖闭源平台优化，OSS 榜单低于平台
- 警示"retrievable by design，敏感值先加密/哈希"

## 决策

### 1. 不引入 Mem0 运行时依赖，TS 自建轻量语义索引层

**决策**：借鉴 Mem0 v3 的 4 个设计，在既有 SQLite 上用 `sqlite-vec` 扩展 + `@xenova/transformers` 自建。

借鉴的设计：
1. **ADDITIVE_EXTRACTION_PROMPT 的 Integrity Rules**（反捏造 prompt）
2. **UUID → 顺序整数映射**（反幻觉设计）
3. **Entity linking 加权检索**
4. **BM25 + embedding 混合检索**

**理由**（按权重排序）：
- **技术栈一致性**：项目是 TS + Node 原生 HTTP，Mem0 OSS 完整能力在 Python 侧成熟，引入意味着多加 Python 微服务或接受 TS 分支能力打折——1 个月复赛窗口不合算
- **合规立场对齐**：语义层做小、逻辑在 TS 单进程里，比引入 Qdrant/Ollama/pgvector 更容易在评审中说清数据流
- **可审计性**：#5 已用 SQLite WAL + 哈希链做审计。记忆层同库时 `JOIN audit_log ON memory_entries` 一条 SQL 就能溯源
- **Mem0 平台价值不可复现**：README 明说 OSS 不含闭源优化，榜单只在平台达标——拿 OSS 也只是"方向一致"，不如直接借鉴设计
- **技术依赖**：`sqlite-vec`（纯 C 扩展，SQLite 官方生态最成熟的向量方案）+ `@xenova/transformers`（~30MB WASM，本地 embedding，完全离线）

### 2. 间隔复习算法：`ts-fsrs`

**决策**：直接引入 `ts-fsrs` 库（MIT，Anki 现役默认算法），不自建。

**理由**：
- FSRS 比 SM-2（1985 年算法）精度高约 30%，SuperMemo 官方已弃用 SM-2
- FSRS 是白盒模型（三参数：Difficulty/Stability/Retrievability），教师微调改 config 即可
- `ts-fsrs` MIT、纯 TS、无依赖，与项目栈完美对齐
- FSRS 输出是**派生事实**（纯函数 `(reviewLog) → { stability, difficulty, dueDate }`），符合可复现原则

**关键命名**：FSRS 参数字段命名为 `SchedulingState`（调度状态），**不叫 MasteryLevel**——避免与 `MasteryProfile.masteryLevel` 混同。前者优化复习间隔，后者反映知识掌握，服务不同目的，通过 provenance 区分。

### 3. 本地 LLM 依赖：默认云端 + 脱敏网关 / Ollama 演示切换

**决策**：抽取阶段做"两档策略"。

- **默认档**：云端小模型（Claude Haiku / GPT-4o-mini）+ **脱敏网关**（仅发送"脱敏后的问题模式摘要"，绝不发送学生代码原文）
- **演示档**：Ollama 本地 LLM（配置 `LLM_PROVIDER=ollama|cloud` 运行时切换）

**理由**：
- Mem0 v3 抽取的 LLM 调用对应本项目"从辅导会话/反思文本抽偏好/情感"，本身就该走脱敏网关
- Ollama 本地抽取平均 1-3s/次，评审若问"用户体验"会扣印象分；云端 haiku 能压到 300-500ms
- 抽取是低频写路径（一天一学员几十次），云端小模型月成本可忽略
- 评委问"能不能全本地？"直接切 Ollama 演示一遍，两全其美

**边界**：绝不发送学生代码原文/canvas 图像/语音音频给云端——这是 ADR-0005 已确立的合规边界。

### 4. 掌握度数据模型

**决策**：新增独立表 `mastery_scores`，不复用 `evaluations` 视图；知识点层级用邻接列表 + 应用层拓扑排序，不引入图数据库。

Schema：

```sql
-- 知识点表（含层级依赖）
CREATE TABLE knowledge_points (
  id TEXT PRIMARY KEY,           -- 'kp.recursion.base_case'
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES knowledge_points(id),  -- 层级树
  weight REAL DEFAULT 1.0
);

-- 前置依赖（DAG，不限于树）
CREATE TABLE kp_prerequisites (
  kp_id TEXT NOT NULL REFERENCES knowledge_points(id),
  prereq_id TEXT NOT NULL REFERENCES knowledge_points(id),
  strength REAL DEFAULT 1.0,     -- 依赖强度 0-1
  PRIMARY KEY (kp_id, prereq_id)
);

-- 掌握度快照（append-only，可审计）
CREATE TABLE mastery_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id TEXT NOT NULL,        -- 假多租户 ID
  kp_id TEXT NOT NULL REFERENCES knowledge_points(id),
  score REAL NOT NULL,             -- 0-1
  evidence_ids TEXT NOT NULL,      -- JSON 数组，引用 evaluations.id
  computed_at TEXT NOT NULL,
  algorithm_version TEXT NOT NULL, -- 'simple.v1' | 'bkt.v1'
  prev_hash TEXT,                  -- 复用 #5 的哈希链模式
  hmac TEXT
);
CREATE INDEX idx_mastery_student_kp ON mastery_scores(student_id, kp_id, computed_at DESC);
```

**理由**：
- 语义完全不同：`evaluations` 是"一次评分事件"，`mastery_scores` 是"某学生某知识点的当前状态"
- Append-only + 哈希链复用 #5 已有设计，讲故事时"mastery 变化也是可复现证据"一句话
- SQLite 3.8+ 支持递归 CTE，拓扑排序应用层 200 行 TS 搞定
- 依赖强度允许"递归以 0.8 依赖函数"（软依赖），诊断算法可算"薄弱链"
- 算法版本字段：MVP 用 `simple.v1`（加权平均），后续换 BKT/IRT 不破坏历史数据

### 5. 与 #5 合规工单的协同

**决策**：
- **同一个 SQLite 数据库**（`evidence-ring.db`），**独立表命名空间**（`memory_*` 前缀）
- **记忆写入必须走 #04 的 PII 检测**，且更严格——检测到 PII 直接拒绝存储 + 记录 PII 类型到审计日志
- **审计日志覆盖记忆写入**：`memory.add / memory.search / memory.delete / memory.reject_pii / mastery.update` 全部走哈希链 + HMAC

**理由**：
- 单一备份/迁移路径（评审时"数据完整性怎么保证"一句话答完）
- Join 查询免费（`SELECT * FROM audit_log JOIN memory_entries ON ...`）
- WAL 事务保证跨表原子性
- 语义层"retrievable by design"意味着 PII 一旦入库必然可检索出来——检测必须前置且比 evaluations 更严（异步失败用户看不到）
- 不引入 pgvector/Qdrant/Redis 作独立向量库，`sqlite-vec` 扩展让向量索引也在同一 `.db` 文件

### 6. Phase 分期

**复赛（5-7 工日）——只做硬事实**：
| 优先级 | 事项 | 工作量 |
|--------|------|--------|
| P0 | `mastery_scores` 表 + `simple.v1` 加权平均算法 | 2 天 |
| P0 | 知识点层级 + 前置依赖表 + 拓扑排序 + `suggestNextIntervention()` | 1 天 |
| P1 | `ts-fsrs` 集成 + `review_cards` 表 | 1.5 天 |
| P1 | CONTEXT 更新 + "MVP 不做语义记忆层"边界文档 | 0.5 天 |

**复赛明确不做**：
- 不做任何 LLM 抽取
- 不做 embedding / 向量检索
- 不做 entity linking
- 不引入 `sqlite-vec` / `ollama` / `mem0ai`

**决赛——增强**：
| 优先级 | 事项 | 工作量 |
|--------|------|--------|
| P0 | `sqlite-vec` + `@xenova/transformers` 语义索引层 | 3 天 |
| P0 | 借鉴 Mem0 Integrity Rules 的 TS extraction prompt + 脱敏网关 + 云端 LLM 抽取 | 2 天 |
| P1 | BM25 + embedding 混合检索 | 2 天 |
| P2 | BKT 或 IRT 替换 `simple.v1` | 3 天 |
| P2 | 教师侧知识图谱可视化（把 `kp_prerequisites` 画成 DAG） | 2 天 |

## 后果

### 正面
- 不引入 Python 微服务，部署与运维复杂度不增加
- 复赛话术天然对齐铁律："MVP 只落硬事实，语义层是决赛增强"，评委不会追问"为什么不上 Mem0"
- 决赛话术亮点："借鉴 Mem0 v3 的 4 个设计，200 行 TS 在既有 SQLite 上自建，全程本地、全程可审计、全程与硬事实分离"
- FSRS 输出可作为"你今天该复习什么"的证据可视化，符合"证据驱动"精神

### 代价
- 自建的语义层能力不如 Mem0 平台完整版
- `sqlite-vec` 需要原生模块编译（macOS/Windows 打包需处理）
- FSRS 需要 ~1000 条历史 review 数据才能自适应个人参数（MVP 用默认参数即可）

## 相关决策

- ADR 0001：证据优先评分（本 ADR 的价值观基础）
- ADR 0002：容器隔离选型（SQLite WAL 存储的性能验证）
- ADR 0003：Demo 级别合规方案（哈希链审计与 PII 检测的复用）
- ADR 0006：Provenance-tagged learner facts（本 ADR 是其技术承载）
