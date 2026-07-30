# ADR 0014：晶体结构 3D 场景与套件首个学科扩展

## 状态

已采纳

## 背景

ADR-0013 落地统一可视化套件（`src/components/visualizer/`），分子与截面两个真3D 场景已可旋转。本切片是套件的**第一次学科扩展**——化学晶体结构，对应用户头脑风暴里"化学晶体结构"演示模式。

晶体结构与分子的关键差异：晶体是**周期性重复单元**（晶胞），原子数远多于单分子（NaCl 标准晶胞 27 原子、金刚石晶胞 8 原子），无"中心原子"概念，键连接邻域原子。但球棍模型的本质相同（原子球 + 键圆柱），MoleculeScene 的 Atom/Bond 渲染逻辑可复用——这是真实重复，抽到 `shared/BallStick.tsx` 是合理 DRY，不是无需求抽象。

NaCl（离子晶体，Cl⁻ 面心立方 + Na⁺ 八面体空隙，6:6 配位）与金刚石（共价晶体，两套 fcc 穿插，4 配位四面体，键角 109.47°）是两种典型晶体类型，3D 上配位数差异明显（6:6 vs 4），需要 z 轴旋转观察周期性结构——正是 0013 套件 z 轴能力的自然延伸。

## 决策

1. **复用 `fill_blank` 题型，零新 runner（同 0012 VSEPR 模式）。**
   - 学生提交晶体结构名（NaCl→"面心立方"/"rock salt"/"岩盐型"；金刚石→"金刚石"/"diamond"/"四面体"），ObjectiveValidator 比对 `acceptedAnswers`，大小写不敏感，含中英文同义词。
   - 晶体结构识别是离散文本匹配，不是新判定逻辑。`fill_blank` 完全覆盖，零新 QuestionType/EvidenceKind/runner。

2. **晶胞几何纯函数常量，同 0012 分子几何做法。**
   - `src/components/student/crystalProjection.ts`：按真实晶体学参数编码晶胞原子位置——NaCl 27 原子（8 顶角 + 6 面心 Cl⁻ + 12 棱心 + 1 体心 Na⁺），金刚石 8 原子（两套 fcc 穿插）。键用最近邻距离自动生成（NaCl Na–Cl = ½a，金刚石 C–C = √3/4 a）。
   - 复用 `MoleculeGeometry` 类型（`{atoms, bonds}` 结构通用），BallStick/scene 零新类型。
   - 几何正确性由 `tests/crystalProjection.test.ts` 守：配位数（NaCl 体心 Na 6 配位、金刚石内层 C 4 配位）、键角（金刚石 109.47°）、原子计数。

3. **抽 `shared/BallStick.tsx` 复用球棍组件。**
   - 把 MoleculeScene 的 `Atom` + `Bond` 提到 `shared/BallStick.tsx`，MoleculeScene 与 CrystalScene 共用。Bond 改为直接接收两点坐标（from/to Vec3），调用方负责查坐标，更通用。
   - `ELEMENT_COLORS` 加 Na（紫）、Cl（绿），分子场景不受影响。
   - MoleculeScene 改为从 shared import（逻辑不变，仅源头迁移），moleculeCanvas 11 测试继续绿。

4. **新 `CrystalScene.tsx`（R3F）+ 晶胞边框线框。**
   - 复用 OrbitRig，渲染晶胞球棍 + 晶胞边框虚线立方体（8 顶点 12 边，淡色 dashed Line），帮助看出重复单元边界。
   - 晶胞坐标 `[0,1]³` 映射到 ±1 居中，默认相机框住晶胞。
   - 原子标签默认关闭（晶体原子多，元素色已区分 Na 紫/Cl 绿/C 灰，标签会拥挤）。
   - registry 加一行：`{ kind:'r3f', assignmentIds:['chem-crystal-nacl','chem-crystal-diamond'] }`。Visualizer 按 assignmentId 路由到 CrystalScene。React.lazy 懒加载（已在 0013 体系内）。

5. **3D 是展示层，铁律不变。**
   - 渲染数据来自晶胞几何常量（纯函数），无隐藏第二来源。
   - render 不进评分证据链。CrystalScene 画正典晶胞结构，不画学生提交文本——与分子场景立场一致。

## 未做项（诚实记录，留待后续切片）

- **多晶胞拼接未做。** 单晶胞已能看清配位与结构类型，画 2×2×2 拼接的周期性扩展是 YAGNI——留待"晶格/晶系"教学需求出现。
- **不写 R3F 渲染测试。** 同 0013，WebGL 在 jsdom 不可用，几何正确性已由 crystalProjection 纯函数测试守（7 个测试），浏览器实测一次性验证渲染。
- **X 射线衍射 / 密堆积判定 / 晶系分类未做。** 本切片只判结构名（NaCl/金刚石两例）。更深晶体学（衍射、堆积率、七大晶系）留给后续切片。

## 砍掉的（YAGNI，留后续切片）

- **新 `crystal` QuestionType。** 晶体结构识别是离散文本匹配，`fill_blank` + `acceptedAnswers` 完全够用——同 0012 VSEPR 的判断。新题型是无需求抽象。
- **晶胞几何 client/server 共享。** `CRYSTAL_GEOMETRIES`（client 渲染数据）与题目（server，只存结构名/acceptedAnswers）解耦——评分不看坐标，渲染不看 acceptedAnswers。无重复漂移问题。
- **配位数自动判定作为证据。** 规划曾想把"学生提交配位数 → 与几何常量比对"做成证据。但配位数本身靠文本匹配（"6:6"/"4"）即可，几何常量判定是渲染内部逻辑，不进证据。

## 与 0012/0013 的关系

- **同 0012 模式**：复用 fill_blank 零新题型 + 几何纯函数常量 + 画正典结构不画提交文本。
- **同 0013 模式**：R3F 真3D + OrbitControls + lazy 懒加载 + 几何纯函数守正确性 + 评分证据链零改动。
- **扩展 0013 套件**：第一次新增 scene（CrystalScene），第一次抽 shared 复用件（BallStick），验证套件"加一行 registry 注册即可扩展"的设计承诺。

## 后果

### 正面
- 套件首个学科扩展落地，验证 registry/shared 复用架构可扩展（新场景 = 1 几何常量 + 1 scene + 1 行 registry）
- NaCl/金刚石两典型晶体获得可旋转 3D 球棍，配位数与结构类型在旋转中可观察
- 抽 BallStick 消除分子/晶体球棍的渲染重复，后续场景（DNA/蛋白质）可继续复用
- 晶胞几何按真实晶体学参数编码（6:6 配位、109.47°、√3/4 键长），非示意手画，几何正确性可测

### 代价
- NaCl 27 原子在 420×340 canvas 仍偏密（接受，晶体周期性本就密集；元素色 + 线框边界帮助区分）
- 晶体场景无 jsdom 自动测试，依赖一次性浏览器实测守渲染
