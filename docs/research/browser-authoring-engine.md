# 浏览器专业创作内核调研

## 研究问题

哪些成熟内核或组合能支撑桌面浏览器中的专业 2D 绘制、3D 建模/材质/骨骼/粒子、动画时间线，并与 EvidenceRing 现有 React + Three.js / React Three Fiber 技术栈和全端播放器协作？应选择单一编辑器内核、多个专用内核组合，还是基于标准格式的集成层？

## 结论

**不存在同时满足以下条件的单一成熟方案：**

- 可嵌入现有 React 产品，而不是独立桌面工具或绑定厂商云后端；
- 同时提供专业 2D、专业 3D 网格/UV/骨骼/粒子和完整动画时间线；
- 与现有 Three.js / R3F 播放器直接同构；
- 采用可直接接受的 MIT/Apache 宽松许可；
- 输出可由产品独立版本化、审核、迁移和长期播放的开放数据。

**推荐“标准格式集成层 + 多个专用内核”，不采用单一编辑器内核：**

1. EvidenceRing 自有、版本化的 `TeachingSceneDocument` 作为唯一可编辑成品格式。
2. 2D 视口优先用 Fabric.js；若采购预算换交付速度，可另行验证 Polotno 商业 SDK。
3. 3D 继续使用现有 Three.js + R3F；复用 Three.js Editor 的 MIT 思路/组件，先覆盖场景装配、基础几何、材质、灯光、相机和动画。
4. 动画数据归产品场景文档；可验证 `@theatre/core` + `@theatre/r3f` 作为求值层，但不直接嵌入 AGPL-3.0-only 的 `@theatre/studio`。
5. SVG 作为 2D 矢量交换/发布格式，glTF 2.0 作为 3D 运行时交换/发布格式；二者都不是产品完整可编辑文档。
6. 专业网格拓扑、UV、骨骼创建与复杂粒子若首版必须在产品内完成，需要单独裁决：迁移到 PlayCanvas 生态、接受 GPL/商业授权，或维持 Three.js 并外部导入 glTF。该取舍不能由当前库组合自动解决。

## 候选评估

| 候选 | 官方能力证据 | 嵌入与许可 | 判断 |
| --- | --- | --- | --- |
| Three.js Editor | 官方源码包含 `Animation.js`、场景/对象侧栏、基础/拉伸/车削/文字等几何侧栏、材质、脚本、Loader、Player、History；说明它是可复用的场景装配与动画参考实现。[源码目录](https://github.com/mrdoob/three.js/tree/dev/editor/js) | Three.js 为 MIT。[许可证](https://github.com/mrdoob/three.js/blob/dev/LICENSE) 与现有 Three/R3F 同栈。源码未显示网格顶点/边拓扑编辑、UV 展开、骨骼创建或完整粒子创作模块。 | **保留为 3D 场景编辑基座/参考，不当完整 DCC。** |
| Fabric.js | 官方定位是 Canvas 上的交互对象模型，支持序列化、SVG↔Canvas、富文本、复杂路径和图像滤镜。[能力](https://fabricjs.com/) | MIT。[许可证](https://github.com/fabricjs/fabric.js/blob/master/LICENSE) 它是底层 Canvas 库，不是带资源面板和专业时间线的完整应用。 | **推荐 2D 内核；编辑器 UI、时间线、教学对象仍由产品建设。** |
| Polotno | 官方称其为用于白标设计工具的 React Canvas Editor SDK，可直接提供完整视觉编辑框架并支持 UI/功能定制。[概览](https://polotno.com/docs/overview) | 商业许可；公开价含 $249/月受限方案与 $899/月单域方案，生产环境试用期后需付费。[价格与许可](https://polotno.com/pricing) | **可作为 2D 加速备选；先做商业、离线、数据格式和动画能力 PoC。** |
| Theatre.js | 官方 R3F 指南提供 Studio GUI、R3F extension、自定义扩展，并明确 Studio 用于编辑场景和动画。[R3F 集成](https://www.theatrejs.com/docs/latest/getting-started/with-react-three-fiber) | `@theatre/core` 与 `@theatre/r3f` 声明 Apache-2.0；`@theatre/studio` 声明 **AGPL-3.0-only**。[core](https://github.com/theatre-js/theatre/blob/main/packages/core/package.json) / [r3f](https://github.com/theatre-js/theatre/blob/main/packages/r3f/package.json) / [studio](https://github.com/theatre-js/theatre/blob/main/packages/studio/package.json) | **可验证运行时/求值层；未获法务或商业许可前，不把 Studio 嵌入产品。** |
| PlayCanvas Editor | 官方称其为浏览器 3D 开发环境，提供 transform gizmo、层级树、属性检查器、资产管线、组件、实时协作与同引擎 WYSIWYG。[Editor](https://developer.playcanvas.com/user-manual/editor/) 动画系统支持 FBX 动画与状态机。[Animation](https://developer.playcanvas.com/user-manual/animation/) | Editor 前端与 Engine 均为 MIT。[Editor 许可证](https://github.com/playcanvas/editor/blob/main/LICENSE) / [Engine 许可证](https://github.com/playcanvas/engine/blob/main/LICENSE) 但官方本地开发流程仍要求打开 `playcanvas.com/editor/...?...use_local_frontend`，表明开源前端不等于完整自托管后端。[README](https://github.com/playcanvas/editor/blob/main/README.md) 同时它使用 PlayCanvas Engine，不是 Three.js。 | **最完整的浏览器 3D 候选，但采用它等于引擎迁移 + 后端适配，不是组件级接入。** |
| Babylon.js Editor | 官方 README 明确 Editor 是 Windows/macOS/Linux 桌面应用，基于 Babylon.js Engine。[Editor README](https://github.com/BabylonJS/Editor/blob/master/README.md) | Babylon.js Engine 为 Apache-2.0。[许可证](https://github.com/BabylonJS/Babylon.js/blob/master/license.md) 但编辑器设备形态和运行时都与目标不符。 | **不选作产品内浏览器编辑器；其工具设计可参考。** |
| Blockbench | 官方项目说明它是低多边形模型与像素纹理编辑器，可导出标准格式；插件可扩展，用户作品归用户。[README](https://github.com/JannisX11/blockbench/blob/master/README.md) | 源码为 GPL-3.0。[许可证](https://github.com/JannisX11/blockbench/blob/master/LICENSE.MD) 且能力重点是低多边形/像素模型，不覆盖通用专业 DCC。 | **可作为外部资产制作工具；不直接并入当前 Apache/MIT 产品。** |
| Rive | 官方 Web 仓库提供 JavaScript/TypeScript + WASM 运行时，说明其强项是播放 Rive 文件。[Web runtime](https://github.com/rive-app/rive-wasm/blob/master/README.md) | 运行时 SDK 与作者使用的 Rive Editor 是两层产品；运行时存在不等于有可嵌入作者编辑器。 | **可作为导入/播放格式候选，不解决产品内统一创作。** |

## 标准格式边界

### 2D：SVG

SVG 2 是 W3C 的可缩放矢量图形规范，适合路径、文本、图像和可复用图形的交换与渲染。[SVG 2](https://www.w3.org/TR/SVG2/)

SVG 不应成为完整教学演示聚合：审核状态、素材引用、编辑器层级、跨 2D/3D 时间线、互动意图和版本来源仍需产品文档表达。

### 3D：glTF 2.0

Khronos 将 glTF 定义为紧凑、运行时高效、厂商与运行时中立的 3D 资产“传输”格式；规范明确说明其目标不同于保留迭代设计数据的 authoring format。[glTF 动机与目标](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#motivation)

规范可表达场景、节点、网格、材质、贴图、相机、蒙皮、形变目标和关键帧动画，并提供 `extensionsUsed` / `extensionsRequired` 扩展机制。[glTF 属性参考](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#reference-gltf)

因此 glTF 适合作为 3D 资产与发布快照，不适合单独承载产品编辑历史、2D、视频章节、公共库状态或任意互动脚本。

## 许可证结论

- **可直接进入技术 PoC**：Three.js（MIT）、Fabric.js（MIT）、`@theatre/core`（Apache-2.0）、`@theatre/r3f`（Apache-2.0）、PlayCanvas Engine/Editor 前端（MIT）。
- **需商业合同**：Polotno。
- **需法务/开源策略裁决**：`@theatre/studio`（AGPL-3.0-only）、Blockbench（GPL-3.0）。
- **许可证宽松但架构不合**：Babylon.js/Babylon Editor（Apache-2.0，但桌面 Editor + Babylon runtime）。

许可证字段来自各项目官方许可证或发布包声明；是否构成衍生作品及具体合规措施应由法务最终确认，本报告不替代法律意见。

## 包体与性能

npm registry 查询时的**解包体积**（不是浏览器最终 bundle）显示：`three` 约 22.1 MiB、`fabric` 约 21.2 MiB、`@theatre/core` 约 0.86 MiB、`@theatre/studio` 约 21.3 MiB、`@theatre/r3f` 约 20.1 MiB。解包体积含源码、类型与 source map，不能替代 Vite 构建测量。

由此只得出两条可执行约束：

1. 编辑器必须是教师路由专属异步 chunk，学生播放器不得加载 Fabric、编辑器 UI或 Studio。
2. 选定组合后必须用真实最小 PoC 测量 gzip/Brotli、首屏、内存、WebGL context、移动端帧率；不能用 npm 解包体积做最终判断。

同时加载 Three.js 与 PlayCanvas/Babylon 会引入第二套场景图、材质、资产加载和渲染运行时；除非明确选择引擎迁移，不应在学生播放器中并存。

## 推荐架构

```text
TeachingSceneDocument (产品自有、版本化、可迁移)
├── 2D layers / object graph ── Fabric.js authoring ── SVG asset/snapshot
├── 3D scene references ────── Three.js/R3F authoring ── glTF asset/snapshot
├── timeline / interactions ── product schema + optional Theatre core evaluator
├── media references ───────── image/audio/video assets
└── editor metadata ────────── selection, guides, panels; publish时可剥离

Teacher Studio (editor-only lazy chunks)
        │ publish/preview
        ▼
Validated immutable version
        │
        ▼
Student Player (runtime-only lazy adapters)
```

关键原则：

- **产品文档不等于任一库的私有 JSON。** 适配器把产品文档投影到 Fabric/Three/Theatre；以后换内核不改公共库与题目引用。
- **编辑态和发布态分离。** 发布时生成确定性、不可变、经过资源预算检查的快照；播放器不解释编辑器历史或任意编辑脚本。
- **2D/3D 共用时间语义，不共用渲染引擎。** 统一播放、暂停、seek、事件与参数轨道；各渲染适配器只消费自己的对象。
- **复杂 3D 资产先走 glTF 导入。** 这能维持现有 Three/R3F，并避免首版重造 Blender。若产品内完整 DCC 是不可退让要求，必须先解决新的引擎/许可决策票。

## 被否决路径

### 单一 Three.js Editor 解决全部创作

否决。它适合场景装配、基础几何、材质、脚本和动画参考，但不是完整 2D 编辑器，也没有证据表明覆盖专业网格拓扑、UV、骨骼创建与完整粒子创作。

### 直接嵌入 Theatre Studio

否决为默认方案。技术集成很好，但 `@theatre/studio` 当前发布包声明 AGPL-3.0-only；先做法律/商业许可裁决。

### 同时加载 Three.js 与 PlayCanvas/Babylon

否决。重复运行时与资产语义，扩大播放器包体、内存和迁移面。PlayCanvas 只能作为明确的 3D 引擎迁移候选。

### 把 glTF 当完整编辑文档

否决。glTF 官方明确定位为运行时传输格式，与 authoring format 目标不同。

## 新暴露的决策

调研把原先 fog 中的“专业 3D 能力细节”收敛成一个可明确表述的 HITL 决策：

> 产品内“专业 3D 创作”是否接受“专业场景装配 + 基础几何/材质/时间线 + 外部 glTF 资产导入”；若不接受，是否愿意承担 PlayCanvas 引擎迁移与后端适配，或 GPL/商业 DCC 集成的许可证代价？

该决策应在教师工作台原型、学生播放器契约和场景文档设计前解决。

## Sources

1. [Three.js Editor source](https://github.com/mrdoob/three.js/tree/dev/editor/js)；[Three.js MIT license](https://github.com/mrdoob/three.js/blob/dev/LICENSE)
2. [Fabric.js official site](https://fabricjs.com/)；[Fabric.js MIT license](https://github.com/fabricjs/fabric.js/blob/master/LICENSE)
3. [Polotno overview](https://polotno.com/docs/overview)；[Polotno pricing and licensing](https://polotno.com/pricing)
4. [Theatre.js R3F guide](https://www.theatrejs.com/docs/latest/getting-started/with-react-three-fiber)；[core package](https://github.com/theatre-js/theatre/blob/main/packages/core/package.json)；[r3f package](https://github.com/theatre-js/theatre/blob/main/packages/r3f/package.json)；[studio package](https://github.com/theatre-js/theatre/blob/main/packages/studio/package.json)
5. [PlayCanvas Editor manual](https://developer.playcanvas.com/user-manual/editor/)；[animation manual](https://developer.playcanvas.com/user-manual/animation/)；[Editor README](https://github.com/playcanvas/editor/blob/main/README.md)；[Editor license](https://github.com/playcanvas/editor/blob/main/LICENSE)
6. [Babylon.js Editor README](https://github.com/BabylonJS/Editor/blob/master/README.md)；[Babylon.js license](https://github.com/BabylonJS/Babylon.js/blob/master/license.md)
7. [Blockbench README](https://github.com/JannisX11/blockbench/blob/master/README.md)；[Blockbench GPL-3.0 license](https://github.com/JannisX11/blockbench/blob/master/LICENSE.MD)
8. [Rive Web runtime](https://github.com/rive-app/rive-wasm/blob/master/README.md)
9. [SVG 2 specification](https://www.w3.org/TR/SVG2/)
10. [glTF 2.0 specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html)
11. npm registry metadata used for unpacked-size checks: [three](https://registry.npmjs.org/three/latest), [fabric](https://registry.npmjs.org/fabric/latest), [@theatre/core](https://registry.npmjs.org/@theatre%2fcore/latest), [@theatre/studio](https://registry.npmjs.org/@theatre%2fstudio/latest), [@theatre/r3f](https://registry.npmjs.org/@theatre%2fr3f/latest)
