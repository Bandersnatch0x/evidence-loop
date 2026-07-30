# ADR 0013：统一可视化套件与 Three.js 转向

## 状态

已采纳

## 背景

ADR 0009/0010/0011/0012 四个切片均以"等轴测投影是两行公式，引 Three.js+R3F+drei（~600KB）是金锤"为由砍掉 3D 库，并在 0010/0012 的"未做项"里留了同一条退路：

> 3D 旋转交互仍留给真正需要 z 轴自由观察的切片。

0012（VSEPR 分子）和 0010（立方体截面）正是这两个"真正需要 z 轴自由观察"的场景：正四面体 109.47° 与 bent 104.5° 在单一固定等轴测视角下可区分，但学习者无法旋转观察空间构型——而 VSEPR 的教学要点恰恰是"在三维里看出形状"。固定视角是演示的瓶颈，不是刻意克制。

同时，三个可视化散挂在 `src/App.tsx` 第 419–443 行，用四个 `assignment.id === 'xxx' && <Canvas>` 条件块路由，每加一个演示场景就再加一条分支。用户提出更早的设计诉求：**抽离一个统一的 3D/2D 展示套件**，承载各学科演示模式（物理电路/力学/磁场、化学反应、生物细胞/DNA 等），散挂载不可扩展。

## 决策

1. **引 @react-three/fiber + drei，仅用于真正需要 z 轴的两个场景（分子、立方体截面）。**
   - 这两个场景的"需要 z 轴自由观察"需求在 0010/0012 未做项里已明确预留；本切片是那条退路的落地，不是推翻前序决策。
   - R3F 接管渲染层：把 `moleculeProjection.ts`/`cubeProjection.ts` 里**已有的 3D 坐标**喂给 Three.js，加 OrbitControls 可旋转。几何数据源不变，`METHANE_GEOMETRY`/`WATER_GEOMETRY`/`UNIT_CUBE_VERTICES`/`CUBE_EDGES` 保留原值，现有 11 个 moleculeCanvas 测试 + 12 个 cubeSectionCanvas 测试继续守键角/顶点集/凸性的几何正确性。

2. **抛物线（物理 x-y / y-t）留 2D canvas，不上 R3F。**
   - 斜抛轨迹是 2D 参数曲线，把它塞进 600KB 的 3D 引擎是金锤——这条理由 0011 已立，本切片沿用，不因"统一套件"而强行统一到 3D。
   - 统一套件同时承载 2D 和 3D 两种 scene kind，不是"一律 R3F"。

3. **抽统一 `Visualizer` 入口 + `registry`，替换 App.tsx 散挂载。**
   - `src/components/visualizer/registry.ts`：`assignmentId → SceneKind`（`'r3f' | 'canvas2d'`），单一路由点。App.tsx 只渲染 `<Visualizer assignment={...} submission={...} />`。
   - `Visualizer.tsx` 按 kind 分派：R3F 场景 `React.lazy` 懒加载，2D canvas 静态 import。
   - `scenes/`：`MoleculeScene`/`CubeSectionScene`（R3F）、`ProjectileScene`（2D canvas，复用 `computeXYTrajectory`/`computeTrajectory`）。
   - `shared/OrbitRig.tsx`：灯光 + OrbitControls + 可选坐标轴，3D 场景复用。

4. **`React.lazy` 懒加载 R3F 场景，缓解 bundle 与老旧设备画像的张力。**
   - three/fiber/drei (~600KB) 独立成 `OrbitRig` chunk，**不进首屏主 chunk**。Vite build 实测：主 `index` chunk 569KB（与重构前 572KB 基本持平），`OrbitRig` chunk 908KB 仅在学习者打开 3D 题时按需下载。
   - PRODUCT.md 画像（机房/老旧设备/键盘/WCAG AA）与 600KB bundle 有真实张力——懒加载是缓解，不是消除。诚实记录：首次打开 3D 题有一次 chunk 下载延迟，`Suspense` fallback "正在加载 3D 场景..." 承接。

5. **3D 是展示层，铁律不变。**
   - R3F 渲染数据来自题目真值源常量（顶点表/分子几何），无隐藏第二来源。
   - render 不进评分证据链（延续 0009/0010/0012）。分子场景画正典几何不画学生提交文本，截面场景画学习者提交的截面多边形——与等轴测版本立场一致，只是渲染器从 canvas 2D 换成 Three.js。
   - OrbitControls 是鼠标增强，不依赖：默认相机位姿已能看清结构，旋转是可选观察，键盘 Tab 不被 canvas 捕获。

## 未做项（诚实记录，留待后续切片）

- **不写 R3F 组件的 jsdom 渲染测试。** WebGL 在 jsdom 不可用，硬上 `@react-three/test`/`gl-polyfill` 是为渲染层建测试框架——违反 ponytail「不为渲染层建测试」。几何正确性已由 `*Projection.ts` 的纯函数测试守（29 个测试），R3F 只是把同样的坐标喂给 Three.js。浏览器实测（playwright 截图）确认三场景渲染无 console/page error，作为一次性人工验证，不进 CI。
- **学科扩展场景未做。** 统一套件的扩展点（registry + scenes/）已就位，但电路/磁场螺旋/DNA/晶体等 Phase 2 场景未实装——YAGNI，按学科优先级逐步加。
- **OrbitRig chunk 908KB 未进一步分包。** three/drei 可按模块更细分包（`manualChunks`）压到更小。当前懒加载已让它不进首屏，进一步分包留待 bundle 体积成为真实瓶颈时。

## 砍掉的（YAGNI，留后续切片）

- **抛物线上 R3F。** 2D 参数曲线用 3D 引擎画是金锤，0011 理由仍成立。
- **统一套件的"场景基类"抽象。** 规划时考虑过 `Scene` 抽象基类 + 注册机制。核实 R3F 与 2D canvas 的 props/渲染模型差异大，强行抽象出公共基类是无需求抽象（仅两个 R3F + 一个 2D）。`registry` 的 kind 分派已够扩展，新场景加一行注册即可。
- **OrbitControls 的键盘旋转绑定。** WCAG 要求键盘可达，但 OrbitControls 默认鼠标旋转。键盘 Tab 能离开 canvas（焦点不被捕获），旋转作为鼠标增强不强制键盘可达——与 PRODUCT.md"键盘可操作"针对的是功能交互（提交/运行评估），非观察性旋转。若未来 WCAG 审计要求键盘旋转，再加 `enableKeys` 绑定。

## 与 0010/0011/0012 的关系

三 ADR 的"不引 Three.js"理由（等轴测两行公式够用、600KB 金锤）在**分子与截面场景的"需要 z 轴自由观察"需求前不再成立**——这是三 ADR 自己在"未做项"里预留的退路，本切片是退路的兑现，不是推翻。

抛物线场景仍沿用 0011 的 2D 理由——2D 参数曲线上 R3F 是金锤，统一套件不等于统一渲染器。

## 后果

### 正面
- 分子与截面两个真正需要 z 轴的场景获得可旋转 3D 观察，VSEPR 空间构型的教学要点可表达
- 统一 `Visualizer` + `registry` 替换散挂载，新演示场景加一行注册即可扩展（Phase 2 学科场景的落地基础）
- 懒加载让 ~600KB three 不进首屏主 chunk，老旧设备首屏不受影响
- 几何纯函数测试（29 个）继续守正确性，R3F 只接管渲染层，评分证据链零改动

### 代价
- 首次打开 3D 题有一次 908KB chunk 下载（Suspense fallback 承接）
- R3F 渲染层无 jsdom 自动测试，依赖一次性浏览器实测守渲染正确性
- 600KB 依赖与 PRODUCT.md 老旧设备画像的张力仍在（懒加载是缓解非消除）
