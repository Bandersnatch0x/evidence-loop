# ADR 0005：多模态提交与视觉指点

## 状态

已采纳（Phase 1 复赛，Phase 2 canvas 场景待 ADR-0007 补充笔迹隐私分类）

## 背景

多模态扩展方向（Clicky 参考）需要在 EvidenceRing 里实现"屏幕感知 + 语音"的视觉指点引导。Clicky 是 macOS 菜单栏 App 走 OS 级截图 + 视觉 LLM 猜像素坐标——不适用于 EvidenceRing 的浏览器 Web 应用形态。

关键决策空间：
- 视觉输入通道（DOM / canvas / OS 截图）
- LLM 输出协议（自由文本 / 结构化坐标 / DOM selector）
- 语音链路（浏览器原生 / 云端 STT/TTS）
- Phase 分期（一步到位 vs 分阶段交付）

## 决策

### 1. DOM 标注优先，OS 截图排除

**Phase 1**：所有指点走 DOM 标注（`getBoundingClientRect() + overlay`），不用 OS 级截图。

理由：
- 学生的数学/作文作业渲染在 EvidenceRing 自己的 DOM 里，selector 精度是天然的 100%
- 不受屏幕缩放/DPI 影响
- 无需 `getDisplayMedia()` 权限，无隐私和合规冲突
- 比"截图→视觉 LLM 猜像素坐标"更准、更省、更合规

### 2. LLM 输出解耦协议

LLM 输出必须遵循以下结构化协议：

```
[讲解正文，自然语言，交给 TTS]
[HIGHLIGHT:selector="#step-3"]       # 指点目标（必需）
[SPEAK:x 的平方加 3]                  # 朗读友好文本（数学专用）
[DISPLAY:x²+3]                        # 视觉展示（数学专用）
[NONE]                                # 无需指点时的显式标记
```

三层防御保证协议稳定性：
- **不用 JSON**（LLM 常漏引号），用正则可解析尾标签
- **few-shot + 强约束 system prompt**：selector 必须以白名单前缀开头（`#problem-`、`.step-`）
- **后端 fallback**：解析失败降级为"只播 TTS，不指点"，未知 selector 静默丢弃
- LLM 温度设 0.2-0.3（格式稳定），不影响正文自然度

**关键降维**：不让 LLM 输出像素坐标，只输出 DOM selector。这是相对 Clicky OS 场景的天然优势。

### 3. 语音链路：阿里云主 + Web Speech 兜底

**STT（中文场景）**：
- **主链路**：阿里云 NLS 实时语音识别（WebSocket 流式，教育场景准确率 95%+）或火山引擎 ASR
- **兜底**：Web Speech API（英文/演示间备用）
- **理由**：Web Speech API 在 Chrome 中文识别背后走 Google 服务器，国内网络下几乎不可用——评委现场无翻墙就翻车。这是硬伤，不能作为主链路。
- **抽象**：定义 `STTProvider` 接口，运行时可切换，避免锁死一家
- **交互模式**：push-to-talk（按键说话），非持续监听，成本可控且合规

**TTS**：
- Web Speech API 内置声音（Windows/macOS）够用于 demo
- 数学公式必须走 SPEAK/DISPLAY 双通道（TTS 读 SPEAK 的"x 的平方加 3"，overlay 高亮 DISPLAY 的 `x²+3`）

### 4. 前端架构：增量而非重构

**不做整站状态机重构**。新增两个独立组件与现有 `Sidebar/Workspace` 并列：

- `<VoiceCompanion>`：右侧抽屉，独立管理 STT/TTS/对话历史
- `<OverlayLayer>`：SVG/绝对定位层，订阅 `[HIGHLIGHT:selector]` 指令，画高亮/箭头/淡出

**核心业务状态不变**：语音会话状态用 XState 或简单枚举局部管理（`idle → recording → transcribing → llm-thinking → speaking → idle`），不侵入 Redux/全局。

**Workspace 内 DOM 只需加约定的 `data-evidence-id` 属性作为 selector 锚点**。

### 5. 数据流单向：语音只读不写评分

- `VoiceCompanion` 可以**读**当前评分证据（作为 LLM 上下文）
- **绝不能改**评分（保留"LLM 不改分"的边界，见 ADR-0001）
- 语音只做**讲解 + 指点**，不做"能触发任意操作的 agent"（会撕开 rubric 边界）

### 6. Phase 分期

**Phase 1（复赛）——DOM-only + KaTeX 数学**：
- Week 1：协议冻结 + 骨架 + 硬编码 selector 端到端
- Week 2：阿里云 STT + KaTeX 数学显示 + SPEAK/DISPLAY 双通道
- **不做**：手写 canvas，用 KaTeX 预设题库跑通体验

**Phase 2（决赛/后续）——canvas + 视觉 LLM**：
- canvas 局部截图（`canvas.toDataURL('image/jpeg', 0.7)`）+ 视觉 LLM 识别
- stroke 数据作为辅助信号（"用户先画横线、再画分数线上下"）
- 只在学生主动按"求助"按钮时触发，不做持续识别
- **前置要求**：ADR-0007《手写笔迹的隐私分类》必须先落地

### 7. 多模态合规扩展

引入新的数据模态带来新的 PII 风险面，扩展 #5 合规工单：

| 数据源 | 处理策略 |
|--------|----------|
| 语音原始音频 | 流式转写，不落盘（前端不写 IndexedDB，后端不写磁盘） |
| STT 转写文本 | 走现有 PII 检测正则（复用 #5） |
| Canvas 手写内容 | 上传前前端轻量文字检测（Tesseract.js 判定是否含姓名/学号），命中弹窗要求重画 |
| 对话历史 | IndexedDB 存储，24 小时 TTL 自动清空 |

审计日志扩展 `modality` 字段（`text/voice/canvas`），存元数据（时长、字节数、PII 命中）而非内容。

### 8. Feature Flag 红线

**所有多模态代码必须能通过 feature flag 一键关闭**，回到复赛前的稳定状态。主评分闭环（循证）绝对不能因为语音重构而回归失败。

## 后果

### 正面
- 复赛 4 周可交付 Phase 1（DOM-only + KaTeX）
- 主评分闭环零风险（feature flag 保护）
- 合规叙事升级：多模态数据治理配套 4 组件
- 与 Clicky 研究的"交互范式可抄，OS 级实现不适用"结论一致

### 代价
- 阿里云 STT 依赖第三方云服务（合规叙事需说清"仅转写脱敏文本入库"）
- KaTeX 结构化输入短期覆盖不了手写场景（Phase 2 补齐）
- `<VoiceCompanion>` 是加分项而非命门，若时间紧张可仅交付静态演示

## 明确不做（YAGNI 边界）
- 全双工 realtime 对话（push-to-talk 已够用）
- OS 级屏幕捕获（`getDisplayMedia` 打扰又不必要）
- 语音驱动的 agent 操作（会撕开 rubric 边界）
- 本地 LLM 部署用于视觉指点（1 个月不现实）
- 声纹识别 / 学生个性化语音模型（合规雷区）

## 相关决策

- ADR 0001：证据优先评分（语音只读不写评分的基础）
- ADR 0003：Demo 级别合规方案（多模态合规扩展的基础）
- ADR 0004：多学科证据模型（数学/作文的证据定义前提）
- ADR 0007（未来）：手写笔迹的隐私分类（Phase 2 前置）
