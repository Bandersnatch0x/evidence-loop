---
name: EvidenceLoop 循证实训 Agent
description: 用可验证证据驱动编程学习闭环的实训工作台
colors:
  indigo-quiet: "oklch(52% 0.13 252)"
  indigo-deep: "oklch(42% 0.12 252)"
  indigo-wash: "oklch(95.5% 0.02 252)"
  paper: "oklch(98.2% 0.006 252)"
  surface: "oklch(100% 0 0)"
  surface-sunken: "oklch(97% 0.006 252)"
  ink: "oklch(28% 0.03 252)"
  ink-muted: "oklch(48% 0.025 252)"
  ink-faint: "oklch(60% 0.02 252)"
  line: "oklch(91% 0.008 252)"
  line-strong: "oklch(84% 0.012 252)"
  pass: "oklch(55% 0.13 160)"
  pass-deep: "oklch(42% 0.11 160)"
  pass-wash: "oklch(95% 0.03 160)"
  fail: "oklch(55% 0.19 25)"
  fail-deep: "oklch(46% 0.17 25)"
  fail-wash: "oklch(95.5% 0.02 25)"
  warn: "oklch(62% 0.13 75)"
  warn-deep: "oklch(45% 0.11 70)"
  warn-wash: "oklch(96% 0.03 80)"
  code-bg: "oklch(24% 0.025 252)"
  code-ink: "oklch(90% 0.02 252)"
typography:
  display:
    fontFamily: "Inter, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "clamp(1.5rem, 1.15rem + 1.4vw, 1.75rem)"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Inter, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "1.125rem"
    fontWeight: 650
    lineHeight: 1.35
  title:
    fontFamily: "Inter, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "0.875rem"
    fontWeight: 650
    lineHeight: 1.4
  body:
    fontFamily: "Inter, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: "Inter, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1.4
  mono:
    fontFamily: "'Cascadia Code', 'SFMono-Regular', Consolas, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.7
rounded:
  sm: "6px"
  md: "10px"
  lg: "14px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.indigo-quiet}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "10px 18px"
  button-primary-hover:
    backgroundColor: "{colors.indigo-deep}"
    textColor: "{colors.surface}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
  nav-item:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
  nav-item-active:
    backgroundColor: "{colors.indigo-wash}"
    textColor: "{colors.indigo-deep}"
  chip:
    backgroundColor: "{colors.surface-sunken}"
    textColor: "{colors.ink-muted}"
    rounded: "999px"
    padding: "4px 10px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "20px"
---

# Design System: EvidenceLoop 循证实训 Agent

## 1. Overview

**Creative North Star: "循证实验报告（The Lab Report）"**

每个分数都是一份签过名的实验记录：有编号、有出处、可复核。界面是这份报告的纸面与印鉴——冷静、精确、不喧哗。学习者看到的不是"AI 说的"，而是"测试跑出来的"；每条结论旁边都站着它的证据。

密度为日常实训服务：师生每天要用的工具，不是评审现场的幻灯片。信息排布紧凑而透气，视觉层级的第一位永远给证据与下一步动作，装饰为零。表达上借鉴 Khan Academy 式的清晰进度反馈——状态明确、下一步明确——但语气保持实验报告的精确，不讨好、不夸张。

明确拒绝：聊天机器人式的大对话框、传统 OJ 的冰冷红黑判题、营销页的大渐变玻璃拟态、以及千篇一律的 AI 紫渐变圆角卡片。

**Key Characteristics:**
- 证据先行：分数、证据行、诊断的层级高于一切装饰元素
- 五步闭环可视化：评估流程是工作台顶部的常驻核心元素，运行时逐步点亮
- 纸面质感：近白底 + 发丝边框，扁平为主，阴影只给真正的浮层
- 语义色与品牌色严格隔离：靛蓝是品牌，绿/红/黄只属于证据状态

## 2. Colors

调色板性格：克制的纸面中性色 + 一把靛蓝刻刀；语义三色只用于证据与状态，绝不装饰。

### Primary
- **沉静靛蓝** (oklch(52% 0.13 252))：品牌主色。只出现在主按钮、激活导航、闭环流程节点、量规权重等"系统身份"位置。偏蓝不偏紫——与反参考"AI 紫渐变"划清界限。
- **靛蓝深色** (oklch(42% 0.12 252))：主按钮 hover、激活态文字、强调链接。
- **靛蓝浅水** (oklch(95.5% 0.02 252))：激活导航底色、政策徽章底、场景提示块底。大面积品牌存在感的唯一合法形式。

### Neutral
- **纸面** (oklch(98.2% 0.006 252))：应用底色。向品牌色相偏移 0.006 色度的近白，不是暖米白。
- **纸卡** (oklch(100% 0 0))：面板与卡片表面，与纸面拉开明度层级。
- **沉降面** (oklch(97% 0.006 252))：表头、徽章底、内嵌区块等下沉区域。
- **墨色** (oklch(28% 0.03 252))：正文与标题，对比度远超 AA。
- **墨灰** (oklch(48% 0.025 252))：次要正文，白色背景上 ≥4.5:1，AA 合规下限。
- **墨淡** (oklch(60% 0.02 252))：仅用于装饰性元信息（时间戳、工具名），不得承载关键内容。
- **发丝线 / 强线** (oklch(91% / 84%))：分隔线与控件描边。

### Semantic（证据状态专属）
- **通过绿** (oklch(55% 0.13 160)) / **通过绿深** (oklch(42% 0.11 160)) / **通过绿浅** (oklch(95% 0.03 160))：证据通过、得分提升、进展正常。
- **失败红** (oklch(55% 0.19 25)) / **失败红深** (oklch(46% 0.17 25)) / **失败红浅** (oklch(95.5% 0.02 25))：证据失败、提交被拒、错误提示。
- **警告琥珀** (oklch(62% 0.13 75)) / **琥珀深** (oklch(45% 0.11 70)) / **琥珀浅** (oklch(96% 0.03 80))：知识诊断、需关注学员、运行器安全提示。
- **代码夜色** (oklch(24% 0.025 252))：代码编辑器的深底色，应用内唯一的深色区域。

### Named Rules

**The Semantic Quarantine Rule（语义隔离规则）。** 绿/红/黄只允许出现在证据状态、得分增减、学员状态上。品牌区域（导航、按钮、流程条）出现绿色即违规——它会让"通过"失去意义。

**The One Voice Rule（单一声音规则）。** 靛蓝在任何单屏占比 ≤10%。它的稀缺就是它的权威：主按钮一处、激活态一处、流程节点当前步一处。

## 3. Typography

**Display/Body Font:** Inter（回退 Segoe UI / PingFang SC / Microsoft YaHei）
**Mono Font:** Cascadia Code（回退 Consolas）——代码、工具名、耗时、证据 ID

**Character:** 单一无衬线家族的字重层级，不玩字体配对。Inter 的中性气质就是实验报告的气质；等宽字体标记一切"机器产出"的内容（工具名、毫秒数、函数签名），与人写的文字形成材质区分。

### Hierarchy
- **Display** (700, clamp(1.5rem–1.75rem), 1.3)：页面标题（班级学情、项目透明度），每页一处。
- **Headline** (650, 1.125rem, 1.35)：面板标题（任务、编辑器、评估结果）。
- **Title** (650, 0.875rem, 1.4)：区块小标题（评分证据、知识诊断）。
- **Body** (400, 0.8125rem, 1.65)：正文与说明，行宽 ≤75ch。
- **Label** (600, 0.6875rem, 1.4)：徽章、表头、元信息。**sentence case，禁止全大写加宽字距的 eyebrow 体。**
- **Mono** (400, 0.8125rem, 1.7)：代码编辑器内容；小一号（0.75rem）用于工具名与耗时。

### Named Rules

**The Eleven-Pixel Floor Rule（11px 地板规则）。** 任何承载信息的文字不得低于 11px（0.6875rem）。旧 UI 的 8–10px 灰字全部作废。装饰性元信息可用墨淡色，但字号不下调。

**The No-Eyebrow Rule（无眉规则）。** 不用小号全大写追踪字距的 kicker。区块身份用词重与字号表达，不用"ABOUT / PROCESS"式脚手架。

## 4. Elevation

扁平是默认。深度靠纸面/纸卡/沉降面三层明度差与发丝边框表达，不靠阴影。阴影只给真正的浮层：移动端抽屉、悬停的主按钮、吸附头部——且出现时不得与 1px 边框叠加。

### Shadow Vocabulary
- **浮层影** (`box-shadow: 0 8px 24px oklch(28% 0.03 252 / 0.12)`)：移动端侧栏抽屉、下拉菜单。使用时元素不带边框。
- **主按钮悬停影** (`box-shadow: 0 6px 14px oklch(52% 0.13 252 / 0.28)`)：主按钮 hover 时的品牌色光晕，配合 translateY(-1px)。

### Named Rules

**The Border-Or-Shadow Rule（边框或阴影二选一规则）。** 静止的卡片用 1px 发丝边框，零阴影；浮层用阴影，零边框。1px 边框 + 大面积柔阴影的"幽灵卡片"禁止出现。

## 5. Components

### Buttons
- **Shape:** 克制圆角（10px）。
- **Primary:** 沉静靛蓝底 + 白字，内边距 10px 18px。每屏最多一个主按钮（工作台上是"运行循证评估"）。
- **Hover / Focus:** hover 加深为靛蓝深色并上浮 1px 带品牌色光晕；focus-visible 给 3px 靛蓝 30% 透明外环，键盘可达性依赖它。
- **Secondary:** 纸卡底 + 强线描边 + 墨灰字，hover 字色转墨。永远从属于主按钮。

### Chips / Badges
- **Style:** 沉降面底或语义浅色底 + 对应深色字，全圆角（999px），Label 字号。
- **State:** 学员状态（进展正常/需要关注/尚未开始）、证据类型（运行测试/静态检查）、政策徽章（确定性评分）。图标 + 文字 + 颜色三样齐备，颜色不单独表意。

### Cards / Containers
- **Corner Style:** 14px 圆角，不得超过 16px。
- **Background:** 纸卡白；内嵌提示块用语义浅色或靛蓝浅水。
- **Shadow Strategy:** 静止零阴影，1px 发丝边框（见 Border-Or-Shadow Rule）。
- **Internal Padding:** 20px 标准，紧凑区块 12–16px。

### Inputs / Fields
- **Style:** 沉降面底 + 强线描边 + 10px 圆角（演示版本选择器）。
- **Focus:** 3px 靛蓝透明外环，与按钮一致。

### Navigation
- **Style:** 浅色侧栏（纸卡白），品牌印记为 12px 圆角靛蓝实心方块 + 白色图标。
- **States:** 默认墨灰字；hover 沉降面底；激活为靛蓝浅水底 + 靛蓝深字 + 600 字重。激活不依赖颜色单独表达——字重同时变化。
- **Mobile:** ≤980px 转为抽屉，遮罩用墨色 48% 透明。

### 闭环流程条（PipelineBar，签名组件）
工作台顶部常驻的五步流程条：读取任务 → 受限运行 → 量规评分 → 知识匹配 → 反馈生成，与后端 EvaluationAgent 的 trace 步骤一一对应。
- **节点:** 32px 圆形容器 + 16px 线性图标。待执行为沉降面 + 墨淡；执行中为靛蓝底白字 + 2s 脉冲外环；完成为通过绿浅底 + 通过绿深图标；失败为失败红浅底 + 失败红深图标。
- **连接线:** 2px 发丝线，已完成段染为通过绿。
- **元信息:** 节点下方 Label 字号，待执行显示工具名（mono），执行中显示"执行中…"，完成后显示真实耗时（`完成 · 128 ms`，来自 trace.durationMs）。
- **行为:** 评估运行时按 620ms 节奏依次点亮（模拟），结果返回后以真实 trace 状态覆盖；`prefers-reduced-motion` 时取消脉冲与节奏，直接呈现最终状态。

### 证据行（EvidenceRow，签名组件）
评分事实的最小单元，设计上必须让"事实感"溢出。
- **结构:** 状态图标（18px）+ 证据名与类型徽章 + 权重得分（`+20` / `0`，mono 表格数字）。
- **State:** 通过行为纸卡底 + 通过绿图标与得分；失败行为失败红浅底 + 失败红深图标，并展开"期望 vs 实际"的 mono 对照。
- **隐藏测试:** 锁形图标标记，提示评分包含学习者不可见的用例——透明原则的具体化。

### 分数环（ScoreRing，签名组件）
- **结构:** conic-gradient 进度环（82px），外环按得分比例着色（≥80 通过绿 / 60–79 警告琥珀 / <60 失败红），内嵌白心显示分数（Display 字重 700、表格数字）与 `/ 100`。
- **配套:** 右侧为提交轮次、反馈摘要、增减分徽章（+20 用通过绿深 + 上升图标）。
- **被拒/失败:** 整体转为失败红系，环比例归零，分数显示 0。

## 6. Do's and Don'ts

### Do:
- **Do** 让每个分数、每条结论旁边都能看到来源：测试/静态检查徽章、通过/失败图标、权重（证据先于表达）。
- **Do** 用 11px 地板规则检查所有文字；用墨灰（≥4.5:1）承载次要正文。
- **Do** 保持通过/失败/警告同时用图标 + 文字 + 颜色表达。
- **Do** 让五步闭环条成为工作台第一视觉，运行时有生命，完成后可回看耗时。
- **Do** 用 sentence case 的 Label 与字重层级建立区块身份。
- **Do** 给所有交互元素清晰的 focus-visible 外环（3px 靛蓝 30% 透明）。
- **Do** 在 `prefers-reduced-motion` 下关闭脉冲与点亮节奏，直接呈现状态。

### Don't:
- **Don't** 做成"聊天机器人式 AI 助教"——禁止大对话框 + 流式输出成为主界面（PRODUCT.md 反参考）。
- **Don't** 做成"冰冷的传统 OJ 判题系统"——禁止只有红黑对错的密集表格、无下一步引导（PRODUCT.md 反参考）。
- **Don't** 做成"花哨的营销落地页"——禁止大渐变背景、玻璃拟态、滚动炫技（PRODUCT.md 反参考）。
- **Don't** 做成"通用 AI 生成风"——禁止紫色渐变大字、超过 16px 的卡片圆角、每段一个小号全大写 eyebrow（PRODUCT.md 反参考）。
- **Don't** 用边框 + 大阴影叠加的幽灵卡片（The Border-Or-Shadow Rule）。
- **Don't** 把绿/红/黄用于装饰或品牌区域（The Semantic Quarantine Rule）。
- **Don't** 用渐变文字、左侧色条边框、手绘涂鸦 SVG、装饰性斜纹或网格背景。
- **Don't** 让任何信息文字小于 11px，或把墨淡色用于关键内容。
