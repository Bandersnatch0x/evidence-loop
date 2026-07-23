# 多模态演示视频包（混剪方案 C）

目录：`docs/screenshots/demo-videos/`

## 1. 概念开场（Imagine 静帧 + Ken Burns）

| 文件 | 用途 |
|------|------|
| `opener-code.jpg` / `opener-code.webm` | 代码辅导概念开场 ~6s |
| `opener-math.jpg` / `opener-math.webm` | 数学双通道概念开场 ~6s |
| `opener-fallback.jpg` / `opener-fallback.webm` | 弱网/教师视图概念开场 ~6s |

- 静帧由 Imagine `image_gen` 生成。
- 本环境 **Imagine `image_to_video` 不可用**（ZDR 需 `upload_url`），因此用 Playwright 对静帧做 Ken Burns 推镜录成 `.webm`。
- 片中角标：**「概念示意 · Concept B-roll」** —— 非实机 UI。

## 2. 实机录屏（Playwright + 系统 Chrome）

| 文件 | 场景 |
|------|------|
| `live-code.webm` | 缺陷代码 → 运行循证评估 → 语音辅导模拟 → 高亮 |
| `live-math.webm` | KaTeX 数学区 → 语音问第 3 步 → HIGHLIGHT |
| `live-fallback.webm` | webspeech 路径下 Voice UI → 切教师 → 语音使用次数面板 |

- 服务：`MULTIMODAL_ENABLED=true` + `VITE_MULTIMODAL_ENABLED=true` + `STT_PROVIDER=webspeech`
- 脚本：`node scripts/record-demo-videos.mjs [baseUrl]`
- 无麦克风时：脚本调用真实 `POST /api/multimodal/ask` 并触发 `multimodal:highlight`（产品 API + 真实 DOM 高亮）。

## 3. 混剪用法（路演推荐）

**时间轴（每条约 20–35s）：**

1. `opener-*.webm`（~6s 概念开场）
2. 硬切 → `live-*.webm`（实机主体）
3. 口播点明：开场为示意，后续为 EvidenceLoop 实机

### 本机有 ffmpeg 时拼接

```bash
# 例：代码条
ffmpeg -y -i docs/screenshots/demo-videos/opener-code.webm -i docs/screenshots/demo-videos/live-code.webm \
  -filter_complex "[0:v]scale=1440:900:force_original_aspect_ratio=decrease,pad=1440:900:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v0]; \
                   [1:v]scale=1440:900:force_original_aspect_ratio=decrease,pad=1440:900:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v1]; \
                   [v0][v1]concat=n=2:v=1:a=0[v]" \
  -map "[v]" -c:v libx264 -pix_fmt yuv420p docs/screenshots/demo-videos/hybrid-code.mp4
```

或：

```powershell
powershell -File scripts/assemble-hybrid.ps1
# 或（需可用的系统 ffmpeg）
node scripts/assemble-hybrid.mjs
```

> 当前 CI/本机若无可用 ffmpeg 二进制，可直接在剪辑软件（剪映 / Premiere / CapCut）里把 opener 与 live 首尾相接。

## 4. 重录命令

```powershell
# 终端 1
$env:MULTIMODAL_ENABLED='true'
$env:VITE_MULTIMODAL_ENABLED='true'
$env:STT_PROVIDER='webspeech'
npm run dev

# 终端 2
node scripts/record-openers.mjs
node scripts/record-demo-videos.mjs http://127.0.0.1:4173
```

Playwright 使用 **系统 Chrome**（`channel: 'chrome'`），无需 `npx playwright install`。

## 5. 与工单 022 对应

| 演示脚本 | 开场 | 实机 |
|----------|------|------|
| [DEMO-multimodal-code.md](../../DEMO-multimodal-code.md) | opener-code | live-code |
| [DEMO-multimodal-math.md](../../DEMO-multimodal-math.md) | opener-math | live-math |
| [DEMO-multimodal-fallback.md](../../DEMO-multimodal-fallback.md) | opener-fallback | live-fallback |
