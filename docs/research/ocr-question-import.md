# OCR 题目导入的可行方案调研（决策票 TR1）

> 面向 EvidenceLoop（循证实训评测 Agent）"教师侧题库导入"能力的技术选型调研。
> 场景：老师扫描纸质试卷 / 拍照 / 上传 PDF / Word，系统 OCR 识别后结构化成题目（题干 / 选项 / 答案 / 知识点），再经**老师人工校对闸门**入库。
> 已裁决前提：**OCR 只是草稿生成器（draft generator），必过老师人工校对，不自动入库**。
> 难点：数学公式、化学式的识别。
> 调研日期：2026-07-23。方法：一手来源（官方文档、官方 GitHub 仓库、官方定价页、官方 API 文档）优先；WebSearch/WebFetch 在本环境不可用，改用 `gh api` 与 `curl` 直取一手来源。文末列出未证实点。

---

## 0. 结论速览（TL;DR）

- **公式识别不是"通用 OCR + 后处理"能解决的问题**，需要专门的公式识别模型（image→LaTeX）。通用 OCR（Tesseract / 阿里腾讯的通用文字识别）对 `∫ ∑ √ 分式 上下标 矩阵` 基本不可用。
- **三条技术路线**：
  1. **商业公式 OCR API**：Mathpix（image→LaTeX/MMD/SMILES，公式+化学式，$0.002/图起，30 天默认留存/可 24h 删除）——公式与化学式识别质量业内最强，但**数据出境**、按量付费。
  2. **中文云教育 OCR**：百度智能云 OCR 有专门的「公式识别」「试卷切题识别 / 试卷分析与识别」「手写作文识别（多模态）」——**天然贴合中文试卷切题场景**，但仍是云 API（数据出境到国内公有云）。
  3. **开源可本地部署**：PaddleOCR 的 **PP-FormulaNet_plus** 系列（**原生支持中文公式**，Zh-BLEU 达 90.64）+ pix2tex/LaTeX-OCR（英文公式，MIT）——**可完全本地部署、数据不出境**，代价是工程量、GPU 成本与识别上限。
- **电子文档（.docx / 带文本层 PDF）不要走 OCR**：直接解析文本层（mammoth / pdf.js / pdf-parse）远比图片 OCR 可靠。OCR 只用于扫描件与拍照件。
- **对本项目的倾向建议**：**分层方案**——电子文档走解析、扫描/拍照走 OCR+公式识别、**全部汇入同一个"草稿 → 教师校对 → 入库"闸门**。MVP 起点见 §6。

---

## 1. 中文 + 数学公式 + 化学式的 OCR 方案对比

### 1.1 为什么公式必须专门处理

通用 OCR 引擎（如 Tesseract）设计目标是"行文本 → 字符串"，输出是线性文本，**没有二维数学布局的概念**（分式的分子分母、根号覆盖范围、矩阵、上下标嵌套）。要得到可复用的结构化公式，必须用 **image→LaTeX/MathML** 的专门模型。下面按"商业 API / 中文云 / 开源本地"三类对比。

### 1.2 Mathpix（商业公式 OCR，标杆）

一手来源：Mathpix 定价页（[mathpix.com/pricing/api](https://mathpix.com/pricing/api)）、化学用例页（[mathpix.com/use-cases/for-chemistry](https://mathpix.com/use-cases/for-chemistry)）、API 文档（[docs.mathpix.com](https://docs.mathpix.com/)）。

- **能力**：印刷体 + **手写**公式、数学公式、**化学式与化学图（→ SMILES / InChI / InChI Key）**、表格（→ LaTeX/HTML）、整页 PDF。产品线：Convert API（图/PDF/手写 → LaTeX/Markdown）、Files API（整本 PDF）。官方 Convert API 描述原文："Convert images, PDFs, and handwriting to LaTeX, Markdown, and more at scale."（[mathpix.com/pricing/api](https://mathpix.com/pricing/api)）
- **化学**：化学用例页明确 "extract chemical formulas, math equations, and diagrams from PDFs and scanned research papers"，输出支持 **SMILES / InChI / InChI Key**（[mathpix.com/use-cases/for-chemistry](https://mathpix.com/use-cases/for-chemistry)）。
- **准确率**：官方未在定价/用例页给出可引用的量化准确率数字（**未证实**具体百分比，见文末）。业内共识是 Mathpix 在手写+印刷公式上是当前商业质量标杆，但这属于"社区共识"而非本次取到的一手数据。
- **成本**（[mathpix.com/pricing/api](https://mathpix.com/pricing/api)，2026-07 取值）：
  - 一次性 setup fee **$19.99**，含 **$29** 测试额度。
  - **Image Service**：0–1M 张 **$0.002/图**；1M+ 张 $0.0015/图。
  - **PDF（按页）**：0–1M 页 **$0.005/页**；1M+ $0.0035/页。
  - Strokes（手写笔迹）：0–1K 会话免费，1K–100K $0.01/会话……
  - 注：官方声明"图片含 12 行以上文本，保留按 PDF 每页价计费的权利"。
- **数据合规**（关键，[mathpix.com/pricing/api](https://mathpix.com/pricing/api) FAQ 原文）：
  - 默认 **图片保留 30 天**用于质量保证；**可 opt-out，24 小时内删除**。
  - "No Data Retention" 选项：图片与结果 24h 内删除、不落盘。
  - 供应商持有 **SOC 2**（定价页页脚展示）。
  - ⚠️ 无论哪种设置，**图片都会离开本地、上传到 Mathpix（美国）服务器处理** → 对"数据不出境"是硬冲突。

### 1.3 中文云教育 OCR：百度智能云 OCR（最贴中文试卷场景）

一手来源：百度智能云 OCR 文档站（[cloud.baidu.com/doc/OCR](https://cloud.baidu.com/doc/OCR/s/Ok3h7xxva)）、OCR 产品页（[cloud.baidu.com/product/ocr](https://cloud.baidu.com/product/ocr)）。

- 百度智能云 OCR 提供的、**与本场景强相关**的能力（均见文档目录/产品页原文）：
  - **公式识别**（`历史版本/公式识别`，[cloud.baidu.com/doc/OCR/s/Ok3h7xxva](https://cloud.baidu.com/doc/OCR/s/Ok3h7xxva)）
  - **手写文字识别**（`API文档/通用场景文字识别/手写文字识别`）
  - **手写作文识别（多模态）**（`API文档/教育场景文字识别/手写作文识别（多模态）`）——直接对应作文题场景
  - **试卷分析与识别**、**试卷切题识别**（产品页原文出现"试卷分析与识别""试卷切题识别"）——**这是把整张试卷自动切成一道道题的能力，直接命中本项目的"切题→结构化"需求**
  - **文档去手写**（去除手写作答，还原印刷题干）
  - 产品页原文：可识别"作业及试卷中公式、手写文字、题目等内容，可用于智能阅卷、搜题"，并列出"作业批改"场景（[cloud.baidu.com/product/ocr](https://cloud.baidu.com/product/ocr)）。
- **准确率/定价**：本次未取到可引用的一手量化准确率数字与逐条计费单价（百度 OCR 页面为 JS 单页应用，静态抓取拿不到价格表；**未证实**，见文末）。百度文档站说明"注册即可享有一定额度的免费测试资源，使用完毕后可开通按量后付费"。
- **腾讯云**：腾讯云 OCR 有通用/手写识别，但本次**未从一手来源确认腾讯有独立的"公式识别（image→LaTeX）"专用接口**（未证实，见文末）。就"公式+切题"这一组合而言，**百度的教育 OCR 产品线覆盖最完整**。
- **合规**：仍是**公有云 API，数据出境到国内云厂商**。相较 Mathpix（美国），对"境内数据不跨境"要求更友好，但仍不满足"数据完全不出本地/机房"的最严格口径。

### 1.4 开源可本地部署方案

#### (a) PaddleOCR — PP-FormulaNet 系列（首选开源公式识别，**原生中文公式**）

一手来源：PaddleOCR 仓库（Apache-2.0，[github.com/PaddlePaddle/PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR)，86k★）、公式识别模块文档（[docs/version3.x/module_usage/formula_recognition.md](https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/module_usage/formula_recognition.md)）。

- **能力**：公式识别模块输出 **LaTeX 源码**（文档原文："公式识别模块通常会输出数学公式的 LaTeX 或 MathML 代码"）。PP-FormulaNet 支持 **5 万常见 LaTeX 词汇**。
- **中文公式支持**（关键差异点）：文档原文——PP-FormulaNet_plus 训练集"包括中文学位论文、专业书籍、**教材试卷**以及数学期刊"，其中 **PP-FormulaNet_plus-M / -L 新增对中文公式的支持**，最大预测 token 从 1024 扩到 2560（利于复杂公式）。
- **准确率**（官方文档 BLEU 表，一手数据）：

  | 模型 | En-BLEU(%) | Zh-BLEU(%) | 适用 |
  | --- | --- | --- | --- |
  | UniMERNet | 85.91 | 43.50 | 含手写/扫描的真实场景 |
  | PP-FormulaNet-S | 87.00 | 45.71 | 简单印刷、推理快 |
  | PP-FormulaNet-L | 90.36 | 45.78 | 复杂+手写、英文场景 |
  | PP-FormulaNet_plus-S | 88.71 | 53.32 | 增强英文 |
  | **PP-FormulaNet_plus-M** | **91.45** | **89.76** | **中文场景、复杂公式** |
  | **PP-FormulaNet_plus-L** | **92.22** | **90.64** | **中文场景、最高精度** |
  | LaTeX_OCR_rec | 74.55 | 39.96 | 基线（Hybrid ViT+Transformer） |

  （来源：[formula_recognition.md](https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/module_usage/formula_recognition.md) 模型列表 BLEU 表）
  - 官方选型建议原文（FAQ A1）："中文场景居多，则可以使用 PP-FormulaNet_plus-L 或者 PP-FormulaNet_plus-M；……英文场景且算力有限则用 PP-FormulaNet-S。"
  - 注意：BLEU 是文本级相似度，**不等于"题目级完全正确率"**；复杂公式仍需人工校对（与本项目"必过校对闸门"一致）。
- **手写**：UniMERNet / PP-FormulaNet-L 训练集含手写公式，但**手写体准确率显著低于印刷体**是通用规律（文档未给手写单独 BLEU，**未证实**具体手写准确率）。
- **化学式**：PaddleOCR 公式识别聚焦数学 LaTeX，**未见官方声明的化学式→SMILES 能力**（未证实，见文末）。化学式若走 LaTeX（如 `\mathrm{H_2SO_4}`）可行，但化学**结构图 → SMILES** 需 Mathpix 类专门能力。
- **成本**：模型免费（Apache-2.0），成本在 **GPU 推理**（PP-FormulaNet_plus-L 基于 Vary_VIT_B，较重）与工程集成。PaddleOCR 主项目是 Python 生态，需与本项目 Node 服务通过子进程/独立微服务对接（与项目现有 `PythonSubprocessRunner` / `DockerPythonRunner` 模式一致，见 §3）。

#### (b) pix2tex / LaTeX-OCR（轻量英文公式，MIT）

一手来源：仓库 [github.com/lukas-blecher/LaTeX-OCR](https://github.com/lukas-blecher/LaTeX-OCR)（MIT，16.5k★）、README。

- **模型**：ViT（ResNet backbone）编码器 + Transformer 解码器，image→LaTeX。
- **官方性能表**（README，一手）：**BLEU 0.88 / normed edit distance 0.10 / token accuracy 0.60**。
- **部署**：`pip install pix2tex`，模型权重自动下载；提供 CLI、GUI、Streamlit API 与 **Docker 镜像**（`lukasblecher/pix2tex:api`），完全可本地/离线运行。
- **局限**：README 明确以**英文/通用数学**为主，**无中文语料训练**；作者提示"图像分辨率不宜过大""结果需仔细复核""不确定时可换分辨率重试"。→ 对中文试卷场景不如 PaddleOCR PP-FormulaNet_plus，但可作为纯公式片段的轻量兜底。

#### (c) Tesseract（通用文字，**不做公式**）

一手来源：[github.com/tesseract-ocr/tesseract](https://github.com/tesseract-ocr/tesseract)（Apache-2.0，75.5k★）。老牌开源 OCR，支持中文行文本，但**无二维数学公式识别能力**，只能做题干正文的文字层。本项目若自建，正文 OCR 更推荐 PaddleOCR（中英混排、版面分析更强），Tesseract 仅作参考基线。

### 1.5 横向对比表

| 方案 | 公式(印刷) | 公式(手写) | 化学式 | 中文 | 输出格式 | 本地部署 | 成本 | 数据出境 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Mathpix** | 强(标杆) | 强 | **强(→SMILES/InChI)** | 支持 | LaTeX/MMD/HTML/SMILES | ❌ 仅云 | $0.002/图起 + $19.99 setup | ⚠️ 出境(美国) |
| **百度云 OCR** | 有(公式识别) | 有(手写识别) | 未证实 | **强(试卷切题)** | LaTeX(公式)/文本 | ❌ 仅云 | 按量(未证实单价) | ⚠️ 出境(国内云) |
| **PaddleOCR PP-FormulaNet_plus** | 强(Zh-BLEU 90.6) | 有(精度较低) | 未见官方支持 | **原生中文** | **LaTeX/MathML** | ✅ **完全本地** | 免费+GPU | ✅ **不出境** |
| **pix2tex** | 中(BLEU 0.88) | 弱 | ❌ | 无中文训练 | LaTeX | ✅ 完全本地 | 免费+CPU/GPU | ✅ 不出境 |
| **Tesseract** | ❌ | ❌ | ❌ | 支持 | 纯文本 | ✅ 完全本地 | 免费 | ✅ 不出境 |

---

## 2. 输出格式：LaTeX/MathML？结构化拆题靠谁？

### 2.1 公式输出格式

- **能直接产出 LaTeX**：Mathpix（LaTeX / Mathpix Markdown "MMD" / HTML）、PaddleOCR 公式模块（LaTeX，文档也提 MathML）、pix2tex（LaTeX）均直接产 LaTeX。这与项目现有栈契合——EvidenceLoop 前端已用 **KaTeX** 渲染数学（见 ADR-0005 多模态、`docs/DEMO-multimodal-math.md`），LaTeX 可直接喂给 KaTeX 预览校对。
- **化学式**：Mathpix 可产 **SMILES / InChI**（化学结构图）；数学式风格的化学（如 `H_2O`、配平方程）可用 LaTeX 承载。项目已有 `ChemEquationValidator`（`server/runner/ChemEquationValidator.ts`）做化学方程 CAS 校验，OCR 产出的化学式需转成该验证器可消费的格式。

### 2.2 结构化拆题（题干/选项/答案）——OCR 自带 vs LLM 后处理

- **OCR 引擎本身通常只做"版面 → 文本+公式块+坐标"**，不做"这是第 3 题的 B 选项、这是答案"这类**教学语义结构化**。
  - 例外：**百度「试卷切题识别 / 试卷分析与识别」**声称能把试卷切成题目单元（一手：产品页"试卷切题识别"），属于**领域特化的切题**，比通用 OCR 更接近结构化，但仍需确认其输出粒度（未取到字段级 schema，**未证实**）。
  - PaddleOCR 的 **PP-StructureV3**（版面分析）能给出版面块（标题/段落/公式/表格/阅读顺序），但"题干/选项/答案/知识点"这层**教育语义仍需额外处理**。
- **因此，"文本+公式 → 题目 JSON（题干/选项/答案/知识点）"这层结构化，推荐用 LLM 后处理**：把 OCR 的文本+LaTeX 块喂给 LLM，让它按题号切分、抽选项、猜答案区、初标知识点，产出**结构化草稿**。
  - ⚠️ 与项目红线一致：LLM 只做**草稿结构化**，属 `provenance.kind = 'llm_inference'`，**必过教师校对**，绝不自动入库、绝不参与评分（见 `docs/COMPLIANCE.md` "评分与模型边界"、ADR-0001/0008）。知识点标注最终要落到项目的知识点 DAG（`kp.<subject>.*`）。

---

## 3. "本地优先/数据不出境"约束下的选择

EvidenceLoop 合规立场偏本地化（`docs/COMPLIANCE.md`："未配置 `LLM_API_KEY` 时完全离线可运行"；"生产化前必需：脱敏网关、数据分层"）。据此：

- **可完全本地部署（数据不出境）**：
  - **PaddleOCR PP-FormulaNet_plus**（公式，原生中文，Zh-BLEU 90.6）+ **PaddleOCR 检测/识别 + PP-StructureV3**（正文与版面）。
  - **pix2tex**（英文公式兜底，含官方 Docker 镜像）。
  - 正文 OCR 也可用 PaddleOCR（比 Tesseract 中文更强）。
- **代价（本地方案的成本）**：
  1. **技术栈是 Python**：需以子进程或独立微服务对接项目的 Node 原生 HTTP 服务。项目已有成熟范式——`server/runner/PythonSubprocessRunner.ts` 与 `server/runner/DockerPythonRunner.ts`（Docker 池、`--network=none`、cap-drop、非 root），OCR 服务可**复用同一容器隔离范式**，甚至新增一个 `OcrRunner` 走 `RunnerRegistry`。
  2. **GPU 成本**：PP-FormulaNet_plus-L 较重（Vary_VIT_B backbone），实时性/吞吐需 GPU；CPU 可跑但慢。切题+版面+公式是多模型串联，工程与运维量不小。
  3. **手写与复杂公式精度上限**：本地模型手写体、复杂化学结构图弱于 Mathpix；**化学结构图→SMILES 目前无成熟开源本地方案对齐 Mathpix**（未证实有等价开源方案，见文末）。
  4. **需自建切题/结构化**：本地方案没有"试卷切题"现成 API，需 PP-StructureV3 + LLM 后处理自己搭。
- **数据出境权衡**：Mathpix 有 "24h 删除 / no-retention" 选项且持 SOC 2，但图片**仍上传至美国**；百度云为国内公有云。若合规口径是"境内即可"，百度可接受；若是"数据不出机房"，只能走本地 PaddleOCR/pix2tex。**教育场景涉及未成年人数据，跨境是高敏感项**（`docs/COMPLIANCE.md` "教育场景合规提示"），建议在 wayfinder 决策票中把"数据出境是否可接受"作为独立裁决点上抛。

---

## 4. PDF/Word 直接解析 vs 图片 OCR

**结论：电子文档（有文本层）不要走 OCR，直接解析文本层，可靠性和成本都碾压 OCR。OCR 只留给扫描件/拍照件（无文本层的图片）。**

- **.docx（Word）**：docx 是结构化 XML（OOXML），文本、段落、样式都在文件里，**没有识别误差**。可用 **mammoth**（[github.com/mwilliamson/mammoth.js](https://github.com/mwilliamson/mammoth.js)，BSD-2，6.3k★，docx→HTML）直接抽正文与结构。
  - ⚠️ 注意：Word 里的公式若是 **OMML（Office Math）** 需转 LaTeX/MathML（有 OMML→MathML XSLT 方案）；若公式是**图片**则该图片仍需走公式 OCR。这点需要在导入管线里判别。
- **带文本层的 PDF**：用 **pdf.js**（[github.com/mozilla/pdf.js](https://github.com/mozilla/pdf.js)，Apache-2.0，Mozilla 官方，`pdfjs-dist`）或 **pdf-parse**（npm `pdf-parse` 2.4.5，纯 TS，可 Node/浏览器）抽文本层。**扫描成图片的 PDF（无文本层）→ 必须 OCR**。判别方法：抽取文本层，若为空/极少 → 判定为扫描件转 OCR 分支。
- **可靠性排序**：`.docx 解析 ≈ 带文本层 PDF 解析  >>  扫描件/拍照 OCR`。前者无识别误差、可直接拿到字符与（部分）公式结构；后者受清晰度、倾斜、手写、光照影响，误差不可避免 → **正是"必过校对闸门"的核心理由**。
- **对本项目**：这几个库都是 **Node 生态、纯前/后端可跑、无需 GPU、无数据出境**，与项目 TS/Node 栈天然契合，应作为**第一优先分支**。

---

## 5. 输入类型 → 处理分支路由（建议的判定逻辑）

```
上传文件
├── .docx                → mammoth 解析文本层；OMML 公式→MathML/LaTeX；内嵌图片公式→公式OCR
├── .pdf
│    ├── 有文本层         → pdf.js / pdf-parse 抽文本层（+公式判别）
│    └── 无文本层(扫描)   → 转图片 → OCR 分支
└── 图片(拍照/扫描 jpg/png) → OCR 分支
                              ├── 正文        → PaddleOCR 检测+识别 (或云OCR)
                              ├── 公式块      → PP-FormulaNet_plus / Mathpix → LaTeX
                              └── 化学结构图  → Mathpix → SMILES (本地暂无等价)
        ↓ (所有分支汇合)
   文本 + LaTeX/SMILES 块
        ↓
   LLM 结构化后处理 → 题目JSON草稿(题干/选项/答案/知识点, provenance=llm_inference)
        ↓
   ★ 教师人工校对闸门 (KaTeX 预览公式, 改题干/选项/答案/知识点) ★
        ↓
   入库 (进知识点DAG kp.<subject>.*, 走既有题库/RunnerRegistry)
```

---

## 6. 对本项目的倾向性建议

### 6.1 总体倾向：分层方案（与已裁决前提一致）

1. **电子文档走解析**：`.docx` → mammoth；文本层 PDF → pdf.js/pdf-parse。**Node 原生、无出境、无 GPU**，先把"电子试卷导入"这条最可靠的链路打通。
2. **扫描/拍照走 OCR + 公式识别**：正文 + 公式块 + （化学）分开处理。
3. **结构化用 LLM 后处理**，产出题目 JSON 草稿（`provenance.kind='llm_inference'`）。
4. **全部汇入统一的"草稿 → 教师校对 → 入库"闸门**：这是产品红线，也是 OCR/LLM 误差的兜底（`docs/COMPLIANCE.md`、ADR-0001/0008）。

### 6.2 MVP 阶段最务实的起点（建议排期）

- **MVP-0（先做，价值/成本比最高）：只做电子文档解析 + 教师校对 UI。**
  - `.docx`（mammoth）+ 文本层 PDF（pdf.js）→ LLM 拆题草稿 → 教师校对界面（复用前端 KaTeX 渲染公式）→ 入库。
  - 理由：无 OCR、无 GPU、无数据出境、纯 Node 栈、误差最小。**先把"导入→校对→入库"的闭环和校对 UI 跑通**，这套闸门 UI 后续所有分支复用。很多老师本来就有电子版试卷，覆盖面已经不小。
- **MVP-1：接入公式识别（扫描/拍照）。**
  - 若合规允许数据出境 → 直接接 **Mathpix**（最快见效，公式+化学式+手写一站式，$0.002/图起，工程量小，用 24h-delete 选项降风险）。
  - 若要求数据不出境 → 起 **PaddleOCR PP-FormulaNet_plus-M/-L**（中文公式）微服务，复用项目 `DockerPythonRunner` 的容器隔离范式接入。
  - 建议先按 flag 二选一，别一上来两条都建。
- **MVP-2：切题结构化增强 + 化学结构图。**
  - 若走云：评估**百度「试卷切题识别」**替代自建切题。
  - 化学结构图→SMILES 目前建议依赖 Mathpix；纯本地暂无成熟等价方案（未证实）。

### 6.3 与现有架构的契合点

- **容器隔离范式可复用**：OCR/公式微服务（Python）可套用 `server/runner/DockerPythonRunner.ts` 的 `--network=none` + cap-drop + 非 root 池化模式（ADR-0002）。本地 OCR 模型下载后**离线运行**，与"未配 API key 完全离线"立场一致。
- **公式渲染已就绪**：前端 KaTeX（ADR-0005）可直接渲染 OCR 产出的 LaTeX 供教师校对，无需新增渲染栈。
- **化学校验已就绪**：`ChemEquationValidator` 可在入库后对化学题做 CAS 校验。
- **LLM 边界红线**：结构化后处理产物必须 `provenance.kind='llm_inference'` + `requiresTeacherConfirmation`，**不进评分闭环**（`docs/COMPLIANCE.md`、ADR-0008 主观题 Advisory 模式）。
- **合规上抛**：把"OCR 数据是否可出境（Mathpix 美国 / 百度国内云 / 完全本地）"作为 wayfinder 决策票的独立裁决点——因涉未成年人数据，跨境是高敏感项。

---

## 7. 未证实 / 需进一步确认的点（显式标注）

1. **Mathpix 量化准确率**：官方定价页/化学用例页未给出可引用的公式/手写准确率百分比。业内"标杆"是社区共识，非本次一手数据。
2. **百度云 OCR 逐条单价与准确率**：百度 OCR 产品页为 JS 单页应用，静态抓取拿不到价格表与准确率数字；仅确认"按量后付费 + 免费测试额度"。需登录控制台或查最新价格文档确认。
3. **百度「试卷切题识别」输出 schema**：确认了该产品存在（产品页原文），但未取到字段级返回结构（切题粒度、是否含选项/答案分离）。
4. **腾讯云是否有独立"公式识别（image→LaTeX）"接口**：本次未从一手来源确认。腾讯云有通用/手写 OCR，但公式专用接口未证实。阿里云同理未单独确认公式 OCR 接口。
5. **PaddleOCR 化学式能力**：PP-FormulaNet 聚焦数学 LaTeX，**未见官方声明化学结构图→SMILES 能力**。化学方程可用 LaTeX 承载，但结构图识别未证实。
6. **PaddleOCR 手写公式单独准确率**：文档 BLEU 表未区分手写/印刷，手写单独精度未证实（仅知训练集含手写、通用规律是手写显著低于印刷）。
7. **BLEU ≠ 题目级正确率**：PP-FormulaNet Zh-BLEU 90.64 是文本相似度指标，不能直接换算成"整题一次正确率"。这也是"必过校对闸门"的技术依据。
8. **化学结构图→SMILES 的开源本地等价方案**：未找到与 Mathpix 对齐的成熟开源本地方案（存在 DECIMER 等学术项目，但本次未做一手验证，故不列为可选项）。
9. **mammoth 对 Word OMML 公式的转换完整度**：mammoth 主做 docx→HTML，OMML→MathML/LaTeX 需额外 XSLT/工具链，转换完整度未一手验证。

---

## 附：本次使用的一手来源清单

- Mathpix 定价（Convert API）：[mathpix.com/pricing/api](https://mathpix.com/pricing/api)
- Mathpix 化学用例：[mathpix.com/use-cases/for-chemistry](https://mathpix.com/use-cases/for-chemistry)
- Mathpix API 文档：[docs.mathpix.com](https://docs.mathpix.com/)
- 百度智能云 OCR 文档站：[cloud.baidu.com/doc/OCR](https://cloud.baidu.com/doc/OCR/s/Ok3h7xxva)
- 百度智能云 OCR 产品页：[cloud.baidu.com/product/ocr](https://cloud.baidu.com/product/ocr)
- PaddleOCR 仓库（Apache-2.0，86k★）：[github.com/PaddlePaddle/PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR)
- PaddleOCR 公式识别模块文档（BLEU 表）：[formula_recognition.md](https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/module_usage/formula_recognition.md)
- pix2tex / LaTeX-OCR（MIT，16.5k★）：[github.com/lukas-blecher/LaTeX-OCR](https://github.com/lukas-blecher/LaTeX-OCR)
- Tesseract（Apache-2.0，75.5k★）：[github.com/tesseract-ocr/tesseract](https://github.com/tesseract-ocr/tesseract)
- mammoth.js（docx 解析，BSD-2）：[github.com/mwilliamson/mammoth.js](https://github.com/mwilliamson/mammoth.js)
- pdf.js（Mozilla，Apache-2.0）：[github.com/mozilla/pdf.js](https://github.com/mozilla/pdf.js)
- pdf-parse（npm 2.4.5）：[npmjs.com/package/pdf-parse](https://www.npmjs.com/package/pdf-parse)
