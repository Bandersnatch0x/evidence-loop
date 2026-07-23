# Mem0 记忆架构调研与"学情画像"场景适配评估

> 调研对象：Mem0（`github.com/mem0ai/mem0`）
> 调研快照日期：2026-07-22（对应仓库 `main` 分支当日状态）
> 服务对象：EvidenceLoop（循证实训 Agent，AI+教育）
> 方法：一手来源优先（GitHub 源码 / docs.mem0.ai 官方文档 / 官方 arXiv 论文），每条结论标注来源，未证实点显式标注。

---

## 0. 结论速览（TL;DR）

- **Mem0 是"从对话中抽取语义事实"的记忆层**，不是"从可执行证据中计算事实"的系统。它的抽取被工程化地约束为"不得超出输入捏造"（Integrity Rules），但它**只对"输入的对话文本"负责，不对"事实是否可复现地为真"负责**。
- **重要时间线断层**：官方 arXiv 论文（2025-04）描述的是 **extraction + update 两阶段、LLM 用 tool call 决策 ADD/UPDATE/DELETE/NOOP** 的 v2 架构；而当前 OSS `main` 分支（"New Memory Algorithm", 2026-04 起）已改为 **单次 ADD-only 增量抽取 + entity linking + 多信号混合检索**，并**彻底移除了内置 graph memory**。二者是两代设计，必须分别看待。
- **License = Apache-2.0**，OSS 可**完全本地部署**（本地 LLM + 本地 embedding + 本地向量库 + SQLite），无需图数据库。
- **对"学情画像"的倾向性结论：混合（Hybrid），且以"结构化 DB 自建为主、Mem0 语义层为辅/借鉴为主"**。基于证据的掌握度计算、间隔复习调度、误解分类映射等"硬事实"必须留在结构化数据库自建（符合本项目"可复现证据"铁律）；学习偏好、动机/情感、会话式辅导上下文、往期 episodic 摘要等"软语义"可用 Mem0（本地部署）或借鉴其 extraction/linking/retrieval 架构自建。**绝不可让 Mem0/LLM 成为学情事实的 system of record，也不可让它回写覆盖 evidence-backed 数值。**

---

## 1. 核心架构：记忆流水线全貌

### 1.1 当前 OSS 实现（v3，"New Memory Algorithm"）——以源码为准

当前 `main` 分支的核心入口是 `Memory.add()`，其推理路径 `_add_to_vector_store()` 源码中明确标注为 **`=== V3 PHASED BATCH PIPELINE ===`**，是**单次 LLM 调用、只产生 ADD 事件**的增量抽取流水线。

阶段拆解（源码逐段）：
- **Phase 0 上下文采集**：取会话最近 10 条消息（`db.get_last_messages(..., limit=10)`）。
- **Phase 1 既有记忆召回**：对新消息做 embedding，向量检索 `top_k=10` 相关既有记忆；并把这些记忆的 **UUID 映射为顺序整数（注释原文 `anti-hallucination`）**，避免 LLM 幻觉编造记忆 ID。
- **Phase 2 单次抽取**：system prompt 用 `ADDITIVE_EXTRACTION_PROMPT`（agent 作用域时追加 `AGENT_CONTEXT_SUFFIX`），user prompt 由 `generate_additive_extraction_prompt(...)` 生成，要求返回 JSON `{"memory": [...]}`。**LLM 只做 ADD**，可为每条新记忆输出 `linked_memory_ids`（跨记忆关联）。
- **Phase 3 批量 embedding**：`embedding_model.embed_batch(...)`。
- **Phase 4/5 CPU 处理 + 去重**：对每条抽取文本做 `md5` hash，与既有 hash 及本批 hash 去重；同时生成 `text_lemmatized`（供 BM25）。
- **Phase 6 批量落库**：`vector_store.insert(...)`；写 history 记录，**event 恒为 `"ADD"`**。
  【来源：`github.com/mem0ai/mem0/blob/main/mem0/memory/main.py`，`_add_to_vector_store` L849-1050；`add` L735】

**存储分层分工（当前 OSS）**：
- **Vector store（语义层，主存储）**：默认 `qdrant`；记忆正文、embedding、metadata、hash、`text_lemmatized` 都存于此。【`mem0/vector_stores/configs.py` L7-16，`default="qdrant"`】
- **History DB（审计/变更历史）**：本地 **SQLite**，默认路径 `~/.mem0/history.db`（`history_db_path`）。记录每条记忆的 ADD/UPDATE/DELETE 历史。【`mem0/configs/base.py` L42-48】
- **Entity store（实体关联层）**：v3 新增。实体被抽取、embedding 并跨记忆链接（`_upsert_entity`、`_link_entities_for_memory`、`_compute_entity_boosts`），用于检索加权。这是 v3 用来**替代旧 graph memory** 的轻量关系机制——它复用向量库/内部集合，而非独立图数据库。【`mem0/memory/main.py` L558-706, L1703-1785】
- **KV / 结构化字段**：Mem0 本身没有独立 KV 层；user/session/agent 的区分是通过 metadata 上的 `user_id`/`run_id`/`agent_id`/`actor_id` 字段 + 向量库 filter 实现的（见 §2）。

**检索（retrieval）**：`search()` → `_search_vector_store()`，是**多信号混合检索**：
- 语义（dense embedding 相似度）
- **BM25 关键词**（`lemmatize_for_bm25` / `get_bm25_params` / `normalize_bm25`；Qdrant 后端需装 `fastembed` 生成稀疏向量，否则静默降级为纯语义）
- **entity matching 加权**（`_compute_entity_boosts`）
- 可选 **reranker**（`RerankerFactory`，`rerank` 默认 `False`）
默认 `top_k=20`、`threshold=0.1`。【`mem0/memory/main.py` L1349-1473, L480-522；`docs/migration/oss-v2-to-v3.mdx`】

### 1.2 更新与冲突合并（ADD/UPDATE/DELETE 决策机制）——两代差异（关键）

这是本项目最需要看清的一点：

**（A）论文/旧 OSS（v2）机制** —— *extraction + update 两阶段，LLM tool-call 决策四操作*：
> update 阶段对每条候选事实 `ω_i`，先向量召回 top `s=10` 相似记忆，连同候选事实经"function-calling / tool call"交给 LLM，由 **LLM 自行**在四种操作中择一：
> **ADD**（无语义等价记忆时新增）、**UPDATE**（用互补信息增强既有记忆）、**DELETE**（新信息与旧记忆矛盾时删除）、**NOOP**（无需改动）。不使用独立分类器，直接用 LLM 推理选操作。
> 【来源：arXiv:2504.19413 §3.1 Update Phase；Appendix B Algorithm 1（含 `operation = NOOP` 分支）】
> 该 prompt 仍以 `DEFAULT_UPDATE_MEMORY_PROMPT` / `get_update_memory_messages()` 形式**保留在** `mem0/configs/prompts.py`（L176-462，含 ADD/UPDATE/DELETE/NONE 与 `old_memory` 字段）。

**（B）当前 OSS（v3）机制** —— *ADD-only，取消每次写入的 LLM UPDATE/DELETE 决策*：
- **自动流水线不再做 UPDATE/DELETE**。`main.py` 只 import 了 `ADDITIVE_EXTRACTION_PROMPT` 与 `generate_additive_extraction_prompt`，**未** import `get_update_memory_messages`——即上面的 v2 update prompt 已**不再接入 add() 流水线**（成为遗留代码）。`add()` 事件只返回 `ADD`。
- 冲突/演化改由**其他机制**处理：抽取时把相关旧记忆的 UUID 传给 LLM 用于**去重与 linking**（`linked_memory_ids`，含 "Contradiction" 关系类型），矛盾/更新的信息作为**新记忆累积**、通过链接与时间戳标记，由**检索层的时间感知（temporal reasoning）挑选"当前正确"的那条**，而非在写入时覆盖旧记忆。README 原文："Memories accumulate; nothing is overwritten."
- **UPDATE/DELETE 仍存在，但只作为显式 API**：`Memory.update(memory_id, text=...)` 与 `Memory.delete(memory_id)` 是**确定性的、按 ID 的手动操作**，不含 LLM 决策。
  【来源：`mem0/memory/main.py` L735, L1785-1860（update/delete）；`README.md` "New Memory Algorithm (April 2026)"；`docs/migration/oss-v2-to-v3.mdx`（"add() events: Returns ADD only"）】

> 对学情场景的含义（先记一笔，§7 展开）：v2 的 UPDATE/DELETE 语义上更贴合"纠正误解、掌握度演化"，但它是**非确定性 LLM 决策**；v3 的 ADD-only 累积则会让"矛盾的学情结论"堆积、依赖检索层挑最新——**两代都不适合承载需要可复现、可审计的掌握度数值**。

### 1.3 论文提出的图变体 Mem0^g（注意：已不在 OSS）

论文还提出增强变体 **Mem0^g**：记忆存为**有向带标签图**，实体为节点、关系为边；extraction 阶段把消息转成 entities + relation triplets，update 阶段做冲突检测与消解。评测显示其在 temporal / open-domain 任务上更强。
【来源：arXiv:2504.19413 §2、§3.2、Figure 3】
**但当前 OSS 已移除该能力**（见 §4.3）。

---

## 2. 记忆类型与数据模型

**分层（官方文档定义）**：
| Layer | 作用域字段 | 生命周期 | 长/短期 | 适用 |
|---|---|---|---|---|
| Conversation memory | 当前 turn | 单次响应 | 短期 | 工具调用/中间态 |
| Session memory | `run_id` | 分钟~小时（可自动过期） | 短期 | 多步任务、单次会话 |
| User memory | `user_id` | 周~永久 | 长期 | 个性化（"需要 consent/governance"） |
| Organizational memory | 平台级 | 全局 | 长期 | 跨 agent 共享知识 |

经典记忆学分类被映射到上述分层：短期含 conversation history / working memory / attention context；长期含 **factual / episodic / semantic memory**。检索时排序为 **user 记忆优先 → session → 原始 history**。
【来源：`github.com/mem0ai/mem0/blob/main/docs/core-concepts/memory-types.mdx`】

**Agent 级记忆**：除 user/session 外，代码支持 `agent_id` 作用域，且有**程序性记忆（procedural memory）**与 agent 事实抽取路径：`_should_use_agent_memory_extraction()`、`_create_procedural_memory()`、`AGENT_CONTEXT_SUFFIX`——即 agent 自身的动作/确认也能作为一等记忆写入。【`mem0/memory/main.py` L714, L1949, L912-916；README "Agent-generated facts are first-class"】

**数据模型 / metadata 结构（来自源码落库字段）**：每条记忆 payload 至少包含：
- `data`（记忆正文文本）、`hash`（md5 去重）、`text_lemmatized`（BM25 用）
- `user_id` / `agent_id` / `run_id` / `actor_id`（多参与者时来自消息 `name`）、`role`
- `created_at` / `updated_at`（ISO UTC）、可选 `expiration_date`（TTL/decay）、可选 `attributed_to`、`linked_memory_ids`
- 任意自定义 metadata（用于 `metadata-filtering` 检索）
  【来源：`mem0/memory/main.py` `_add_to_vector_store` L969-1010、`update` L1785-1836；`docs/open-source/features/metadata-filtering.mdx`】

**治理/合规提示（官方文档原文，重要）**：User/Org 记忆"Requires consent/governance"；且"Avoid storing secrets or unredacted PII in user or org memories: **Mem0 is retrievable by design. Encrypt or hash sensitive values first.**"——学情数据属敏感/学生 PII，此点直接影响本项目合规设计。【`docs/core-concepts/memory-types.mdx`】

---

## 3. SDK 支持度：Python vs TypeScript/Node；OSS vs 托管平台

### 3.1 Python 与 TS/Node 的功能差异

**两者都提供"平台客户端 + 完整 OSS 自托管实现"两套**：
- Python：`pip install mem0ai`（OSS `Memory` 类）+ `MemoryClient`（平台）。
- TS/Node：`npm install mem0ai`；`mem0-ts/src/oss/src/`（完整 OSS：`memory/`、`storage/` 含 `SQLiteManager`/`MemoryHistoryManager`/`SupabaseHistoryManager`、`vector_stores/` 约 20 种、`llms/`、`embeddings/`、`prompts/`、`rerankers/`）+ `mem0-ts/src/client/`（平台客户端）。
  【来源：仓库 file tree，`mem0-ts/src/oss/src/**`、`mem0-ts/src/client/**`】

**v3 后两端已高度对齐**（都做 ADD-only、entity linking、多信号混合检索）。差异点：
- **图记忆**：两端**都已移除**（历史上 graph 曾是 Python 独有；现均无）。【`docs/migration/oss-v2-to-v3.mdx`】
- **entity/BM25 依赖不同**：Python 走 `[nlp]`/spaCy（`en_core_web_sm`，支持 Python 3.10–3.12）做实体抽取与词形还原；TS 走 `fastembed`。**跨语言不要共享同一向量集合**——lemmatized 字段命名不同（`text_lemmatized` vs `textLemmatized`），BM25 无法跨语言解析。
- **Provider/reranker 生态**：Python 更全（reranker 有 cohere/huggingface/sentence_transformer/zero_entropy/llm 等；LLM/embedding provider 更多）。TS 覆盖主流但略少。
- **命名规范**：TS 平台客户端用 camelCase（`userId`/`topK`），Python 用 snake_case。
  【来源：`docs/migration/oss-v2-to-v3.mdx`（TS/Python 各自 Breaking Changes 表）；`mem0/configs/rerankers/*`】

> 对本项目（TS/Node/React）的含义：**Mem0 只能跑在 Node 后端**（需服务端 LLM/向量库），React 前端不直接用。TS OSS SDK 在 v3 后可用性明显提升，作为 Node 侧集成是可行的；若追求最全 provider/reranker 能力，Python 侧更成熟。

### 3.2 OSS self-hosted vs 托管平台（Mem0 Platform）

| | Library（pip/npm） | Self-Hosted Server（docker compose） | Cloud Platform |
|---|---|---|---|
| 定位 | 测试/原型/嵌入式 | 团队自有基础设施 | 零运维生产 |
| Dashboard/Auth | 无 | 有（JWT 鉴权、React/Next 面板） | 有 |
| 高级特性 | 无 | "Teasers"（部分预览） | 全含 |

**关键披露**：README 明确"**Scores reflect Mem0's managed platform, which includes proprietary optimizations not available in the open-source SDK**"——即平台含**闭源优化**，OSS 只能期望"方向一致但数值不同"的效果。榜单数字也分两套：平台 LoCoMo 92.5（README）；OSS LoCoMo 91.6（迁移指南）。
【来源：`README.md`（对比表、New Memory Algorithm 段）；`docs/migration/oss-v2-to-v3.mdx`】

---

## 4. 本地部署依赖与最小可行配置

### 4.1 两种形态

**（A）Library 模式（推荐用于嵌入自有后端）**——依赖三类可插拔组件 + 一个本地历史库：
- **Vector store**：默认 `qdrant`；可选本地 `faiss` / `chroma` / 本地 `qdrant` / `pgvector` 等。【`mem0/vector_stores/configs.py`】
- **LLM**：默认 `openai`；**本地可选 `ollama` / `lmstudio` / `vllm`**。【`mem0/llms/{ollama,lmstudio,vllm}.py`】
- **Embedding**：默认 `openai`；**本地可选 `ollama` / `huggingface` / `fastembed`**。【`mem0/embeddings/{ollama,huggingface,fastembed}.py`】
- **History DB**：本地 **SQLite**（`history.db`）。【`mem0/configs/base.py`】
- 可选：`mem0ai[nlp]`（spaCy）启用 entity linking + BM25；Qdrant 另需 `fastembed` 才有 BM25 稀疏向量。

**（B）Self-Hosted Server 模式（docker compose）**——一个开箱即用的 Web 应用：
- 服务：`mem0`（FastAPI）+ `postgres`（镜像 `pgvector/pgvector:pg17`，**即向量库=pgvector/Postgres**）+ `mem0-dashboard`（Next.js）。
- **无需 Neo4j / 无需独立 Qdrant**；LLM provider 默认打包 `anthropic` + `google-generativeai`（云 LLM，可改配置）；含 JWT 鉴权（`python-jose`）、Alembic 迁移。
  【来源：`github.com/mem0ai/mem0/blob/main/server/docker-compose.yaml`、`server/requirements.txt`】

### 4.2 能否纯本地跑？——可以

**完全本地可行**：Library 模式下取 `llm=ollama` + `embedder=ollama`（或 `huggingface`）+ `vector_store=qdrant/faiss/chroma`（本地）+ SQLite history，**全程不出网、无云调用、无图数据库**。仓库亦提供 `docs/open-source/features` 与 local-LLM 示例（`mem0-ts/src/oss/examples/local-llms.ts`）。
【来源：上述 provider 源码文件；`mem0-ts/src/oss/examples/local-llms.ts`】

**最小可行本地配置（示例思路，Python）**：
```python
config = {
  "llm":        {"provider": "ollama",  "config": {"model": "..."}},
  "embedder":   {"provider": "ollama",  "config": {"model": "nomic-embed-text"}},
  "vector_store": {"provider": "qdrant", "config": {"path": "/data/qdrant"}},  # 本地落盘
  # history 默认 SQLite；如需 entity/BM25 再装 mem0ai[nlp] + fastembed
}
```
> 注：此为依据各 provider 源码归纳的最小配置形态，**具体字段名以对应 `mem0/configs/*` 为准**（未逐字段验证每个 provider 的必填项）。

### 4.3 图数据库依赖？——当前 OSS 已无

**当前 OSS 不再需要图数据库**。`mem0/memory/graph_memory.py` 已 **404 不存在**，`mem0/` 包内无任何 graph 实现文件，`MemoryConfig` 无 `graph_store` 字段。迁移指南原文："**Graph store support has been removed entirely**"（Python 与 TS 均是），`enable_graph`/`graph_store` 配置被移除，默认 Neo4j 配置也删除。
【来源：`gh api .../contents/mem0/memory/graph_memory.py` → HTTP 404；仓库 file tree（`mem0/` 无 graph 文件）；`mem0/configs/base.py`（无 graph_store）；`docs/migration/oss-v2-to-v3.mdx`】

> 注意矛盾点：`examples/graph-db-demo/*.ipynb`（neo4j/memgraph/kuzu/neptune）与 `docs/platform/features/graph-memory.mdx` 仍引用 `graph_store`。据迁移指南判断，**这些示例是 v2 遗留/或指向托管平台**；graph memory 现为**平台特性或历史特性**，不在当前 OSS 核心库。（"示例为遗留"是**推断**，非文档明述。）

---

## 5. 许可证与开源边界

- **License：Apache-2.0**（仓库根 LICENSE；GitHub API `license.spdx_id = "Apache-2.0"`）。可商用、可修改、含专利授权，义务主要是保留声明与变更说明。【来源：`gh api repos/mem0ai/mem0`（license 字段）；仓库 `LICENSE`】
- **开源边界**：OSS（library + self-hosted server + Python/TS SDK，均 Apache-2.0）**≠** Mem0 Platform（托管 SaaS，含**闭源专有优化**，README 明示不在 OSS 中）。因此"借鉴/自建"合法自由，但**若追求 README 榜单同等效果需用平台**（且数据出本地）。【来源：`README.md`】

---

## 6. 官方 arXiv 论文关键机制与评测结论

**论文**：*Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory*，arXiv:**2504.19413**，Chhikara, Khant, Aryan, Singh, Yadav，2025-04-28。【来源：`arxiv.org/abs/2504.19413`】

**机制**（对应本调研 §1.2-A 的 v2 设计）：
- 两阶段 **extraction + update** 增量流水线（Figure 2）。
- extraction：输入 = 异步刷新的**会话摘要 S** + 最近 `m` 条消息 + 新消息对 `(m_{t-1}, m_t)`；LLM 抽取函数 φ(P) 产出候选 salient facts Ω。**异步摘要生成模块**独立刷新 S，避免阻塞主流水线。
- update：每条候选事实召回 top `s` 相似记忆，LLM 经 **tool call 决策 ADD / UPDATE / DELETE / NOOP**，维护一致性与时序一致性。
- 实验设置：`m=10`，`s=10`，推理引擎 **GPT-4o-mini**，向量库用 dense embedding。
- 图变体 **Mem0^g**：实体-关系三元组 + 知识图 + 冲突检测消解。
  【来源：arXiv:2504.19413 §3.1-§3.2、§4、Appendix B】

**评测结论（LOCOMO 基准）**：
- Mem0 相对 OpenAI 在 **LLM-as-a-Judge 指标上约 +26% 相对提升**；正文中 Mem0 达 ~67% J，Mem0^g >68%，最强 RAG 仅 ~61%。
- 分题型相对提升：single-hop +5%、temporal +11%、multi-hop +7%（对各题型最强基线）。
- 效率：**p95 延迟较 full-context 降 ~91%**，**token 成本省 >90%**；Mem0 检索 p50 0.148s / p95 0.200s，总中位延迟 0.708s。Mem0^g 检索 0.476s。
  【来源：arXiv:2504.19413 Abstract、§5、§6】

> 时间线提醒：论文数字对应 v2；当前 OSS v3 的自评见迁移指南（LoCoMo 71.4→91.6、LongMemEval 67.8→93.4，抽取延迟约减半）。评测均为**多轮对话问答**基准（LoCoMo/LongMemEval/BEAM），**与"基于代码执行证据的学情建模"是不同问题域**——不能直接外推到本项目场景。

---

## 7. 适配评估（最重要）：Mem0 与"学情画像"的边界

### 7.1 问题本质对齐

学情画像的核心事实是 **薄弱知识点、误解模式、掌握度随时间变化**，且本项目铁律：**必须由可复现证据（测试/静态检查结果）支撑，LLM 不得捏造事实**。

Mem0 的定位是**"从对话中抽取语义事实并可检索"**。它确实做了大量**反捏造工程**：
- `ADDITIVE_EXTRACTION_PROMPT` 自称"**evidence-bound processor**"，Integrity Rules 明列："**No Fabrication: Every detail must trace to the inputs. If you can't point to where it came from, don't include it.**"、"No Implicit Attribute Inference"（禁止从名字等推断属性）、"Correct Attribution"、"No Meta-Extraction"、"No Detail Contamination from Context"；并有 UUID→整数映射的 anti-hallucination 设计。【来源：`mem0/configs/prompts.py` L468-720；`mem0/memory/main.py` L900-909】

**但决定性差异（务必看清）**：Mem0 的"evidence-bound"= **绑定到"输入的对话文本"**，**不是**绑定到"可复现执行证据"。它**不校验事实真伪**。若对话文本本身断言了错误结论，Mem0 会**忠实地存下这个错误**。因此：
> Mem0 的"不捏造"≈"不超出输入编造"；本项目铁律的"不捏造"≈"必须由可复现的测试/静态检查证据支撑"。**二者不是同一层保证。** Mem0 无法替代"证据驱动"这一层。

### 7.2 逐类学情数据的归属建议

**应留在结构化数据库自建（system of record，承载"硬事实"）——Mem0 不适合：**
1. **Evidence events（测试/静态检查原始结果）**：本就是结构化、可复现、可追溯的证据；须版本化、可按时间查询、可重算。属结构化 DB。
2. **基于证据的掌握度（mastery）计算**：需**确定性、可审计**的算法（证据聚合 / BKT / DKT / IRT 等）由 evidence events 推导。Mem0 是**非确定性 LLM 抽取 + ADD-only 累积**，既无数值状态机、也无法保证可复现——**绝不能承载 mastery 数值**。
3. **间隔复习调度（spaced repetition，SM-2 / FSRS）**：确定性算法，依赖精确的 review log（ease、interval、due date），必须可复现。属结构化 DB + 调度器。（Mem0 的 `expiration_date`/decay 只是 TTL，**不是**教学意义的复习调度。）
4. **误解分类映射的规范表（misconception taxonomy ↔ knowledge point ↔ evidence）**：权威映射须结构化（正是本项目现有"失败证据→薄弱知识点"诊断的强项）。

**适合放 Mem0 这类语义记忆层（或借鉴其架构自建，承载"软语义"）：**
1. **学习偏好**：偏好的讲解风格、节奏、示例类型、语言等。
2. **动机 / 情感状态**：受挫、信心、目标、意图（"想两周内搞定并发"）——Mem0 明确保留 emotional states / motivations。
3. **会话式辅导上下文 / episodic 摘要**：辅导 Agent 已经解释过什么、往期 session 概要，用于个性化 tutoring 提示与检索（Mem0 的 episodic/semantic 层 + 多信号检索正对口）。
4. **学生自然语言反思 / 错题复盘的叙述**：作为可检索的软上下文（**但不得作为掌握度判定依据**）。
5. **误解模式的"叙述性"呈现**：把结构化诊断结论转成便于注入 prompt 的自然语言摘要（authoritative 记录仍在结构化侧）。

### 7.3 倾向性结论：混合（Hybrid），偏"借鉴架构 + 选择性使用 Mem0 做语义层"

**推荐：混合方案。** 具体：

- **结构化 DB 自建 = 学情事实的唯一 system of record**：evidence events、evidence-backed mastery、misconception 映射、spaced-repetition schedule、审计轨迹。本项目"可复现证据"铁律**只**在这里落地。个性化学习路径的**决策与数值**由此驱动。
- **Mem0（或其架构）= 语义记忆层，只做"叙述与检索"，不回写硬事实**：承载偏好/动机/情感/会话上下文/episodic 摘要，注入 tutoring prompt 做个性化"调味"。可**直接用 Mem0 OSS 本地部署**（Ollama 本地 LLM + 本地 Qdrant/FAISS + SQLite，契合本项目本地部署合规立场），或**借鉴其 extraction + Integrity Rules + entity linking + 多信号混合检索**自建轻量 TS 版（契合 TS/Node 技术栈，避免额外依赖与数据出域）。
- **关键护栏**：`个性化路径 = 结构化掌握度/薄弱点（硬事实、可复现证据驱动）为主 + Mem0 语义上下文（软偏好）为辅`；LLM/Mem0 **不得**产生或覆盖 evidence-backed 数值；写入 Mem0 的学情文本需脱敏/加密（官方文档警示"Mem0 is retrievable by design"）。

**为何不"直接用 Mem0"承载学情**：会把"需可复现证据支撑的硬事实"交给非确定性 LLM 抽取，违背铁律；且 mastery/间隔复习是确定性算法，Mem0 无对应能力（ADD-only 累积、无数值状态机、矛盾结论会堆积）。

**为何不"纯自建、完全不碰 Mem0"**：Mem0 的反捏造 prompt 工程（Integrity Rules）、entity linking、多信号混合检索、Apache-2.0、可完全本地部署，都是**成熟且可复用**的资产；软语义层复用它可省成本、少造轮子——前提是**边界清晰**。

**给 EvidenceLoop 的落地建议**：
- 短期：语义层用 **TS OSS Mem0（本地 provider）** 挂在 Node 后端做 PoC，只喂"软语义"（偏好/情感/会话摘要），验证个性化 tutoring 提升；硬事实继续走现有证据驱动 + 结构化诊断。
- 若引入：优先**借鉴 v3 的 ADD-only + linking + Integrity Rules**，但为"掌握度随时间变化"这类需要"取当前正确值"的场景，**在结构化侧自建版本化 mastery**，不要指望 Mem0 的 temporal 检索来当权威。
- 参考物：官方有教育向示例 `docs/cookbooks/companions/ai-tutor.mdx` 与 `examples/multiagents/llamaindex_learning_system.py`，可作集成参考（**仅确认存在，未逐行验证其做法**）。

---

## 未能从一手来源证实 / 需注意的点

- `examples/graph-db-demo/*` 与 `docs/platform/features/graph-memory.mdx` 与"OSS 已移除 graph"存在表面矛盾；"示例为 v2 遗留/指向平台"是**合理推断**，非文档明述。
- §4.2 的最小本地配置为按 provider 源码归纳的**形态**，未对每个 provider 逐字段跑通验证。
- LOCOMO 分题型的**逐格 J 分数表**未逐一摘录（引用的是论文正文/摘要的聚合结论）。
- `docs/core-concepts/how-it-works.mdx` 抓取时多次返回空（gh API 偶发 EOF），§1 当前流水线以**源码**为一手依据（比该文档更权威）。
- README/迁移指南标注的日期"April 2026"为仓库文案；本调研以 `main` 分支当日源码状态为准。

---

## 来源清单（全部一手来源）

**GitHub 源码 / 仓库（`github.com/mem0ai/mem0`，`main` 分支，Apache-2.0）**
1. 仓库元数据（license=Apache-2.0、desc="Universal memory layer for AI Agents"）：`gh api repos/mem0ai/mem0`
2. `README.md`（New Memory Algorithm(April 2026)、Library/Self-Hosted/Cloud 对比、平台闭源优化披露、榜单表）
3. `mem0/memory/main.py`（`add` L735、`_add_to_vector_store` V3 PHASED BATCH PIPELINE L849-1050、`update` L1785、`delete` L1839、entity/BM25/reranker 检索 L480-522/L1349-1473/L1703-1785）
4. `mem0/configs/prompts.py`（`ADDITIVE_EXTRACTION_PROMPT` 与 Integrity Rules L468-720；遗留 `DEFAULT_UPDATE_MEMORY_PROMPT`/`get_update_memory_messages` L176-462）
5. `mem0/configs/base.py`（`MemoryConfig`：vector_store/llm/embedder/history_db_path/version，无 graph_store）
6. `mem0/vector_stores/configs.py`（默认 qdrant）、`mem0/embeddings/configs.py`（默认 openai）
7. 本地 provider 源码：`mem0/llms/{ollama,lmstudio,vllm}.py`、`mem0/embeddings/{ollama,huggingface,fastembed}.py`、`mem0/vector_stores/{faiss,chroma,qdrant}.py`
8. `mem0-ts/src/oss/src/**`（TS 完整 OSS 实现）、`mem0-ts/src/client/**`（TS 平台客户端）、`mem0-ts/src/oss/examples/local-llms.ts`
9. `server/docker-compose.yaml`（mem0/FastAPI + postgres/pgvector-pg17 + Next.js dashboard）、`server/requirements.txt`
10. `mem0/memory/graph_memory.py` → HTTP 404（graph 已移除的证据）；仓库 file tree（`mem0/` 包内无 graph 文件）

**官方文档（docs.mem0.ai，仓库内 `.mdx` 一手）**
11. `docs/core-concepts/memory-types.mdx`（分层模型、短/长期分类、治理与 PII 警示）
12. `docs/migration/oss-v2-to-v3.mdx`（ADD-only、多信号混合检索、entity linking、graph 彻底移除、参数变更、LoCoMo 71.4→91.6/LongMemEval 67.8→93.4）
13. `docs/core-concepts/memory-operations/{add,search,update,delete}.mdx`、`docs/open-source/features/{metadata-filtering,reranking,async-memory}.mdx`（作用域/检索/元数据）
14. `docs/cookbooks/companions/ai-tutor.mdx`、`examples/multiagents/llamaindex_learning_system.py`（教育向示例，仅确认存在）

**官方论文（arXiv）**
15. arXiv:2504.19413 — *Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory*（Chhikara et al., 2025-04-28）：`arxiv.org/abs/2504.19413`、HTML 全文 `arxiv.org/html/2504.19413v1`（§3 机制、§4-6 评测、Appendix B Algorithm 1）
