# [wayfinder:grilling] T04 扫描导入 + OCR 人工校对闸门

## Question
老师扫纸质卷/图片导入。D3 已裁决：OCR 只是草稿，必过人工校对闸门。要定：
- OCR 技术路线（第三方 API vs 本地；数学公式/化学式识别怎么办——见 research 票）
- 校对闸门 UI：识别结果逐题确认/修正 → 才入库
- 结构化拆分：一张卷子 OCR 后如何拆成多道结构化题
- 失败降级：识别质量差时的体验

**Blocked by**: T03（题的结构化模型先定），T-R1（OCR 能力调研）

---

## ✅ 已解决（resolution）

**状态**：closed。基于 TR1 调研 + D2（OCR 人工闸门）+ T10（数据出境分级）。

### 技术路线（分层，对齐 TR1 + T10）
- **MVP-0（先做，零合规风险）**：电子文档解析——`.docx`（mammoth）/ 带文本层 PDF（pdf.js/pdf-parse）直接抽文本，纯 Node、无 GPU、无出境。**校对 UI 在此建，后续所有分支复用**。
- **MVP-1（按需，境内闭环）**：图片/扫描件公式识别用 **PaddleOCR 本地微服务**（Zh-BLEU 90+，复用 `DockerPythonRunner` 容器隔离范式，数据不出境）。**不选 Mathpix**（T10 裁决：题目内容虽 PII 弱，但保守境内，且避免美国出境叙事负担）。
- **MVP-2（增强）**：试卷切题 + 化学结构图（留 fog，非本期必须）。

### 人工校对闸门（D2 核心，不可绕过）
```
扫描/上传 → OCR/解析生成"草稿题" → 老师逐题确认/修正（题干/选项/答案/知识点标注）→ 才入库
```
- 草稿题状态 `draft`，**不能用于测评态**，直到老师确认转 `published`。
- OCR 只是"省打字的草稿生成器"，老师是权威——OCR 再烂也不污染证据（对齐 D2 authored_key 可信度分级）。

### 结构化拆分
- OCR/解析产出整卷文本 → **LLM 后处理**拆成题干/选项/答案候选（`provenance.kind='llm_inference'`，必过校对，绝不入评分）。
- 拆分结果填入 T03 的 Question 录入表单，老师在校对 UI 里修正。

### 失败降级
- OCR 质量差（低置信度）→ 标红该题，提示老师手工录入或重传。
- 数学公式/化学式识别失败 → 降级为纯文本 + 老师用 T03 的 LaTeX 编辑器补。

### 关联
[[TR1-ocr-research]] [[T03-question-bank]] [[T10-data-egress-compliance]]，落实 D2。落盘依据 `docs/research/ocr-question-import.md`。
