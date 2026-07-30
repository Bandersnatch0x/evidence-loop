# ADR 0011：多表达式 CAS 校验与完整斜抛 2D 可视化

## 状态

已采纳

## 背景

ADR 0009 验证了"单表达式（y(t)）能被 CAS runner 公正判分"，并在砍掉项里留了一条："x(t) 不评分、不假造——不为'完整斜抛'硬塞第二条方程制造假证据"。第二切片（A）要回答：**完整斜抛（x(t)+y(t) 两条）能否在现有证据架构里被公正判分，且可视化反映完整抛体而非半个？**

ADRs 0009/0010 留下的约束：
- 0009 守了"不新增 QuestionType/EvidenceKind/runner"，且验证了单 `cas_check` 证据对单表达式。
- 0010 突破"三不新增"时立了边界：新 QuestionType 仅当现存题型无法承载。x(t)+y(t) 是两条独立 CAS 等价检查——`expression` 题型完全能承载，只是 runner spec 当前只认一条 `expectedLatex`。

## 决策

1. **复用 `expression` 题型，不新增 QuestionType。** 给 `ExpressionRunnerSpec` 加可选 `answers: Record<string,string>`。当 `answers` 存在，`ExpressionValidator` 走多表达式分支，对每个 label 发 `cas-<label>` 证据、各自比对。`expectedLatex` 在此模式忽略。新增的只是 spec 字段 + runner 内分支，不新增题型/EvidenceKind/runner 注册。

2. **Labeled submission 语法：行式 `label = rhs` 或 JSON `{label:rhs}`。**
   - 行式：每行一个等式，`x = v0*cos(theta)*t\ny = v0*sin(theta)*t - 0.5*g*t^2`。label 小写、去空白。
   - JSON：`{"x":"...","y":"..."}`，便于程序化提交。
   - `parseLabeledSubmission` 复用 `splitEquationTakeRhs`（0009 的等式拆分）。缺失 label → 空串 → 下游 `blocked`（不是 throw）。
   - 关系符（`==`/`<=`/`\le` 等）沿用 0009 的保护：不拆，整串进入 mathjs，失败记 blocked 而非误拆。

3. **每分量独立证据，各自权重。** `cas-x`（weight 50）+ `cas-y`（weight 50）。`scoreDimensions` 按现有规则聚合：x 对 y 错 → 50 分，correctness 维度 `failed`（一条 failed → 维度 failed）；y 缺失 → cas-y `blocked`，correctness 维度 `blocked`（无 failed 有 blocked）。不引入新评分机制，复用 0008 的维度聚合。

4. **Canvas 2D 画物理 x-y 空间抛物线（不是 t-vs-y）。**
   - `computeXYTrajectory` 纯函数：解析 `x=`/`y=` 两条，同 t 网格采样，任一失败返回 null。
   - `ProjectileXYCanvas`：x 水平轴、y 垂直轴，等比例（equal aspect）防止抛物线被拉伸失真，标 t=0 起射点。
   - 画学习者当前提交，不画标准答案轨迹。固定常量（v0=10, θ=π/4, g=9.8, t∈[0,2]）与题目声明、与（符号级）runner 共用——无隐藏第二真值源。
   - 求值器仍用 0009 的迷你递归下降（数字/t/v0/theta/g/+−*/^/sin/cos/括号/一元负号），不引 mathjs 到 client bundle。

## 未做项（诚实记录，留待后续切片）

- **渲染参数仍不进 evidence。** 0010 给截面题加了 `render_artifact`（weight=0 审计证据），因为"画面是否复现"对几何截面是真实问题。斜抛轨迹的可复现性仍靠"提交字符串 + 固定常量都已存证"间接保证——学生质疑轨迹的需求未出现，不为对称而硬塞。若未来出现，再按 0010 的 render_artifact 模式补。
- **client/server 等式拆分逻辑重复。** `splitEquationTakeRhs`（server, ExpressionValidator）与 `takeRhs`/`extractLabeled`（client, trajectoryEval）是两份轻量实现。延续 0009 的约定：server 代码不进 client bundle，不共享，接受漂移风险，测试对齐。
- **labeled submission 不校验 label 集合完整性。** `parseLabeledSubmission` 只解析出现的 label，缺失的留空串 → blocked。不强制"必须恰好包含 spec.answers 的全部 key"——若学生多写一条无关 label，被忽略（无副作用）。

## 砍掉的（YAGNI，留后续切片）

- **新 `equation_set` QuestionType。** 规划时考虑过为"多方程题"立独立题型。核实发现 `expression` + `spec.answers` 完全够用——多方程的本质是 N 条独立 CAS 检查，不是新判定逻辑。新题型是无需求抽象。
- **步骤链（`steps`）与多表达式（`answers`）混用。** 现有 `steps` 走 `cas-step-*` 连续等价检查，`answers` 走 `cas-<label>` 并行独立检查。两条路径互斥（runSync 里 `answers` 优先 return）。混合用例未出现，不抽象统一。
- **3D 抛体。** 完整斜抛是 2D 平面运动（x-y），无 z。等比例 2D 已如实反映抛体形状；3D 仍留给真正需要 z 轴的切片。

## 后果

### 正面
- x(t)+y(t) 两条方程各自公正判分，无假造证据——补上 0009 留的"完整斜抛"
- 零新 QuestionType/EvidenceKind/runner，仅 spec 字段 + runner 内分支，切片最小
- 复用 0009 的等式拆分、迷你求值器、维度聚合——零回归（现有 expression 测试全绿）
- Canvas 画物理 x-y 空间而非 t-vs-y，可视化反映被评分对象的整体

### 代价
- `splitEquationTakeRhs`/`takeRhs` client/server 两份（延续 0009 漂移风险）
- labeled submission 语法是新表面，需文档说明（题目 `requirements` 已写"每行一个等式，先 x 后 y"）
- 渲染参数不进 evidence（斜抛可复现性仍间接保证，非直接证据）
