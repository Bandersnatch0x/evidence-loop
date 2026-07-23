# ADR 0008：按题型切分的多学科评分架构

## 状态

已采纳

## 背景

需求要覆盖初中 + 高中全部 9 门学科（语文、数学、英语、物理、化学、生物、政治、历史、地理）。

一个直觉的做法是"每个学科一个 Runner"。但这会做出 9 个高度重复又各自残缺的引擎——一道初中物理选择题和一道高中化学选择题的评分逻辑完全相同，按学科切分会重复实现 9 次选择题验证。

同时，ADR-0001 的铁律要求"分数只来自可复现证据"。不同题型对这条铁律的适用性天差地别：客观题（选择/填空/数值/表达式/方程式/代码）有可复现证据；主观题（论述/简答/作文立意/阅读理解）**没有可复现证据**，无法自动给出正式分。

## 决策

1. **按「题型」切分评分能力，不按「学科」切分。** 学科只是知识点归属维度，不决定评分逻辑。
   - `QuestionType` 枚举：`choice`（选择）、`fill_blank`（填空）、`numeric`（数值容差）、`expression`（数学/物理表达式，CAS 等价）、`chem_equation`（化学方程式配平）、`code`（代码测试，已有）、`essay`（作文/论述，主观）。
   - 每个题型一个验证器，学科无关。一道初中物理选择题和高中化学选择题共用同一个 `ChoiceValidator`。

2. **客观题入正式分，主观题走 AdvisoryLayer。**
   - 客观题（choice/fill_blank/numeric/expression/chem_equation/code）产出可复现 Evidence，经 Rubric 计算正式分。
   - 主观题（essay 及各科论述/简答/阅读理解）：可复现的客观维度（字数、结构、关键词命中、语法）产出 Evidence 入分；立意、洞察、论证质量等无证据维度由 LLM 产出 `AdvisorySuggestion`，标注 `provenance: llm_inference`，**不入正式分，教师确认后才计入 Cohort 指标**。

3. **学科 = 知识点 DAG 的归属维度。** 9 门 × 初高中各一套知识点 DAG（`kp.<subject>.<topic>`），挂在题目上。学科不决定"怎么评分"，题型才决定。掌握度、依赖链诊断、FSRS 复习调度全部学科无关地复用现有 #2 基础设施。

4. **交付分两阶段。** 第一阶段：通用题型引擎 + 数理化标杆（choice/fill_blank/numeric/expression/chem_equation 走通完整闭环）。第二阶段：文史政地生的知识点 DAG + 客观题 + 主观题 AdvisoryLayer 铺开。

## 后果

### 正面
- 题型验证器可复用，9 门学科不重复造轮子
- 守住 ADR-0001 铁律：客观题可复现评分，主观题诚实地不入分
- 学科铺开变成"加知识点 DAG + 题目数据"的内容工作，不是架构工作
- 掌握度/复习/诊断（#2）天然复用，无需改动

### 代价
- 需要先泛化 Runner 抽象（`EvidenceKind`、`Assignment.language/questionType`、`RunnerSpec` union、`RunnerRegistry`）——贯穿类型层到编排层
- 主观题不能自动给正式分，可能与"全学科自动评分"的直觉预期有落差——这是守铁律的必然，通过 AdvisoryLayer + 教师终裁弥补
- 全学科知识点 DAG 是海量内容工作，需分批建设

## 关联
- ADR-0001（证据优先评分）：本 ADR 是其在多学科场景的具体化，不修改任何决策
- ADR-0004（多学科证据模型）：本 ADR 把"多学科"进一步细化为"按题型切分"，`Runner + Rubric` 抽象不变
- ADR-0006（Provenance）：主观题的 LLM 建议走 `llm_inference` provenance
