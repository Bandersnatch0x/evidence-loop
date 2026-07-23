# [wayfinder:ticket] T10 数据出境合规裁决（横切 OCR + LLM）

**类型**: grilling（decision）
**状态**: frontier（无阻塞，可立即裁决）
**Blocked by**: 无

## Question

TR1(OCR) 和 TR2(LLM 辅导) 都上抛同一个决定性约束：本产品涉未成年学生数据，**图片/文本/答题内容是否可出境**，直接决定 OCR 与 LLM 的选型。

要裁决：
- OCR：可出境→Mathpix（美国，公式+化学式最强）；须本地→PaddleOCR 本地微服务（Zh-BLEU 90+，但需 GPU/Python 栈）
- LLM 辅导：可出境→Claude/GPT；须境内→DeepSeek/Qwen/豆包/GLM（已备案，OpenAI-compatible，换模型零改码）
- 是否分级：题目内容（可能不含 PII）vs 学生答题/画像（强 PII）区别对待？

## 关联
- [[TR1-ocr-research]] [[TR2-llm-tutoring-research]]
- 受 CONTEXT "数据守 Demo 级、不连真实学籍" 边界约束

---

## 状态：CLOSED

## Resolution（裁决）

**核心裁决：按数据敏感度分级出境（data-classification-based egress），而非一刀切。**

引入三级数据分类，出境策略随级别不同：

| 级别 | 内容 | 出境策略 |
|------|------|----------|
| **L1 题目内容** | 题干/选项/标准答案/知识点（不含学生 PII） | **可出境**——老师导入的题目本身不是学生个人信息，允许送 Mathpix/云 OCR/云 LLM 做识别与讲解生成 |
| **L2 答题内容** | 学生的作答文本/表达式/代码 | **默认境内**——可能含学生自填 PII，走境内已备案模型；脱敏后（PII 检测过滤）方可出境做辅导 |
| **L3 学生画像** | 姓名/学号/掌握度/学情/审计日志 | **绝不出境**——永远本地，任何云调用都不携带 L3 |

**具体选型（Demo 级默认，可配置）：**

1. **OCR**：默认 **MVP-0 电子文档解析**（.docx/PDF 文本层，纯 Node、零出境、零 GPU）——覆盖大部分导入场景。扫描件公式识别作为 MVP-1，通过 `OCR_PROVIDER` 环境变量二选一：`local`（PaddleOCR 微服务，复用 DockerPythonRunner 容器隔离范式，数据不出境）/ `mathpix`（出境，仅处理 L1 题目图片，演示可切）。默认 `local`。

2. **LLM 辅导**：默认**境内已备案模型**（DeepSeek/Qwen/GLM，`OpenAICompatibleFeedbackGenerator` 环境变量配置，换模型零改码）。RAG 挂标准解析降幻觉，送模型的 prompt 只含 L1（题目+标准解析）+ 脱敏后 L2，**绝不含 L3**。境外模型（Claude/GPT）作为可配置项，但默认关闭。

3. **架构护栏**：新增一个 **egress classification gate**——任何出网调用（OCR/LLM）前，payload 必须标注数据级别，L3 内容在类型层/运行时被拒绝出境。这是 CONTEXT"不发送学生 PII 给云端"边界的执行化，复用已有 PIIDetector 做 L2 脱敏。

**为什么最优**：既守住"未成年人 PII 不出境"的合规红线（L3 绝不出境、L2 默认境内），又不牺牲功能（L1 题目可用最强的云识别/讲解）；分级而非一刀切，避免了"全本地→功能残废"或"全出境→合规爆雷"的两个极端；且全部通过环境变量配置，Demo 演示与真实部署切换零改码。

**上抛**：egress classification gate 是一个横切基础设施，T03（题库）/T04（OCR）/T05（AI辅导）实现时都要挂它——记入 Notes 作为全局约束。
