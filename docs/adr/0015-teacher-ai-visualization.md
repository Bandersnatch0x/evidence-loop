# ADR 0015：教师 AI 生成自定义 3D 演示场景

## 状态

已采纳

## 背景

ADR-0013/0014 落地统一可视化套件 + 内置 3D/2D 场景（分子/截面/晶体/抛物线）。但内置不可穷举——教师有自己的教学想法（某具体分子、自定义结构），不可能都靠预置。

用户决策（AskUserQuestion 确认）：① 机制 = **AI 自然语言生成**；② 范围 = **仅可视化场景**（不生成题型/判分）。即教师写描述 → LLM 生成几何 → 3D 预览 → 确认 → 绑定到题目展示层。判分仍走题目原有题型，不动。

**PRODUCT.md 边界**：LLM 用于"教师侧教学素材起稿"（创意辅助），不用于学生侧改分。生成结果必须经 3D 预览 + 教师确认才入库；存的是确认后的确定数据，渲染可复现，不进评分证据链。界面标注"AI 生成 · 教师已确认"（与 AdvisoryLayer 的 llm_inference provenance 同立场）。

## 现有可复用件（探索发现，非新造）

- **`server/tutoring/callOpenAICompatible.ts`**：`callOpenAICompatible(messages, zodSchema, opts)` + `resolveLlmProvider()`——OpenAI 兼容 LLM 调用 + JSON 抽取 + zod 校验，环境变量 `LLM_API_KEY/LLM_BASE_URL/LLM_MODEL`，无配置返回 null。几何生成直接复用，零新 I/O 件。
- **adopt-solution 范式**（questionRoutes.ts）：T09 已实现"AI 草稿→教师确认→入库"双路由。自定义几何走完全同型 `preview-visualization` + `adopt-visualization`。
- **`solution_json` 存储先例**（migration 0004 / QuestionStore）：T09 AI 生成标准解答的存储模式。自定义几何加同型 `visualization_json` 字段（migration 0007）。
- **`MoleculeGeometry {atoms, bonds}` + `shared/BallStick.tsx`**：球棍几何的通用 schema + 渲染件，分子/晶体/教师自定义共用。

## 决策

1. **几何以 `kind` 多态扩展。** MVP 球棍（`kind:'ball_stick'`）；Phase 4 曲线（`kind:'curve'` + 可选 `secondaryPoints`）；Phase 7 图元（`kind:'primitives'`，nodes+edges）覆盖电路/节点示意图。三种 kind 同型「纯数据 + zod」，不混用布局求解器。

2. **曲线表示形式 = 预采样点数组（非参数方程）。** AI 直接输出 `points: [[x,y,z],...]`（2–2000 点、三元有限），CurveScene 用 R3F `<Line>` 画。与球棍同型"纯数据 + zod 校验"，不引表达式求值。DNA 双螺旋用 `secondaryPoints` 画第二条链；碱基对横线（混合球棍+曲线）留后续。

3. **zod schema 是信任边界。** LLM 提议的几何必须经 `visualizationSchema.parse` 校验才能入库或渲染：球棍侧原子 id 唯一、bond 端点存在、position 三元有限、原子数 1–200；曲线侧 points 非空 2–2000、三元有限。schema 为 `z.union([ballStick, curve])`（ballStick 带 superRefine，不能用 zod `discriminatedUnion`）。教师 3D 预览是第二道（人眼）检查。读时容错：非法 visualization_json 被静默丢弃（不影响评分字段）。

4. **存储复用 solution_json 模式。** Question 加 `visualization?` 字段，migration 0007 加 `visualization_json TEXT` 列 + `ensureQuestionVisualizationColumn` backfill（同 solution 的双保险）。QuestionStore save/get 读写，validateQuestionDraft 校验。

5. **API 双路由复用 adopt-solution 范式。** `POST /api/questions/:id/preview-visualization`（生成不入库）+ `POST /api/questions/:id/adopt-visualization`（确认入库，null 清除）。教师私有 + 所有权检查（同所有 question 路由）。

6. **学生侧 visualization 透传（Phase 5）。** `GET /api/assignments/:id`：① demo registry 命中 → 合并 `seed:<id>` 或裸 id 题上的 visualization；② registry 未命中但题库有该 id（私有题 / `seed:…`）→ `projectQuestionToAssignment` 投影为工作台壳并带上 visualization。学生从今日练习点开私有题时，`questionId` 即 workspace id，Visualizer 可按 kind 渲染。评分为独立路径（私有题完整 runner 投影仍可后续加强）。

7. **Visualizer 优先级：assignment.visualization 覆盖 registry，再按 `kind` dispatch。** 有教师确认几何时：`ball_stick` → BallStickScene，`curve` → CurveScene，`primitives` → PrimitivesScene；无则回退 registry 内置场景。教师自定义覆盖内置演示。

8. **通用 scene + 懒加载。** BallStickScene / CurveScene / PrimitivesScene 均接收 Visualization 分支 props（几何来自 props 而非硬编码）。VisualizationGenerator 与 Visualizer 均 lazy import 对应 scene——避免把 three 拉进主 chunk（修复实测：主 index chunk 曾涨到 1495KB，lazy 后回落 ~572KB）。

## 未做项（诚实记录，留待后续切片）

- ~~**曲线类几何未做。**~~ **已做（Phase 4）。** `kind:'curve'` + CurveScene + SYSTEM_PROMPT 曲线分支 + schema/测试。
- ~~**图元类几何（`kind:'primitives'`）未做。**~~ **已做（Phase 7）。** nodes+edges schema、PrimitivesScene、SYSTEM_PROMPT 图元分支；`numeric-ohm-law` 预置串联电路示意。
- ~~**DNA 碱基对横线未做。**~~ **已做（Phase 8）。** `curve.crossBars` 两端点段；CurveScene 绘制横档；DNA demo 预采样 `barEvery` 横线。
- ~~**学生侧私有题 visualization 透传未闭环。**~~ **已做（Phase 5）。**
- ~~**私有题完整评分 runner 投影未做。**~~ **已做（Phase 6）。**
- ~~**曲线/双螺旋 demo seed 未预置。**~~ **已做。**
- ~~**生成几何的自动化学校验未做。**~~ **已做（Phase 8）。** `geometrySanity`：hard 进 zod 拒存；soft 警告随 generate 返回（非完整化学模拟）。
- ~~**学生侧触发生成未做。**~~ **已做（Phase 8）。** `POST /api/student/preview-visualization` + `StudentVizPreview`：**仅预览永不入库**。
- ~~**LLM 未配置时的手动几何录入未做。**~~ **已做（Phase 8）。** 教师 VisualizationGenerator 支持粘贴 JSON → 预览 → adopt（服务端 schema 仍为信任边界）。

## 砍掉的（YAGNI，留后续切片）

- **新 `visualization` QuestionType。** 可视化是展示层，挂在 Question 上，不是新题型。判分走题目原有题型。
- **visualization 进证据链。** 渲染参数不进 evidence（延续 0009/0010/0012 立场）。可视化是教师备课素材，不是评分依据。
- **按学科分教师自定义渲染器。** 教师自定义几何按 `kind` 选 scene（球棍/曲线），不按学科再拆渲染器。学科差异在几何数据。
- **曲线参数方程求值。** 不引 ExpressionValidator；AI 预采样点数组即可表达螺旋/轨迹。

## 与 0009/0013 的关系

- **同 0009 立场**：LLM 不改分、不改 evidence。LLM 在 0009 是反馈起稿，在 0015 是演示起稿——都是"创意辅助"，存的是确认后确定数据。
- **扩展 0013 套件**：套件从"内置场景集"升级为"教师可生成场景"。BallStickScene / CurveScene 是套件中接收 props 几何（非硬编码）的 scene，验证套件能承载外部数据与多 `kind`。

## 后果

### 正面
- 产品从"内置 demo 集合"升级为"教师可生成自定义演示的工具"，内置不可穷举的问题被结构性解决
- 复用 callOpenAICompatible + adopt-solution + solution_json 三套先例，零新基础设施
- 球棍 + 曲线 + 图元覆盖分子/晶体/磁场螺旋/DNA 骨架/电路示意等常见演示
- zod schema + 教师预览双重把关，LLM 生成不确定性受控
- 私有题透传与 payload 评分投影已闭环；demo 曲线/电路可视化可无 LLM 预置

### 代价
- 依赖 LLM 配置（`LLM_*` 环境变量），未配置时 AI 生成不可用；可用手动 JSON 录入兜底
- 几何 sanity 是边界规则而非完整化学/物理校验；最终仍以教师确认为准
- 学生生成仅预览、不能写题库（产品边界）
