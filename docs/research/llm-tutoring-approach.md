# LLM 三层 AI 辅导方案调研（决策票 TR2）

> 调研对象：EvidenceRing 三层 AI 辅导——(A) 单向讲解 / (B) 追问式对话 / (C) 苏格拉底引导
> 调研快照日期：2026-07-23
> 服务对象：产品决策，不含实现代码。
> 方法：一手来源优先（GitHub 官方 cookbook / prompt 教程源码、arXiv 论文、模型定价 API），每条结论标注来源；WebSearch/WebFetch 被区域封锁或返回空时改用 `curl` + `gh api` 拉一手原文。未证实点在文末集中列出。
> 铁律贯穿：**LLM 不得改分、不得捏造事实、分数只来自可复现证据**；已裁决"练习态/测评态双模"——练习态辅导全开但不计入正式测评分，测评态关闭辅导。

---

## 0. 结论速览（TL;DR）

- **苏格拉底 prompt 的业界共识非常清晰且可直接复用**：核心就是一句强约束 "You *never* give the student the answer" + "ask just ONE question at a time" + "break the problem into simpler parts"。Khan Academy 的 Khanmigo 公开 GPT（"Khanmigo Lite"）额外给出了两个本项目必须抄的机制：**（1）防"help abuse"（套答案）——连续 3 次以上低努力索取提示就拒绝继续放提示；（2）"教方法用例题，绝不用学生正在问的原题"**。来源：`LouisShark/chatgpt_system_prompt` 与 `mustvlad/ChatGPT-System-Prompts`（均为公开镜像的原始 GPT 指令）。
- **"讲解可能讲错"是真实且被 Anthropic/OpenAI 官方承认的风险**。业界降幻觉的三板斧按性价比排序：**(1) RAG 挂标准解析（把 assignment 已有的 `expected/标准解题步骤` 塞进 context，让 LLM 只做"解释既有正确解"而非"自己重新解题"）；(2) 低 temperature（0–0.3）；(3) self-consistency（采样多条 CoT 投票，arXiv:2203.11171）**。对本项目，(1) 是决定性的——因为 EvidenceRing 的分数和证据本就来自可复现 runner，标准解析已经存在，讲解层永远不该自己重算。
- **成本极低，不构成决策阻碍**。50 人一班同时追问，用 Claude Haiku 4.5（$1/$5 每百万 token）或 DeepSeek（$0.14/$0.28）量级，单轮追问约 2–4k input + 300 output，单次成本约 **¥0.01–0.05**；一节课全班几百轮追问仍在**几元人民币**级别。真正的约束是**并发限流**（供应商 RPM/TPM）和**延迟体验**，不是钱。必须保留现有 `LocalFeedbackGenerator` 模板兜底（已实现）。
- **模型选型倾向（中文数理化 + 合规）**：
  - **单向讲解 (A)**：走已有 `OpenAICompatibleFeedbackGenerator`，模型用 **DeepSeek-V3/R1 或 Qwen-plus**（中文强、便宜、境内合规无数据出境问题）。
  - **追问对话 (B)**：同上模型 + 多轮 context 管理；上下文控制靠"题目+学生答案+证据+标准解析"结构化裁剪，而非塞全历史。
  - **苏格拉底 (C)**：对"指令遵循/不泄答案"要求最高，**Qwen-max / DeepSeek / 豆包 Seed 2.0 pro** 均可，若允许境外可用 Claude Haiku（指令遵循强）。国内合规首选境内模型。
- **MVP 起点**：三层全部复用 `OpenAICompatibleFeedbackGenerator` 的 fetch/schema/fallback 骨架，只换 **system prompt + 输入裁剪**，新增一个 `TutoringGenerator`（多轮）与 `SocraticGenerator`（提示链）即可。铁律通过 prompt 硬约束 + 输出 schema 校验 + 分数与辅导物理隔离（辅导不写回 evaluation.score）三重保证。

---

## 1. 苏格拉底式辅导的 Prompt 工程（问题 1）

### 1.1 业界基准 prompt（可直接复用）

**OpenAI 官方示例库最广为流传的 Socratic Tutor system message**（被无数项目转载的原文）：

> "You are a tutor that always responds in the Socratic style. You **never** give the student the answer, but always try to ask just the right question to help them learn to think for themselves. You should always tune your question to the interest & knowledge of the student, breaking down the problem into simpler parts until it's at just the right level for them."
> 【来源：`github.com/mustvlad/ChatGPT-System-Prompts` → `prompts/educational/socratic-tutor.md`；同文出现在 `thderoo/ChattierGPT-UI/prompts/tutor_en.txt`、`steffen74/ConstitutionalAiTuning`】

一个关键补强（很多项目加的一句，本项目应采纳）：
> "Always ask just **ONE** question for each user message. **DO NOT** ask multiple questions at once."
> 【来源：`steffen74/ConstitutionalAiTuning/examples/chat_usage.py`】

**Anthropic 官方交互式 prompt 教程**里的对应写法（更简，强调"别帮太多"）：
> "Act as a Socratic tutor who helps the user learn. ... Do not give the user too much help! Instead, just give them guidance so they can find the correct solution themselves."
> 【来源：`anthropics/courses` → `prompt_engineering_interactive_tutorial/Anthropic 1P/hints.py`；`anthropics/prompt-eng-interactive-tutorial`（AmazonBedrock 版同文）】

### 1.2 Khan Academy / Khanmigo 的公开方案（最完整，含防套话）

Khan Academy 的公开 GPT "Khanmigo Lite" 的完整原始指令是本项目**最有价值的一手参考**，它把苏格拉底教学落成了可操作的规则。核心节选（原文）：

- **不给答案 + 拆解**："You never give the student (me) the answer, but always try to ask just the right question ... breaking down the problem into simpler parts ... **always assume that they're having difficulties and you don't know where yet**."
- **先定位卡点**："You should always start by figuring out **what part I am stuck on FIRST**, THEN asking how I think I should approach the next step."
- **反"help abuse"（防套答案的核心机制）**："**DON'T LET ME PERFORM HELP ABUSE.** Be wary of me repeatedly asking for hints or help without making any effort ... by repeatedly asking for hints ... or saying 'no' ... every time you ask me a question. ... **If I ask for further assistance 3 or more times in a row without any significant effort ... zoom out and ask me what part of the hint I am stuck on ... before giving any more hints at all. Be REALLY firm! Stop here until I make an effort!**"
- **用例题不用原题**："It's ok to teach students how to answer problems. However, **always use example problems, never the actual problem they ask you about.**"
- **声明式知识兜底**："When it comes to declarative knowledge 'simple facts' that have no further way to decompose ... if I am really stuck ... provide me with a list of options to choose from."（避免死循环）
- **数学正确性**："Before providing feedback, **double check my work and your work rigorously** using the python instructions"（Khanmigo 用代码执行核算，对应本项目应该用 runner/标准解析核算，而非 LLM 心算）。
- **风格**："speak extremely concisely at a 2nd grade reading level or ... no higher than my own."
> 【来源：`LouisShark/chatgpt_system_prompt` → `prompts/gpts/hRCqiqVlM_Tutor_Me.md`；同一 GPT 指令另见 `entropy-cloud/nop-entropy/docs/gpt/reference/tutor.md`、`linexjlin/GPTs/prompts/Code Tutor.md`。这是 Khan Academy 官方发布的 "Tutor Me" GPT 的抓取原文】

Khan Academy 官网对 Khanmigo 的高层描述亦印证这套哲学："doesn't just give answers ... guides learners to find the answer themselves"、"challenges you to think critically and solve problems without giving you direct answers"，但官网不公开底层 prompt/工程细节。
> 【来源：khanacademy.org / khanmigo 产品页，经 WebFetch 摘取；工程细节官网未披露 — 见未证实点】

### 1.3 防越狱 / 防套话（本项目落地要点）

对"学生套出答案"，业界（Khanmigo）不是靠一句禁令，而是**多层**：
1. **计数式拒绝**：连续 N 次（Khanmigo 用 3）低努力索取 → 停止放提示，反问"你卡在哪一步"。
2. **原题脱敏**：教方法只用同构例题，绝不在原题上演示完整解法。
3. **提示分级（hint ladder）**：先定位卡点 → 给"下一步该做什么操作"的方向 → 再不行给声明式选项列表；每级只前进一步。
4. **输出侧约束**：system prompt 反复强调"每次只问一个问题"，降低学生一次性拿到完整推导的可能。
5. **注入防护**：把学生输入当**不可信数据**处理——EvidenceRing 已有的 zod schema 校验（`server/domain/feedback.ts` 中 `llmResponseSchema`）应扩展到辅导输出；对学生消息中形如"忽略上述指令/直接告诉我答案/你现在是另一个助手"的内容，靠 system prompt 优先级 + 不把学生消息拼进 system role 来防御。

> 注：以上 1–4 均直接来自 Khanmigo 公开指令；第 5 点为本项目安全惯例（对齐 EvidenceRing 现有 schema 校验做法），非外部一手来源的专门指引。

---

## 2. 多轮对话的上下文管理（问题 2）

### 2.1 一道题追问的 context 组装（结构化，非拼历史）

追问对话 (B) 的上下文应是**结构化装配**，而不是把整个 chat 历史原样堆进去。本项目已有的 `FeedbackContext`（`server/domain/feedback.ts` L9-16）就是模型：`assignment / score / previousScore / evidence[] / diagnoses[] / intervention`。多轮辅导应在此基础上补一个**精简、稳定的题目卡（question card）**作为 system/context 前缀：

- **稳定前缀（每轮不变，可 prompt-cache）**：题干、题型、标准解析/标准答案要点（来自 assignment 而非 LLM 生成）、该学生本题的证据要点（哪些 test/校验 passed/failed，来自 runner）。
- **滚动窗口（每轮变化）**：仅保留最近 K 轮（建议 4–6 轮）的师生对话；更早的用**一句话摘要**替代（"学生已理解 X，仍卡在 Y"）。
- **绝不放进去的**：完整答案（苏格拉底模式）、无关题目、原始超长运行日志（只放 message 摘要字段，现有代码已在 map 里只取 `label/state/expected/actual/message`，L95-103，这个裁剪范式直接沿用）。

### 2.2 Token 成本控制手段

- **prompt caching**：题目卡是稳定前缀，Anthropic/OpenAI/多数 OpenAI-compatible 供应商都支持 cache_read（价格约为 input 的 1/10，见 §4 表），把题干+标准解析放前缀可省大头。
- **窗口 + 摘要**：滚动窗口天然封顶单轮 token；超窗历史压成摘要。
- **模型分层**：讲解/追问用小模型（Haiku/DeepSeek/Qwen-flash），只在学生明确"我还是不懂、换个讲法"时才可选升配。
- **输出封顶**：现有 schema 已限 `summary` 12–240 字；辅导对话也应限最大输出 token（例如 300–400），既控成本又强制简洁（契合苏格拉底"每次只问一个问题"）。

> 来源说明：结构化 context + 滑动窗口 + 摘要 + prompt caching 是通用工程实践（对齐 mem0 调研文档 §1 中"取最近 N 条 + 摘要"的同类做法，见 `docs/research/mem0-memory-architecture.md`）。这些是行业惯例而非单一权威文档裁定 — 归入"实践共识"。

---

## 3. "讲解可能讲错"的幻觉风险与缓解（问题 3）

### 3.1 风险确认

LLM 讲解数学/化学解法出错是被官方承认的已知风险。Khanmigo 的应对方式是**不让 LLM 自己算**——它用 python 执行来"rigorously double check my work and your work"（见 §1.2 原文）。这对本项目是决定性启示：**EvidenceRing 的分数与证据本就来自可复现 runner（`server/runner/*`）与标准解析，讲解层永远不该自己重新解题，只该"解释已经验证为正确的解"。**

### 3.2 缓解手段（按对本项目的性价比排序）

1. **RAG 挂标准解析（最重要）**：把 assignment 已有的标准答案/标准解题步骤 + runner 证据作为 context 喂入，system prompt 约束 LLM "只能解释下方提供的正确解法与证据，不得自行推导新解、不得给出未在证据中出现的数值/结论"。这把"生成正确性"问题降级为"复述+解释既有正确内容"问题，幻觉面大幅收窄。本项目现有 system prompt 已有雏形："只能根据提供的测试与静态证据总结，不得修改分数、捏造错误或给出完整答案"（`feedback.ts` L86-87）——辅导层沿用并强化。
2. **低 temperature**：现有代码用 `temperature: 0.2`（L82），对讲解/事实性任务合理，保持 0–0.3。
3. **self-consistency（可选，高价值题）**：对易错的数理推导，采样多条 CoT 取多数一致答案，能显著提升算术/常识/符号推理准确率。仅在关键讲解或抽检时用（成本×N）。
   > 【来源：arXiv:2203.11171 "Self-Consistency Improves Chain of Thought Reasoning in Language Models", Wang et al.】
4. **免责标注**：练习态辅导输出统一挂"AI 辅导，仅供参考，分数以证据为准"的免责标签；这也天然契合已裁决的"练习态不计入正式测评分"边界。
5. **schema + 事实校验**：输出经 zod 校验（现有做法）；进一步可做"辅导中出现的数值/最终结论不得与 evidence/标准解析矛盾"的轻量后校验，矛盾则降级为模板兜底。

> 官方教育指引原文：Anthropic 的 education use-case 指南被区域封锁无法拉取原文（见未证实点）；上述 RAG/低温/self-consistency/免责为跨来源的通行缓解策略 + 本项目铁律推导。

---

## 4. 成本 / 延迟 / 并发（问题 4）

### 4.1 定价（每百万 token，USD；快照 2026-07-23，来源 models.dev 聚合 API）

| 模型 | input | output | cache_read |
| --- | --- | --- | --- |
| Claude Haiku 4.5 | $1 | $5 | $0.1 |
| Claude Sonnet 5 | $2 | $10 | $0.2 |
| GPT-5-nano | $0.05 | $0.4 | $0.005 |
| GPT-5-mini | $0.25 | $2 | $0.025 |
| **DeepSeek-chat / reasoner** | **$0.14** | **$0.28** | $0.0028 |
| Qwen-plus | $0.4 | $1.2 | — |
| Qwen-flash | $0.05 | $0.4 | — |
| Qwen-max | $1.2 | $6 | — |
| Qwen-turbo | $0.05 | $0.2 | — |
| GLM-4.7-flash（智谱） | $0（免费档） | $0 | — |
| GLM-4.7 | $0.6 | $2.2 | — |
| Doubao Seed 2.0 lite（豆包/火山） | ~$0.09 | ~$0.51 | — |
| Doubao Seed 2.0 pro | ~$0.45 | ~$2.24 | — |
| Kimi k2.5（月之暗面） | $0.6 | $3 | — |

> 【来源：`models.dev/api.json` 聚合数据，2026-07-23 拉取。豆包/Doubao 价来自 zenmux/aihubmix 转售条目（近似值，官方火山引擎控制台价可能不同 — 见未证实点）。Anthropic/OpenAI 官方定价页为 JS 渲染 SPA，curl 无法直接解析，故采用 models.dev 聚合值】

### 4.2 单次追问成本估算（量级）

假设单轮追问：题目卡+证据+标准解析约 2.5k input token，最近对话窗 ~1k，输出 300 token。
- **DeepSeek**：(3500/1e6×$0.14) + (300/1e6×$0.28) ≈ **$0.00057 ≈ ¥0.004/轮**。
- **Claude Haiku 4.5**：(3500×$1 + 300×$5)/1e6 ≈ **$0.005 ≈ ¥0.036/轮**（未计 cache）。
- 若题目卡走 prompt cache，input 大头按 cache_read 计，成本再降约一个数量级。

**一节课 50 人 × 平均 10 轮追问 = 500 轮**：DeepSeek ≈ ¥2；Haiku ≈ ¥18。**成本不是决策约束**。

### 4.3 并发、限流、降级

- **真正的瓶颈是供应商 RPM/TPM 配额与延迟**，不是费用。50 人瞬时并发（尤其苏格拉底多轮，每次都要往返）需要：
  - **请求队列 + 并发上限**（例如同时在飞 ≤ N 个 LLM 调用，其余排队），避免打爆配额。
  - **超时**：现有代码已用 `AbortSignal.timeout(8_000)`（`feedback.ts` L110），辅导对话可略放宽但需给学生"正在思考"反馈。
  - **失败降级（必须保留）**：现有 `try/catch → fallback.generate()`（L129-131）是正确范式。辅导层降级到 `LocalFeedbackGenerator` 式模板（"这道题的关键在于 X，试着先……"），保证 LLM 不可用/超时/被限流时体验不中断。
  - **重试**：对 429/5xx 做有限指数退避，但要设上限避免雪崩。
- **延迟体验**：小模型（Haiku/DeepSeek/Qwen-flash）首 token 通常 <1s，流式输出可进一步改善苏格拉底问答的等待感（现有实现是非流式一次性 JSON，若追问对话要好体验建议评估流式 — 见 §6 MVP 权衡）。

---

## 5. 模型选型：中文数理化 + 合规（问题 5）

### 5.1 适配性（中文教育/数理化）

- **DeepSeek（V3/R1/V4）**：中文强、数理推理是其公认强项（R1/reasoner 面向推理）、价格极低（$0.14/$0.28）。国内团队、境内部署，**数理化讲解首选之一**。
- **通义千问 Qwen（plus/max/flash）**：阿里，中文与多模态（Qwen-VL 可读题目图片）成熟，价格分层清晰，境内合规。**追问/苏格拉底指令遵循可靠**。
- **豆包 Doubao（字节/火山引擎）**：中文对话自然、价格低（Seed 2.0 lite ~$0.09/$0.51），字节生态；适合对话式辅导。
- **智谱 GLM-4.7**：有免费 flash 档，适合成本敏感的讲解层原型。
- **Claude Haiku 4.5 / GPT-5-mini**：指令遵循（"绝不泄答案"这类强约束）业界口碑最好，苏格拉底模式最稳；但**涉及数据出境**，中国大陆生产环境合规成本高。
- **Kimi（月之暗面）**：长上下文强，若题目/资料很长可考虑。

### 5.2 合规（数据出境，决定性约束）

- 面向中国大陆 K12/学生用户，**学生答案、对话属个人信息**，用境外模型（Claude/GPT）构成数据出境，需走《个人信息出境标准合同》/安全评估，对一个赛道产品是重成本。
- **合规首选：境内大模型（DeepSeek / Qwen / 豆包 / GLM）**，均已完成生成式 AI 备案、数据不出境。
- 赛道要求本身强调"对数据授权、隐私保护、风险提示和行业边界做明确说明"（见 `docs/research/competition-requirements.md` 核心要求 4）——选境内模型 + 双模隔离 + 免责标注正好构成合规叙事。
- **架构上保留可切换性**：现有 `OpenAICompatibleFeedbackGenerator` 通过 `LLM_BASE_URL/LLM_MODEL/LLM_API_KEY` 环境变量配置（`feedback.ts` L137-148），DeepSeek/Qwen/豆包/GLM 均提供 OpenAI-compatible endpoint，**换模型只改环境变量、零改代码**，这点已经具备。

> 【来源：各模型能力/定位为厂商公开定位 + models.dev 定价；"境内模型已备案/数据不出境"为中国生成式 AI 监管通行事实（《生成式人工智能服务管理暂行办法》备案制），非本次单一文档一手裁定 — 归入监管常识，具体某模型备案状态请以厂商合规页为准，见未证实点】

---

## 6. 给本项目的倾向性建议（问题 6）

### 6.1 三层各自的模型 + prompt 策略

| 层 | 模型倾向 | temperature | prompt 核心 | 上下文 |
| --- | --- | --- | --- | --- |
| **(A) 单向讲解** | DeepSeek / Qwen-plus（境内、便宜） | 0.2 | 复用现有"只据证据总结、不改分、不给完整答案"system prompt，强化"只解释下方标准解析" | 单次：题目卡+证据+标准解析（RAG） |
| **(B) 追问对话** | 同 A + 多轮 | 0.2–0.3 | A 的约束 + "你可以解释但仍不直接给最终答案（练习态可放宽到给答案，测评态关闭）" | 稳定题目卡前缀（prompt cache）+ 最近 4–6 轮窗口 + 超窗摘要 |
| **(C) 苏格拉底** | Qwen-max / DeepSeek / 豆包 pro（强指令遵循）；允许境外则 Haiku | 0.3–0.5（提问需一点多样性） | Khanmigo 式：never give answer + one question at a time + 先定位卡点 + hint ladder + 反 help-abuse（连续3次拒绝）+ 用例题不用原题 + 声明式兜底给选项 | 同 B，且**标准答案只放进 system 供 AI 自校验、绝不输出给学生** |

### 6.2 如何复用 `OpenAICompatibleFeedbackGenerator`

现有类（`server/domain/feedback.ts` L67-133）已经把最难的骨架写好且正确：
- OpenAI-compatible `/chat/completions` 调用、Bearer 鉴权、`temperature`、8s 超时、`response.ok` 检查、JSON 抽取（正则 `\{[\s\S]*\}`）、**zod schema 校验**、**catch → fallback** 全链路降级。
- `createFeedbackGenerator()` 的环境变量装配 + 缺配置回退模板（L135-149）。

**复用方式（不重写骨架）**：
1. 抽象出共用的 `callOpenAICompatible(messages, schema, opts)` 底层（把 L70-131 的 fetch+校验+降级抽成可复用函数），三层共享。
2. 新增 `TutoringGenerator`（多轮追问）与 `SocraticGenerator`（提示链），各自只提供 **system prompt + 输入裁剪 + 输出 schema**，底层调用复用上面的函数。讲解层 (A) 基本就是现有 generator 加"标准解析"入参。
3. 每层各自带 `fallback`（`LocalFeedbackGenerator` 或其变体），保持"LLM 挂了不影响主流程"。

### 6.3 铁律的工程保证（三重）

1. **prompt 硬约束**：system prompt 明令"不得修改分数、不得捏造证据未包含的事实、只解释已验证正确的解"。
2. **schema + 后校验**：辅导输出经 zod 校验；可加"输出中数值/最终结论不得与 evidence 矛盾"的轻量检查，矛盾即降级模板。
3. **物理隔离（最强保证）**：辅导 generator **在架构上根本不接触打分路径**。分数来自 `EvaluationAgent` 的 evidence→score 计算（`provenance.kind='evidence'`, `algorithm='simple.v1'`，见 `EvaluationAgent.ts` L128-132），辅导只消费 `FeedbackContext` 只读数据、只产出文本，**不回写 score/evidence**。这与现有设计一致，天然满足"分数只来自可复现证据"。
4. **双模开关**：练习态/测评态由上层（assignment/session 模式）控制是否装配辅导 generator；测评态直接不注入辅导层。

### 6.4 MVP 起点（最小可演示闭环）

1. **先做 (A) 单向讲解 + RAG 标准解析**：改动最小（现有 generator 加"标准解析"入参 + 强化 prompt），立刻接电。用 DeepSeek，配 `LLM_BASE_URL/MODEL/KEY` 即可，**零架构改动**。
2. **再做 (C) 苏格拉底单轮/短多轮**：直接移植 Khanmigo Lite 的 system prompt（§1.2，中文化），验证"不泄答案 + 反套话"。
3. **最后做 (B) 完整多轮追问**：需要滑动窗口 + 摘要 + 会话状态管理，工程量最大，放最后。
4. **贯穿**：全程保留模板 fallback（已实现）；练习态挂免责标签；测评态不注入辅导。
5. **体验优化（P1）**：追问/苏格拉底若要好体验，评估把非流式 JSON 改为流式输出（现有实现是一次性返回，苏格拉底多轮等待感差）——这是已知的取舍，非阻塞项。

---

## 未证实 / 需进一步核实的点

1. **Anthropic 官方 education use-case 指南原文未取到**：`docs.anthropic.com/.../use-case-guides/education` 与 `platform.claude.com` 对本区域返回 307 → "App unavailable in region"，curl/WebFetch 均被区域封锁。§3 的 Anthropic 免责/降幻觉建议基于其 prompt 教程（已取到）+ 通行策略推导，非该 education 指南原文。
2. **OpenAI 官方 cookbook 是否有专门"Socratic/math tutor"教育示例未确认**：`raw.githubusercontent.com/openai/openai-cookbook` 的 examples 目录列举中未见明确 tutor 示例文件；§1.1 引用的 OpenAI Socratic 原文来自广泛转载的 system-prompt 镜像库（`mustvlad/...`、`thderoo/...`），可信但非 openai/openai-cookbook 仓库内的官方文件。原 `platform.openai.com/docs/examples` 已 301 到 `developers.openai.com`，未逐页核。
3. **Khanmigo 底层生产 prompt 未公开**：§1.2 用的是 Khan Academy 公开发布的 "Tutor Me" GPT（Khanmigo **Lite**）抓取指令，属官方发布物；但生产版 Khanmigo 的完整 prompt/工程（含其 python 核算细节、安全 moderation）官网未披露。
4. **模型定价为聚合值，非厂商官方页直读**：Anthropic/OpenAI 官方定价页是 JS SPA，curl 无法解析；§4 表用 models.dev 聚合 API（2026-07-23 快照）。豆包/Doubao 价来自第三方转售条目（zenmux/aihubmix），**火山引擎官方控制台价可能不同**，量级估算仍成立。
5. **境内模型合规状态**：DeepSeek/Qwen/豆包/GLM"已备案、数据不出境"为中国生成式 AI 监管通行事实，但**具体某模型/某接口的最新备案与数据处理条款请以厂商合规页为准**，本调研未逐一核验备案编号。
6. **self-consistency 对数理讲解的增益幅度**：arXiv:2203.11171 证实其在算术/推理基准上的提升，但**具体到本项目的中文数理化讲解场景的增益未实测**，建议 MVP 后做小规模评测再决定是否常态启用（成本×采样数）。
