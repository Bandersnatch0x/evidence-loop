# ADR 0009：表达式题型的等式拆分与斜抛 2D 可视化

## 状态

已采纳

## 背景

为验证"物理学科的 3D/可视化演示能否进入循证评分闭环"这一设想，选定**斜抛运动的竖直分量 y(t)** 作为第一个切片。设想初稿曾计划：复用 `expression` 题型 + 3D（Three.js/R3F）轨迹 + 80/100 部分分演示叙事。

经架构 grill 与落地核实，初稿有三处不成立：

1. **复用 expression"够用"是不诚实的。** `ExpressionValidator` 校验单表达式代数等价，从不拆等式。而斜抛的提交形式是 `y = v0*sin(theta)*t - 0.5*g*t^2`——mathjs 把含 `=` 的字符串解析成 `AssignmentNode`，`simplify` 在其上抛错，当前路径下这类提交**必然产 `blocked` 而非 `failed`**。这是现存 bug，不是可选增强。
2. **3D 是演示糖，不是验证必要。** 斜抛轨迹是 2D 参数曲线（y 是 t 的函数）。引入 Three.js+R3F+drei（~600KB，项目第一个非轻量前端依赖）画一条曲线是金锤；且 PRODUCT.md 用户画像是机房/老旧设备/键盘操作/WCAG AA，3D 旋转交互与该画像正交。
3. **部分分叙事在当前架构无处落。** 现有客观题 rubric 是单维 `weight:100` 二态（passed/failed），无"按证据条数加权"机制。80/100 分要么由 LLM 编（违反"LLM 不改分"铁律），要么假造证据。

## 决策

1. **扩展 `ExpressionValidator` 的等式拆分（bug 修复，非新 runner）。**
   - 新增 `splitEquationTakeRhs`：提交含 `=`（且非 `==`/`<=`/`>=`/`!=`/`≈` 等关系符）时，按第一个 `=` 拆分，丢弃左侧，右侧作为参与 CAS 比较的表达式。
   - 拆分在 `normalizeExpression` 之前对 raw 文本做，避免 `\\` 清理误吃关系符转义。
   - 单行/多行/JSON 三条提交路径共用此逻辑。
   - **不新增 QuestionType、不新增 EvidenceKind、不新增 runner。** 证据仍是 `cas_check`，id 仍是 `cas-final`/`cas-step-*`。

2. **expected 只存 y(t) 右式，不含 `=`。** x(t) 不校验、不假造——不为"完整斜抛"硬塞第二条方程制造假证据。第一切片只验证竖直分量。

3. **Canvas 2D 画学习者当前提交的 y(t)，不画标准答案轨迹。**
   - 轨迹是 t（水平轴）—y（垂直轴）曲线，不是物理 x-y 空间轨迹（x(t) 未纳入评分，不画）。
   - 固定常量（v0=10, θ=π/4, g=9.8, t∈[0,2]）由题目 `requirements` 声明，Canvas 与（符号级）runner 共用同一组值——无隐藏第二真值源。
   - 学生写错（如漏 `^2`、误用 cos）→ 轨迹明显偏离 → 可视化是反馈而非装饰。

4. **不引 mathjs 到 client bundle。** client 侧从未 import mathjs（server-only）。为画一条曲线引入 ~150KB 是金锤。Canvas 用一个迷你递归下降求值器（数字、t/v0/theta/g、+ - * / ^、sin/cos、括号、一元负号）覆盖本切片需求。

5. **题目级数值容差适配未做。** `ExpressionRunnerSpec` 无 `numericalTolerance` 字段、`createRunnerRegistry` 无参构造，题目级容差注入路径不存在。数值分析结论：`numericalEquivalence` 比的是 `student_RHS - expected_RHS`，等价时差值≈0（浮点误差 1e-13），1e-8 绝对容差安全；不等价时差值量级 10²~10³。故本切片不改容差。

## 未做项（诚实记录，留待后续切片）

- **渲染参数未进 evidence。** 3D/2D 画面是渲染产物，不进 `EvaluationResult.evidence`。可复现性靠"渲染输入 = 提交字符串 + 固定常量，二者都已存证"保证——复核时用同一公式同一常量重算轨迹即可复现。若未来出现"学生质疑看到的轨迹"的真实需求，再做"渲染参数取证"切片（新增 `kind` 或 Provenance 字段）。
- **client/server 等式拆分逻辑重复。** `splitEquationTakeRhs`（server, ExpressionValidator）与 `takeRhs`（client, trajectoryEval）是两份轻量实现。server 代码不应进 client bundle，故未共享。维护漂移风险接受；若逻辑演化频繁，再抽到 `shared/`。
- **数值尺度适配未做。** 依赖"等价时差值≈0"假设；若未来加入近似化简（非精确 CAS），1e-8 绝对容差会与运动方程数值尺度失配，届时再改。

## 砍掉的（YAGNI，留后续切片）

- **3D / R3F / drei / VR。** 第一切片用 Canvas 2D 验证整条证据链。3D 留给真正需要 z 轴的物理切片（如带电粒子三维螺旋运动）。
- **demoVariants 的 80/100 部分分叙事。** 改为对/错二态。部分分留到"步骤链评分"切片（那时 `cas-step-*` 多证据可加权）。
- **`language==='physics'` 通用可视化侧栏分发。** 第一切片直接按 `assignment.id` 硬挂 Canvas，不抽象分发机制。跨学科可视化多了再抽象。
- **self-check 作为切片功能项。** 求值器自检移进 `tests/projectileTrajectoryCanvas.test.ts`，不占产品功能。

## 后果

### 正面
- 修复了含 `=` 提交必然 `blocked` 的现存 bug，`expression` 题型真正支持物理运动方程
- 验证了"非文本提交（运动方程）能被现有 CAS runner 公正判分，且可视化反映被评分对象而非标准答案"这一有架构意义的命题
- 零新 runner、零新 EvidenceKind、零新前端重量依赖，切片最小
- 守住"分数由测试证据算、LLM 不改分、每条结论有出处"三条铁律

### 代价
- 等式拆分逻辑在 client/server 各一份（接受漂移风险）
- 渲染画面暂不可审计（靠输入存证间接保证，非直接证据）
- x(t) 不评分，"完整斜抛"留待后续切片
