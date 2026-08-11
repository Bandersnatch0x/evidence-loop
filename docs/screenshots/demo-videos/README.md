# 演示视频包（混剪方案 C + 完整 demo-full）

目录：`docs/screenshots/demo-videos/`

## 1. 概念开场（Imagine 静帧 + Ken Burns）

| 文件 | 用途 |
|------|------|
| `opener-code.jpg` / `opener-code.webm` | 代码辅导概念开场 ~6s |
| `opener-math.jpg` / `opener-math.webm` | 数学双通道概念开场 ~6s |
| `opener-fallback.jpg` / `opener-fallback.webm` | 弱网/教师视图概念开场 ~6s |

- 静帧由 Imagine `image_gen` 生成。
- 本环境 **Imagine `image_to_video` 不可用**（ZDR 需 `upload_url`），因此用 Playwright 对静帧做 Ken Burns 推镜录成 `.webm`。
- 片中角标：**「概念示意 · Concept B-roll」** -- 非实机 UI。

## 2. 实机录屏（Playwright + 系统 Chrome）

### 多模态三条（工单 022）

| 文件 | 场景 |
|------|------|
| `live-code.webm` | 缺陷代码 -> 运行循证评估 -> 语音辅导模拟 -> 高亮 |
| `live-math.webm` | KaTeX 数学区 -> 语音问第 3 步 -> HIGHLIGHT |
| `live-fallback.webm` | webspeech 路径下 Voice UI -> 切教师 -> 语音使用次数面板 |

### 核心铁律三条（复赛 item 4 补录）

| 文件 | 场景 | 铁律 |
|------|------|------|
| `live-evidence.webm` | 今日该练 -> 开始练 -> 运行循证评估 -> 证据列表 + 分数环 + 确定性评分徽章 | 分数只来自可复现证据 |
| `live-tutoring.webm` | 练习态 AI 辅导面板 -> 铁律文案 -> 语音求助高亮 -> 分数不变 | 辅导不改分（AI 推断不计入正式分数） |
| `live-teacher.webm` | 切教师 -> 演示单元 tu-demo -> 布置作业(测评态) -> 发提示(T14) -> 主观题终裁三层分离 -> 班级学情(中位分尊重终裁门) | 终裁不折叠进 score + 提示不是分 |

- 服务：`MULTIMODAL_ENABLED=true` + `VITE_MULTIMODAL_ENABLED=true` + `STT_PROVIDER=webspeech`
- 脚本：`node scripts/record-demo-videos.mjs [baseUrl]`（默认 `http://127.0.0.1:4180`）
- 无麦克风时：脚本调用真实 `POST /api/multimodal/ask` 并触发 `multimodal:highlight`（产品 API + 真实 DOM 高亮）。
- 单段重录：`CLIP=live-teacher node scripts/record-demo-videos.mjs <baseUrl>`（只录指定片段，不重录其他）。

## 3. 完整演示视频 demo-full.mp4（复赛 item 4，约 2-3 分钟）

单条完整路演视频，8 段按铁律叙事排列，由 `scripts/assemble-hybrid.mjs` 一键拼接：

```
opener-code      (~6s  概念开场)
live-evidence    (~30s 铁律一：分数只来自证据)
live-tutoring    (~25s 铁律二：辅导不改分)
opener-math      (~6s  概念开场)
live-math        (~25s 多模态数学)
live-teacher     (~35s 铁律三：终裁不折叠 + 提示不是分)
opener-fallback  (~6s  概念开场)
live-fallback    (~25s 弱网/教师视图)
                 ≈ 158s ≈ 2.6 分钟
```

缺失的片段会自动跳过（渐进补录期间允许部分缺失）。

### 拼接

```powershell
# 产出 3 条短 hybrid-*.mp4 + 1 条 demo-full.mp4
node scripts/assemble-hybrid.mjs
```

脚本用 `ffmpeg-static`（devDependencies，开发工具用途，不进生产构建）。需 Node 20（与 better-sqlite3 ABI 一致）。

> 若本机 ffmpeg-static 二进制被杀软/SmartScreen 拦截（表现为 `ffmpeg -version` 超时），可改用系统 ffmpeg 或在剪映/Premiere/CapCut 里按上表顺序首尾相接。

## 4. 混剪用法（3 条短混剪，路演备用）

**时间轴（每条约 20–35s）：**

1. `opener-*.webm`（~6s 概念开场）
2. 硬切 -> `live-*.webm`（实机主体）
3. 口播点明：开场为示意，后续为 EvidenceRing 实机

由 `assemble-hybrid.mjs` 同时产出 `hybrid-{code,math,fallback}.mp4`（每条 opener+live 两段）。

## 5. 重录命令

```powershell
# 终端 1：启服务（Node 20 + 多模态 flag；4180 被占时换 5280）
$env:MULTIMODAL_ENABLED='true'
$env:VITE_MULTIMODAL_ENABLED='true'
$env:STT_PROVIDER='webspeech'
$env:PORT='5280'
npm run dev

# 终端 2：录制（opener 不依赖服务，live 依赖）
node scripts/record-openers.mjs
node scripts/record-demo-videos.mjs http://127.0.0.1:5280
# 单段重录：
#   $env:CLIP='live-teacher'; node scripts/record-demo-videos.mjs http://127.0.0.1:5280

# 拼接 demo-full.mp4
node scripts/assemble-hybrid.mjs
```

Playwright 使用 **系统 Chrome**（`channel: 'chrome'`），无需 `npx playwright install`。录制 headless（通过 recordVideo API）。

## 6. 与演示脚本对应

| 演示脚本 | 开场 | 实机 |
|----------|------|------|
| [DEMO-multimodal-code.md](../../DEMO-multimodal-code.md) | opener-code | live-code |
| [DEMO-multimodal-math.md](../../DEMO-multimodal-math.md) | opener-math | live-math |
| [DEMO-multimodal-fallback.md](../../DEMO-multimodal-fallback.md) | opener-fallback | live-fallback |
| [DEMO-live-script.md](../../DEMO-live-script.md) | — | live-evidence / live-tutoring / live-teacher |
