# ADR 0010：立体几何截面题型与渲染取证证据

## 状态

已采纳

## 背景

ADR 0009 验证了"非文本提交（运动方程）能被现有 CAS runner 公正判分"，并在未做项里留了一条："若未来出现学生质疑看到的轨迹的真实需求，再做渲染参数取证切片（新增 `kind` 或 Provenance 字段）"。第二切片要回答两个 0009 留下的命题：

1. **3D/可视化能否被审计？** 0009 的渲染参数没进 evidence，可复现性靠"提交字符串 + 固定常量都已存证"间接保证。若画面本身成为复核对象，需要一条直接证据。
2. **题型扩展的边界在哪？** 0009 守了"三不新增"（不新增 QuestionType/EvidenceKind/runner）。但立体几何截面（正方体被平面截出的多边形形状）无法塞进任何现存题型——它是顶点集匹配 + 几何凸性判定，不是 CAS 代数等价、不是客观选项、不是作文结构。

切片 C 选定"正方体截面形状识别"：学生提交截面顶点编号（如 `A,B,C,D`），判定截面是几边形、是否共面凸。这是 0009 未做项里"渲染参数取证"的直接落地，也是第一个真正需要新 QuestionType 的题型。

## 决策

1. **新增 `geometry` QuestionType + `GeometryRunner`。**
   - `shared/contracts.ts` 的 `QuestionType` 加入 `geometry`；`EvidenceKind` 加入 `render_artifact`。
   - `GeometryRunnerSpec`：`{ kind:'geometry', vertices: Record<id,[x,y,z]>, sectionVertexIds:[] }`。顶点表是题目的几何真值源。
   - `GeometryRunner` 发三条证据：
     - `shape-vertices`（`answer_match`，weight 50）：截面顶点数 ∈ {3,4,5,6}。
     - `shape-convex`（`answer_match`，weight 50）：Newell 法向 + 平面 2D 基 + 连续叉积同号判共面凸。
     - `render-artifact`（`render_artifact`，weight 0）：JSON 快照 `{submission, vertexIds, vertices, projection:'isometric', sampleCount:200}`，状态恒 `passed`。
   - 纯向量数学，无外部几何库（stdlib 优先，几个叉积/点积就够）。

2. **`render_artifact` 是 weight=0 的审计只读证据，挂 `render` 维度。**
   - 新增 rubric 维度 `render`（`maxScore:0`），承载 `render-artifact`。`scoreDimensions` 里 `earnedScore = sum(state==='passed' ? weight : 0)`，weight=0 → 恒 0 分。
   - 这条证据让"学生看到的画面"可复核：教师视图用同一组 `vertices` + `projection` + `vertexIds` 重算即可复现画面，不必依赖"提交字符串隐含画面"。

3. **形状识别用 `answer_match` kind，不拉伸 `cas_check`。**
   - 截面形状识别 = 顶点集匹配 + 几何性质判定，不是代数等价。硬塞 `cas_check` 是不诚实。`answer_match`（匹配答案集）更贴切。

4. **Canvas 2D 等轴测画立方体 12 边 + 学习者截面多边形高亮。**
   - 投影是纯函数 `projectIso`/`projectToViewport`，可单测，不依赖 DOM。
   - 画学习者当前提交的截面（蓝高亮），不画标准答案截面。
   - 顶点表 `UNIT_CUBE_VERTICES` 在 `src/components/student/cubeProjection.ts`，与 `GeometryRunnerSpec.vertices`（server/data/assignments.ts）同值——遵循 0009 物理切片"固定常量两边硬编码、靠测试对齐"的约定，不把 server RunnerSpec 引进 client `Assignment` 类型。

## 未做项（诚实记录，留待后续切片）

- **顶点表 client/server 重复。** `UNIT_CUBE_VERTICES`（client）与 `cubeSectionAssignment.runner.vertices`（server）是两份同值数据。不抽到 `shared/`：server 的 `ExecutableAssignment.runner` 是 server-only 类型，client 的 `Assignment`（contracts）不带 runner，强行共享要改两边类型签名。物理切片已是此模式，接受漂移风险，由 `tests/geometryAssignment.test.ts` + `tests/cubeSectionCanvas.test.ts` 对齐。
- **线面垂直 / 二面角未做。** 本切片只判截面形状（顶点数 + 共面凸）。线面关系、二面角是更深的立体几何概念，留给后续几何切片。
- **3D 旋转交互未做。** 等轴测是单一固定视角，无旋转/缩放。与 PRODUCT.md 画像（机房/键盘/WCAG AA）一致；3D 旋转交互仍留给真正需要 z 轴自由观察的切片。

## 砍掉的（YAGNI，留后续切片）

- **把渲染求值抽到 `shared/`。** 规划时曾提"抽 trajectoryEval 到 shared 供 client/server 共用"。核实发现 server 从不 import 它——runner 用向量数学判凸性，不做数值求值；客户端 recalc 在 client。分歧是假设的，抽取是无需求抽象。砍掉。
- **`render_artifact` 挂 `correctness` 维度。** 规划曾想把渲染取证挂正确性维度。但 `scoreDimensions` 里 `hasFailure`/`hasBlocked` 会污染 correctness 状态——审计证据不该影响正确性判定。独立 `render` 维度（maxScore=0）隔离状态。
- **3D 库（Three.js/R3F）。** 等轴测投影是 `(x-y)*cos30, (x+y)*sin30 - z` 两行公式。为画立方体引 600KB 是金锤。

## 后果

### 正面
- 突破了 0009 的"三不新增"——但突破是有边界的：新 QuestionType 仅当现存题型无法承载（截面是顶点集匹配，非代数/客观/作文）；新 EvidenceKind 仅当画面本身要可审计（`render_artifact` weight=0 不计分）
- 验证了"渲染参数取证"命题：画面成为可复核的直接证据，而非靠输入间接保证
- 几何判定纯函数可单测，零外部几何库

### 代价
- 顶点表 client/server 两份（接受漂移，测试对齐）
- 立体几何题型录入表单未做（`QuestionEditor` 对 geometry 显示"暂不支持在此表单录入"，题目数据目前直写在 assignments.ts）
- 仅等轴测固定视角，无 3D 旋转
