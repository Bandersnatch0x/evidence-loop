# [wayfinder:research] TR2 LLM 教学辅导方案调研

## 状态：已解决（closed）

见 `docs/research/llm-tutoring-approach.md`。核心：苏格拉底 prompt 复用 Khanmigo 公开指令（含防套话机制）；降幻觉靠 RAG 挂标准解析（不让 LLM 自己算）；选型首选境内已备案模型（DeepSeek/Qwen/豆包/GLM），现有 OpenAICompatibleFeedbackGenerator 零改换模型；铁律靠 prompt+schema+**物理隔离**（辅导 generator 不接触打分路径）；MVP 顺序 A 讲解→C 苏格拉底→B 追问。上抛"数据出境合规"独立裁决点（与 TR1 合流）。

## Question（原始）
调研三层 AI 辅导（讲解/对话/苏格拉底）的 LLM 实现方案。一手来源：主流 LLM 教育应用案例、苏格拉底式提示的 prompt 工程、成本/延迟/限流实践。产出：provider 选型、三层 prompt 架构、"给提示不泄答案"的控制手段，写入 research/ 供 T05 引用。

**Blocked by**: 无（可立即并行）
