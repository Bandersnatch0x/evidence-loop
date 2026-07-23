# [wayfinder:research] TR1 OCR 能力调研（数学/化学公式识别）

## Question
调研 OCR 方案，尤其数学公式、化学式、中文题干的识别可行性与准确率。一手来源：Mathpix/百度/腾讯/阿里 OCR API 文档、开源方案（如 pix2tex/LaTeX-OCR）。产出选型建议 + 准确率预期 + 成本，写入 research/ 供 T04 引用。

**Blocked by**: 无（可立即并行）

## 状态：已解决（research 完成）

产物：`docs/research/ocr-question-import.md`

**核心结论**：
- 分层方案：MVP-0 电子文档解析（.docx/带文本层 PDF，纯 Node、无 GPU、无出境）+ 校对 UI；MVP-1 接公式识别（可出境→Mathpix / 须本地→PaddleOCR P-FormulaNet，Zh-BLEU 90.6）；MVP-2 切题+化学结构图
- 三者都产 LaTeX（契合已有 KaTeX + ChemEquationValidator）
- 教育语义结构化（题干/选项/答案/知识点）OCR 不自带，需 LLM 后处理，产物标 `llm_inference` + 必过校对，绝不入评分闭环
- 统一"草稿→教师校对→入库"闸门 —— 印证 D2 裁决

**上抛新决策点**：因涉未成年人数据，"OCR 数据可否出境"（Mathpix 美国 / 百度国内云 / 完全本地 PaddleOCR）需独立裁决 → 已 graduate 为 T10。
