# [wayfinder:grilling] T05 三层 AI 辅导 + LLM 通电

## Question
AI 真接 LLM（现在是模板）。三层辅导：单向讲解/追问对话/苏格拉底引导。D1 已裁决：仅练习态开放辅导。要定：
- 三层的交互形态与切换（学生何时得到哪层）
- LLM 接入：provider 选型、成本/延迟/限流/失败 fallback（是否保留模板兜底）
- 苏格拉底"给提示不泄答案"的边界如何控制
- AI 讲解的 provenance/免责（讲错 vs 捏造，D-裁决延伸）
- 与现有 OpenAICompatibleFeedbackGenerator/AdvisoryService 的接线

**Blocked by**: T01, T03（要有题才能辅导），T-R2（LLM 辅导方案调研）

---

## ✅ 已解决（resolution）

**状态**：closed。基于 TR2 研究 + D1 双模 + 铁律物理隔离裁决。

### 三层交互形态与切换
- **单向讲解（Explain）**：测评态交卷后 / 练习态答错后自动生成——针对性讲"为什么错 + 正确思路"。零额外交互，学生读。
- **追问对话（Dialogue）**：练习态限定。学生就当前题多轮追问（"这步为什么""换个方法"），滚动窗口 4-6 轮 + 超窗摘要。
- **苏格拉底引导（Socratic）**：练习态限定。学生主动点"给提示"进入，AI 一次一问、给提示链不给答案。
- **切换规则**：讲解全态可用（只读文案）；对话/苏格拉底**仅练习态开放**（D1——测评态辅导关闭，保证裸做证据纯净）。

### LLM 接入（复用现有骨架，零架构改动）
- 抽出共用 `callOpenAICompatible()`（现有 `OpenAICompatibleFeedbackGenerator` 的 fetch+zod+fallback 全链路已正确）。
- 新增 `TutoringGenerator`（讲解+对话）/ `SocraticGenerator`（引导），只换 prompt + 输入裁剪，不碰打分路径。
- **provider 选型**：境内已备案 DeepSeek（数理强，$0.14/$0.28）默认，Qwen/豆包/GLM 备选。环境变量配置（`FEEDBACK_LLM_*`），换模型零改码（D5 已裁决数据出境走境内）。
- **失败降级**：保留现有 `try/catch → 模板 fallback`（限流/超时/API 挂时降级为模板文案，不阻塞刷题）。成本非约束（50 人×10 轮 ¥2-18/节课），瓶颈是 RPM/TPM 限流。

### 苏格拉底"给提示不泄答案"边界
- 移植 Khanmigo 公开指令两机制：① **反 help-abuse**——连续 3 次以上低努力索取提示则拒绝继续放提示；② **只用同构例题**演示方法，绝不在原题上给完整解法。
- 有标准解析时（T09），苏格拉底基于解析生成提示链（"不让 LLM 自己算"降幻觉）。

### 铁律护栏（三重）
1. **prompt 硬约束**：明确"不给答案/不改分"。
2. **schema 后校验**：zod 校验输出结构。
3. **物理隔离（决定性）**：辅导 generator 架构上**不接触打分路径**——只读消费 `FeedbackContext`，**不回写 score/evidence**。类型层禁止辅导产物贴 `evidence` 标签（AdvisoryLayer/llm_inference）。
- **AI 讲解可信度**：讲解走 `provenance.kind='llm_inference'` + UI 灰色"AI 推断"徽章 + 免责。讲错 ≠ 捏造事实（它从不写 EvidenceItem，结构上不可能改分）。降幻觉靠 RAG 挂 T09 标准解析（"复述已验证正确的解"而非自己重算）。

### MVP 顺序
讲解+RAG（零架构改动立即接电）→ 苏格拉底（移植 Khanmigo prompt）→ 多轮追问（工程量最大）。

### 关联
[[TR2-llm-tutoring-research]] [[T09-standard-solution]] [[T10-data-egress-compliance]]，落实 D1/D5。
