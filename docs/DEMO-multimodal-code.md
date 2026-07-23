# 演示脚本：代码作业 · 语音指点

**场景**：学生提交有边界缺陷的 `fibonacci` / 平均分函数 → 语音问「哪里错了？」→ 系统语音讲解 + 高亮证据行。

**前置**：
- `MULTIMODAL_ENABLED=true`
- 浏览器 Chrome（Web Speech 兜底可用）；可选 `STT_PROVIDER=aliyun`（有密钥时）
- 角色切换为 **学生**
- 打开「学习工作台」

## 预设初始数据

| 项 | 值 |
|----|-----|
| 任务 | `python-average`（边界条件诊断：平均分函数） |
| 代码变体 | 「存在边界缺陷」 |
| 初始代码 | `def calculate_average(scores):\n    return sum(scores) / len(scores)` |
| 学生提问（语音） | 「哪里错了？」 |
| 期望 DOM 锚点 | `[data-evidence-id="..."]` 或代码/证据区相关 selector |

可选手动粘贴的 Fibonacci 示意（若现场改用自定义题）：

```python
def fib(n):
    if n == 0:   # ← 期望被高亮的 base case 行（示意）
        return 0
    return fib(n - 1) + fib(n - 2)
```

## 期望交互步骤

1. 选择缺陷代码变体，点击 **提交验证**，确认得分 < 100，证据区出现「空序列边界」失败项。
2. 确认右侧 **VoiceCompanion** 可见（多模态 flag 开启）。
3. **按住说话**，说：「哪里错了？」后松开。
4. 观察状态机：`recording → transcribing → llm-thinking → speaking → idle`。
5. 听系统 TTS 讲解；同时 **OverlayLayer** 高亮对应证据 / base case 行。
6. （教师视角可选）切换教师角色 → 班级学情 → 确认「语音辅导使用次数」+1，且 **无转写正文**。

## 预期输出

- HTTP `POST /api/multimodal/ask`：
  - 状态 200
  - 响应头 `X-Modality-Mode: voice`
  - body 含可解析的 `[HIGHLIGHT:selector="..."]`（数学演示时另有 SPEAK/DISPLAY）
- 审计日志（教师 `GET /api/audit`）：
  - `modality: "voice"`
  - metadata 仅有 `durationMs` / `transcriptChars` / `piiHitCount`
  - **不含**「哪里错了？」原文
- 前端 IndexedDB `evidence-loop-voice`：
  - 写入一条对话，字段含 `expiresAt = createdAt + 24h`
  - **无** audio blob / wav 路径

## 故障应急

| 现象 | 处理 |
|------|------|
| VoiceCompanion 不出现 | 确认 `.env` / 环境变量 `MULTIMODAL_ENABLED=true` 后重启 `npm run dev` |
| 按住说话灰色 | 换 Chrome；允许麦克风权限 |
| 中文识别失败 | 切 `STT_PROVIDER=webspeech` 或按 [DEMO-multimodal-fallback.md](./DEMO-multimodal-fallback.md) |
| 无高亮 | 打开 DevTools → 看 `multimodal:highlight` 事件；确认 Workspace DOM 仍有 `data-evidence-id` |
| 503 + X-Feature-Disabled | flag 被关；恢复后评分闭环仍可用（红线） |

## 合规话术（30 秒）

> 语音只读证据、不改分；原始音频流式转写不落盘；审计只记 modality 与次数元数据；对话本地 24 小时自动清空。
