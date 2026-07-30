# ADR 0012：VSEPR 分子几何题与真3D球棍可视化

## 状态

已采纳

## 背景

ADRs 0009/0010/0011 验证了三条命题：非文本提交能进证据链（表达式）、3D 可视化可审计（几何截面 render_artifact）、多表达式并行判分（answers）。本切片（B）要回答：**化学学科的空间构型（VSEPR 分子几何）能否进证据链，且需要 z 轴的分子结构如何可视化？**

0010 在砍掉项里留了："3D 旋转交互仍留给真正需要 z 轴自由观察的切片"。VSEPR 分子几何（正四面体、V 形、三角锥）天然是 3D 结构——不是截面投影能表达的，是第一个真正需要 z 轴的演示场景。

VSEPR 判定的本质：给定分子（CH4、H2O），学生判断中心原子的电子域数/孤对数 → 推断分子几何形状名（tetrahedral、bent）。这是**文本匹配**，不是代数等价（expression）、不是化学式配平（chem_equation）、不是顶点截面（geometry 题型是立方体截面，不通用）。

## 决策

1. **复用 `fill_blank` 题型 + ObjectiveValidator，不新增 QuestionType。**
   - 学生提交形状名（如 "tetrahedral"），ObjectiveValidator 比对 `acceptedAnswers`，大小写不敏感。
   - `acceptedAnswers` 含中英文同义词：CH4 → `['tetrahedral','正四面体','正四面体型','四面体']`；H2O → `['bent','v形','v 型','弯曲形','角形']`。多语言是化学教学实情（教材混用）。
   - 零新 runner——VSEPR 形状判定是离散文本匹配，`fill_blank` 的 `acceptedAnswers` 完全覆盖。新题型是无需求抽象。

2. **真3D 球棍模型用等轴测投影，不引 Three.js。**
   - `moleculeProjection.ts`：分子几何按真实 VSEPR 参数编码——CH4 四面体取立方体交替顶点（H-C-H = arccos(-1/3) ≈ 109.47°），H2O bent 键角 104.5°。键长归一化。
   - 投影复用 0010 的等轴测公式（`screenX=(x-y)*cos30, screenY=(x+y)*sin30-z`），同一份投影逻辑，无新依赖。z 轴在等轴测里是"上"，3D 结构通过 2D 投影可见——这正是 0010 留的"z 轴自由观察"在最小实现下的落地。
   - 球棍模型画原子（CPK 色：C 灰、O 红、H 浅）+ 键，等比例 fit 进画布。
   - `MoleculeCanvas` 画**该形状的正典几何**，不是学生提交的文本——提交是形状名（文本），Canvas 画该形状的 3D 排列。评分靠文本匹配，不靠渲染几何。

3. **两例验证 VSEPR 多形状。** `chem-vsepr-methane`（CH4→tetrahedral）+ `chem-vsepr-water`（H2O→bent）。不止一种形状，验证 acceptedAnswers 多语言/同义词机制，且 bent 的 104.5° 与 tetrahedral 的 109.47° 在 3D 上明显不同。

## 未做项（诚实记录，留待后续切片）

- **渲染参数不进 evidence。** 0010 给截面题加了 `render_artifact`（weight=0 审计证据），因为"画面是否复现"对几何截面是真实问题。VSEPR 的可复现性靠"分子几何是纯函数常量（`MOLECULE_GEOMETRIES`），同 assignmentId 必出同画面"保证——分子几何由形状名唯一确定，无学生提交驱动的渲染分歧。若未来出现"学生质疑看到的3D结构"的真实需求，再按 0010 模式补 render_artifact。
- **分子几何 client/server 不共享。** `MOLECULE_GEOMETRIES`（client）是 Canvas 渲染数据；题目（server）只存形状名/acceptedAnswers，不存3D坐标。两边解耦——评分不看坐标，渲染不看 acceptedAnswers。无重复漂移问题（不像 0010 顶点表两边硬编码）。
- **3D 旋转/缩放交互未做。** 等轴测是单一固定视角。与 PRODUCT.md 画像（机房/键盘/WCAG AA）一致。3D 旋转交互仍留给真正需要自由观察的切片（本切片用固定等轴测已能区分 tetrahedral 与 bent 的 z 轴差异）。

## 砍掉的（YAGNI，留后续切片）

- **新 `molecular_geometry` QuestionType。** 规划时考虑过为"分子几何题"立独立题型。核实发现 `fill_blank` + `acceptedAnswers` 完全够用——VSEPR 形状判定是离散文本匹配，不是新判定逻辑。新题型是无需求抽象。
- **Three.js / R3F / drei。** 球棍模型 = 原子（圆）+ 键（线段）+ 等轴测投影。为画几个球和线引 600KB 是金锤。等轴测投影是 2 行公式，3D 结构通过投影可见。
- **孤对电子的精确斥力可视化。** 真实 VSEPR 中孤对挤压键角（如 H2O 104.5° < 109.47°）。Canvas 只画键 + 原子，孤对不渲染（不画"幽灵电子对"）。104.5° 已编码进 bent 几何的键角，斥力模型本身是教学解释，不是渲染必要。
- **VSEPR 通用推导（电子域→形状的规则引擎）。** 本切片只判形状名（CH4/H2O 两例）。"中心原子电子域数 → 形状"的通用规则引擎留给后续切片（届时可能需新题型承载多步判定）。

## 后果

### 正面
- VSEPR 分子几何进证据链，零新题型/runner——复用 fill_blank 的 acceptedAnswers，中英文同义词自然支持
- 真3D（z 轴）球棍模型落地，无 Three.js——等轴测投影复用 0010，3D 结构通过 2D 投影可见
- 分子几何按真实 VSEPR 参数（109.47°、104.5°）编码，非示意手画，几何正确性可测
- 守住"分数由测试证据算、LLM 不改分、每条结论有出处"三条铁律

### 代价
- 仅固定等轴测视角，无 3D 旋转（接受，画像约束）
- 孤对电子不可视化（只画键+原子，104.5° 已编码但斥力解释不画）
- 仅两例分子（CH4/H2O），通用 VSEPR 规则引擎未做
