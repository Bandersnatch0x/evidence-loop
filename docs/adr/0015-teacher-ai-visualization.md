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

1. **MVP 聚焦球棍类几何（atoms/bonds），覆盖分子/晶体/DNA。** 磁场螺旋/电路是曲线/图元类，schema 不同。`visualization_json` 的 `kind` 判别字段留多态扩展点（`ball_stick` 是 MVP 唯一值），后续可加 `curve`/`primitives` 而不破坏现有数据。

2. **zod schema 是信任边界。** LLM 提议的几何必须经 `visualizationSchema.parse` 校验才能入库或渲染：原子 id 唯一、bond 端点引用存在的原子、position 三元有限数值、原子数 1–200。教师 3D 预览是第二道（人眼）检查。读时容错：非法 visualization_json 被静默丢弃（不影响评分字段）。

3. **存储复用 solution_json 模式。** Question 加 `visualization?` 字段，migration 0007 加 `visualization_json TEXT` 列 + `ensureQuestionVisualizationColumn` backfill（同 solution 的双保险）。QuestionStore save/get 读写，validateQuestionDraft 校验。

4. **API 双路由复用 adopt-solution 范式。** `POST /api/questions/:id/preview-visualization`（生成不入库）+ `POST /api/questions/:id/adopt-visualization`（确认入库，null 清除）。教师私有 + 所有权检查（同所有 question 路由）。

5. **学生侧合并：getAssignment 合并 seed question 的 visualization。** demo assignment 与 seed question 一一对应（`seed:<assignmentId>`）。`GET /api/assignments/:id` 时查 `seed:<id>` 的 visualization，有则合并进返回的 Assignment。教师给 seed question 加 visualization → 学生打开对应 demo assignment 看到。

6. **Visualizer 优先级：assignment.visualization 覆盖 registry。** Visualizer 先看 `assignment.visualization`，有则渲染通用 BallStickScene（教师自定义）；无则回退 registry 内置场景。这让教师自定义覆盖内置演示。

7. **通用 BallStickScene + 懒加载。** 新 `BallStickScene.tsx` 接收 Visualization props 渲染（与 MoleculeScene/CrystalScene 同型，但几何来自 props 而非硬编码）。教师生成入口（VisualizationGenerator）也 lazy import BallStickScene——避免把 three 拉进教师表单主 chunk（修复实测：主 index chunk 曾涨到 1495KB，lazy 后回落 572KB）。

## 未做项（诚实记录，留待后续切片）

- **曲线/图元类几何未做。** 磁场螺旋/电路/细胞是曲线或图元，schema 不同。`kind` 多态扩展点已留，球棍类 MVP 先行。
- **生成几何的自动化学校验未做。** 配位数/键角/键长是否合理靠教师 3D 预览肉眼判断。若未来出现"LLM 生成错误结构未被教师发现"的真实问题，再加化学规则校验。
- **学生侧触发生成未做。** 当前仅教师角色可生成（题库教师私有）。学生侧看的是教师确认后的确定数据。
- **LLM 未配置时的降级路径。** 生成器返回 `no-llm` 错误，UI 提示"未配置 LLM，可改用手动几何录入"。手动几何录入器（不经 LLM 直接填原子表）未做——YAGNI，当前无 LLM 配置的教师用内置 demo 场景即可。

## 砍掉的（YAGNI，留后续切片）

- **新 `visualization` QuestionType。** 可视化是展示层，挂在 Question 上，不是新题型。判分走题目原有题型。
- **visualization 进证据链。** 渲染参数不进 evidence（延续 0009/0010/0012 立场）。可视化是教师备课素材，不是评分依据。
- **教师自定义几何的"题目→场景类型"路由。** Visualizer 用 BallStickScene 统一渲染所有教师自定义几何（都是球棍），不按学科分场景。学科差异在几何数据，不在渲染器。

## 与 0009/0013 的关系

- **同 0009 立场**：LLM 不改分、不改 evidence。LLM 在 0009 是反馈起稿，在 0015 是演示起稿——都是"创意辅助"，存的是确认后确定数据。
- **扩展 0013 套件**：套件从"内置场景集"升级为"教师可生成场景"。BallStickScene 是套件第一个接收 props 几何（非硬编码）的 scene，验证套件能承载外部数据。

## 后果

### 正面
- 产品从"内置 demo 集合"升级为"教师可生成自定义演示的工具"，内置不可穷举的问题被结构性解决
- 复用 callOpenAICompatible + adopt-solution + solution_json 三套先例，零新基础设施
- 球棍类覆盖分子/晶体/DNA 等教师最常见需求，`kind` 多态为曲线/图元类留扩展点
- zod schema + 教师预览双重把关，LLM 生成不确定性受控

### 代价
- 依赖 LLM 配置（`LLM_*` 环境变量），未配置时生成不可用（降级提示，不崩）
- 球棍类之外的场景（磁场螺旋/电路）仍需内置或后续切片扩展 schema
- 生成几何的化学正确性靠教师肉眼，无自动校验
