# 演示脚本：数学作业 · KaTeX 双通道

**场景**：KaTeX 预设题目 → 学生问「第 3 步为什么错？」→ 系统朗读 SPEAK 文本 + 高亮 DISPLAY 对应公式元素。

**前置**：
- `MULTIMODAL_ENABLED=true`
- 工作台已渲染 `<MathProblem problemId="math-1" />`（flag 开启时自动挂载）
- 角色：**学生**

## 预设初始数据

| 项 | 值 |
|----|-----|
| 题目组件 | `MathProblem` / `math-1` |
| DOM 锚点 | `[data-katex-id="math-1-step-2"]`（mock 回复高亮步） |
| 学生提问 | 「第 3 步为什么错？」 |
| Mock LLM 输出片段 | `[SPEAK:x 的平方加 3][DISPLAY:x^2+3][HIGHLIGHT:selector="[data-katex-id="math-1-step-2"]"]` |

## 期望交互步骤

1. 打开学习工作台，确认数学题区域可见（KaTeX 渲染）。
2. 按住说话：「第 3 步为什么错？」
3. 管道跑通后：
   - **TTS 读** SPEAK 通道：「x 的平方加 3」（不是 raw `x^2+3`）
   - **Overlay** 高亮 `data-katex-id="math-1-step-2"` 元素
4. 打开 Network：确认 `POST /api/multimodal/ask` 响应头 `X-Modality-Mode: voice`。
5. （可选）教师视图看语音次数 +1，仍无原文。

## 预期输出

| 通道 | 预期 |
|------|------|
| SPEAK | 朗读友好中文 / 口语化公式 |
| DISPLAY | 公式原文，用于定位 `data-katex-id` |
| HIGHLIGHT | 白名单 selector，指向步骤节点 |
| 审计 | `modality:'voice'`，无转写正文 |
| 评分 | **不变**（语音只读，ADR-0005 §5） |

## 故障应急

| 现象 | 处理 |
|------|------|
| 数学区不显示 | `MULTIMODAL_ENABLED`；刷新；看 `src/App.tsx` 条件渲染 |
| TTS 读出 `x^2` 符号乱码 | 确认 `dispatchDirectives` 优先 SPEAK 而非 DISPLAY |
| 高亮偏了 / 无框 | 检查 KaTeX 节点是否仍带 `data-katex-id`；resize 后 overlay 应跟随 |
| 协议解析失败 | 应降级为「只播正文、不指点」；不得抛崩主工作台 |
| 阿里云 STT 超时 | 见 [DEMO-multimodal-fallback.md](./DEMO-multimodal-fallback.md) |

## 双通道验收口令

> SPEAK 给耳朵，DISPLAY 给眼睛，HIGHLIGHT 给指点——三者解耦，解析失败只丢指点不丢讲解。
