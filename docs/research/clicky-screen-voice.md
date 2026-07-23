# Clicky 屏幕感知 + 语音技术方案调研

> 面向 EvidenceLoop（循证实训 Agent）多模态扩展（屏幕感知 + 语音，对数学/作文等非代码作业做"视觉指点引导"）的技术选型调研。
> 调研日期：2026-07-23。方法：一手来源（官网、官方 GitHub 源码、创始人 X/LinkedIn、官方隐私政策）优先；二手报道仅用于定位一手来源。

---

## 0. 确认的调研对象与判断依据（消歧）

"Clicky" 是高度重名的词。本调研确认的对象是：

**Clicky / heyclicky —— 由 Farza Majeed（buildspace 创始人，X 账号 [@FarzaTV](https://x.com/FarzaTV)）开发的 macOS AI 屏幕助手，2025–2026 年因一条演示推文走红。** 它是一个"住在光标旁边的 AI buddy"：能看你的屏幕、跟你说话、并用一个发光的蓝色三角形"飞"过去指向屏幕上的元素。

判断依据（一手来源）：
- 官方产品站：**heyclicky.com** —— "an ai buddy that lives on your mac"（[heyclicky.com](https://www.heyclicky.com/)）。
- 官方开源原型仓库：**github.com/farzaa/clicky** —— README 作者自述 "Hi there! I'm Farza, the guy that made Clicky…It's an AI teacher that lives as a buddy next to your cursor. It can see your screen, talk to you, and even point at stuff."（[github.com/farzaa/clicky](https://github.com/farzaa/clicky)）。
- 原始演示推文：[x.com/FarzaTV/status/2041314633978659092](https://x.com/FarzaTV/status/2041314633978659092)（README 与技术拆解博客均引用此条为出处）。

**需要排除的同名对象（均非本调研对象）：**
- **Clicky / Clicky Analytics**（getclicky.com、clicky.com）—— 2006 年起的网站流量分析工具，与本调研无关（其隐私政策 clicky.com/terms/privacy 属于该分析产品，不要误引）。
- **"Clicky" 机械键盘轴体**（clicky switch）—— 无关。
- **clicky.foo / github.com/Bitshank-2338/clicky-windows** —— 这是**第三方**对 Farza Clicky 的 Windows 复刻（详见 §7 参考架构），不是官方产品，但与 EvidenceLoop 场景高度相关，单独讨论。

**两个官方交付物的区分（重要，后文反复用到）：**
1. **开源原型**（`github.com/farzaa/clicky`，MIT）：Farza 早期放出的可复现原型，是本调研能拿到源码级细节的地方。README（更新于 2026-04-27）明确："The existing codebase remains open source…for all the new stuff I'm hacking on, gonna keep it private."（[github.com/farzaa/clicky](https://github.com/farzaa/clicky)）
2. **闭源商业版**（`heyclicky.com`，二进制发布在 `github.com/farzaa/clicky-releases`）：功能更多（能点击、后台 spawn agents、连 Gmail/Notion 等），不开源。

**未能从一手来源精确证实**：Clicky 首次公开/走红的确切日期（原始演示推文的日期未直接取到）；能确认的时间锚点是开源 README 更新于 2026-04-27、第三方源码级拆解博客发表于 2026-05 初。

---

## 1. Clicky 是什么、什么产品形态

- **产品形态：OS 级桌面助手（macOS 菜单栏 App），不是浏览器扩展、不是纯 Web 应用。** 官网："download for mac … 100% free. sonoma 14.2 or higher"，并提供 "windows waitlist"（Windows 版仅排队中，尚未正式发布）（[heyclicky.com](https://www.heyclicky.com/)）。开源原型 README 的前置条件写明 "macOS 14.2+ (for ScreenCaptureKit)、Xcode 15+"，即原生 **Swift/AppKit** 应用（[github.com/farzaa/clicky](https://github.com/farzaa/clicky)）。
- **定位：屏幕感知 + 语音的"AI 老师/buddy"**。官网口号 "from fl studio to claude code, jump into any tool, ask questions and heyclicky draws on your screen and teaches you."（[heyclicky.com](https://www.heyclicky.com/)）。它是"always-on companion that lives in the user's menu bar"（系统提示词原文，见 §2）。
- **商业模式**：官网 hero 写 "100% free"，但 FAQ 又提到 "three simple plans, cancel anytime… free forever, no card needed… month-to-month, no lock-in"——即**免费档 + 付费订阅**并存（[heyclicky.com](https://www.heyclicky.com/)）。（heyclicky.com/pricing 单独页面返回 404，价格细节未在一手来源展开。）
- **能力演进**：商业版新增语音驱动的 agent（"say 'heyclicky agent'… opens apps, runs tasks in the background"）与"spatial context / draw on your screen 作为上下文"等功能（创始人 Farza 的 [LinkedIn "Introducing Clicky Agents"](https://www.linkedin.com/posts/farza-majeed-76685612a_introducing-clicky-agents-this-is-the-simplest-activity-7454552863227285504-vQrQ)、[@FarzaTV 的 X highlights](https://x.com/FarzaTV/highlights)）。这两条为一手来源，但仅取到摘要级信息，具体实现**未从源码证实**（商业版闭源）。

---

## 2. 屏幕感知如何实现

**结论：按需截图（screenshot on push-to-talk），不是持续视频流、不是 accessibility tree 取目标、原型阶段也不做 OCR。模型侧用通用视觉 LLM（Claude），靠"截图 + 文本坐标标签"完成指点。**

以下细节来自开源原型的一手来源：Farza 的 README 前置条件，以及基于该开源仓库、逐段引用其 Swift 源码与系统提示词的技术拆解 [isaacflath.com/writing/how-clicky-works](https://isaacflath.com/writing/how-clicky-works)（2026-05）。

- **捕获时机与方式**：松开热键（push-to-talk）时，**每块显示器截一张图**（macOS `ScreenCaptureKit`）。每张缩放到单边最大 1280px、JPEG 80% 质量；并**过滤掉 Clicky 自己的窗口**，让模型看到"用户看到的画面减去 Clicky"。（[isaacflath.com](https://isaacflath.com/writing/how-clicky-works)；截图管线依赖 ScreenCaptureKit 由 README 前置条件佐证 [github.com/farzaa/clicky](https://github.com/farzaa/clicky)）
- **给模型的图片标签**：每张截图附带标签，例如 `screen 1 of 2 — cursor is on this screen (primary focus) (image dimensions: 1280x831 pixels)`。它同时告诉模型①光标在哪块屏（优先关注）②坐标系尺寸（供模型输出坐标）。（[isaacflath.com](https://isaacflath.com/writing/how-clicky-works)）
- **模型侧**：使用 **Anthropic Claude**（视觉 LLM）。前置条件要求 `Anthropic` API key（[github.com/farzaa/clicky](https://github.com/farzaa/clicky)）。模型像在聊天框一样先写出口语回答，再在**消息末尾**追加一个坐标标签，App 用正则把它摘出来：文本部分送 TTS，坐标部分驱动光标。标签格式（系统提示词原文）：
  `[POINT:x,y:label]`（x,y 为截图像素坐标，label 为 1–3 词元素描述；跨屏用 `:screenN`；无处可指时输出 `[POINT:none]`）。（[isaacflath.com](https://isaacflath.com/writing/how-clicky-works)）
- **明确不用的技术**：拆解作者强调——"No accessibility UI-tree inspection for finding targets, no agent loop, no robot driving the real mouse."（原型只用截图 + 视觉 LLM + 坐标标签；Accessibility 权限**仅**用于监听热键，不用于读取 UI 树）（[isaacflath.com](https://isaacflath.com/writing/how-clicky-works)）。
- **商业/agent 模式**：第三方演示描述其 agent 会"takes a screenshot, figures out coordinates, and draws annotations"并能实际点击（[X @VaibhavSisinty](https://x.com/VaibhavSisinty/status/2067199252317769940)，二手，仅摘要级）——即在同一"截图→坐标"范式上叠加了 Computer-Use 式的自动点击，但商业版实现**未从源码证实**。

---

## 3. 语音链路（STT/TTS 分离还是全双工 realtime？延迟如何处理）

**结论：STT/TTS 分离式管线（非单一全双工 realtime 模型），交互是 push-to-talk；靠流式 STT + "先说话文本先送 TTS" 压低延迟。**

开源原型（一手来源）：
- **STT**：**AssemblyAI 流式转写**（websocket）。前置条件要求 `AssemblyAI` key（[github.com/farzaa/clicky](https://github.com/farzaa/clicky)）；拆解："the user's transcript (from AssemblyAI streaming transcription)"（[isaacflath.com](https://isaacflath.com/writing/how-clicky-works)）。
- **LLM**：Anthropic Claude（见 §2）。
- **TTS**：**ElevenLabs**。"Clicky's text goes to ElevenLabs, which turns it into audio."（[isaacflath.com](https://isaacflath.com/writing/how-clicky-works)）；前置条件要求 `ElevenLabs` key（[github.com/farzaa/clicky](https://github.com/farzaa/clicky)）。
- **交互模式**：push-to-talk（按住 ctrl+option 说话），系统提示词自述 "the user just spoke to you via push-to-talk"。所以是**"常驻但按键触发"**，不是持续全双工对讲。（[isaacflath.com](https://isaacflath.com/writing/how-clicky-works)）
- **延迟处理**：STT 用**流式**转写；LLM 回答里"坐标标签前的文本"可**先行送 TTS**（文本与指点解耦）；上下文只带"最近 10 轮对话 + 单屏系统提示词"，控制 token/往返。（[isaacflath.com](https://isaacflath.com/writing/how-clicky-works)）

商业版（一手来源，隐私政策）：使用的第三方 AI 供应商列为 **Anthropic、OpenAI、Deepgram、Cerebras**（[heyclicky.com/privacy-policy](https://www.heyclicky.com/privacy-policy)）。据此推断商业版换用了 **Deepgram**（STT/TTS）、**Cerebras**（超低延迟推理）等以进一步降延迟——但**每家供应商的确切分工未在一手来源逐一说明**，此为推断。

对照参考：第三方 Windows 复刻 clicky.foo 宣称端到端 "under 2 seconds"（[clicky.foo](https://clicky.foo/)，第三方声称，非官方）。

---

## 4. "指点/引导"如何呈现给用户

**结论：虚拟光标（发光蓝色三角）+ 覆盖层（overlay），而不是移动真实系统光标；商业/复刻版还叠加高亮环与白板式标注（箭头/圆圈/下划线）。**

开源原型（一手来源，[isaacflath.com](https://isaacflath.com/writing/how-clicky-works) 引用仓库 Swift 源码）：
- **每块屏一个透明全屏 overlay 窗口**（NSWindow），关键属性：
  ```swift
  self.isOpaque = false
  self.backgroundColor = .clear
  self.level = .screenSaver          // 浮在包括菜单/弹窗在内的所有内容之上
  self.ignoresMouseEvents = true     // 点击穿透，不干扰底层 App
  self.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary]  // 跟随所有桌面空间
  ```
- **画自己的三角当"光标"**：Clicky 在 overlay 里画一个蓝色三角作为 buddy，**不去移动真实鼠标**——"draws its own blue triangle as its cursor, and the user's cursor works normally underneath the invisible overlay"。这巧妙绕开了"如何在别的 App 里移动光标"的难题。
- **飞行动画**：沿二次贝塞尔曲线"飞"到目标并旋转朝向、飞到中点时放大，营造"活的"感觉。
- **坐标变换**（唯一的"真正定制工作"）：把 Claude 给的截图像素坐标 → 显示器坐标（缩放、Y 轴翻转，因为截图原点在左上、显示原点在左下）→ 加每块显示器在 macOS 全局网格上的偏移 → 再转成单窗口内 SwiftUI 局部坐标，并把落点向右下微移、留边距，让三角"指在元素旁边"而非盖住它。

商业/复刻版增强（highlight ring + 标注）：
- 商业版/agent："draws annotations"（[X @VaibhavSisinty](https://x.com/VaibhavSisinty/status/2067199252317769940)，二手摘要）；"draw directly on your screen and pass it as context"（spatial context 功能，[@FarzaTV highlights](https://x.com/FarzaTV/highlights)，一手摘要级）。
- 第三方 Windows 复刻 clicky.foo：飞到元素后"draws a highlight ring around it"，并支持"Whiteboard Annotations —— arrows, circles, underlines, and labels…Annotations fade automatically"（[clicky.foo](https://clicky.foo/)，第三方）。

---

## 5. 是否开源 / 公开 API / 许可证

- **开源：是（原型）+ 否（商业版）。**
  - 开源原型 `github.com/farzaa/clicky`，**许可证 MIT**（README 明写 "It's an MIT license"，仓库 About 亦标 MIT license）（[github.com/farzaa/clicky](https://github.com/farzaa/clicky)）。作者授权任意使用："Tinker with it, make it yours, start a company out of it, do whatever you want."
  - 商业版（heyclicky.com）**闭源**：README 明确新功能不再开源（[github.com/farzaa/clicky](https://github.com/farzaa/clicky)）。
- **语言/依赖**：Swift（macOS 原生），依赖 ScreenCaptureKit；运行需自建 **Cloudflare Worker** 代理 + 自备 Anthropic / AssemblyAI / ElevenLabs 三家 API key（[github.com/farzaa/clicky](https://github.com/farzaa/clicky)）。
- **公开 API：未发现。** 一手来源中没有面向开发者的公开 API / SDK / 文档；可编程复用的"接口"实际上就是这份 MIT 开源原型本身。商业版的"agents / 连接 Gmail·Notion"是产品功能，非公开 API。（**未能从一手来源证实存在公开 API**。）
- **可参考的第三方开源实现**（均 star 自 Farza，独立复刻，见 §7）：
  - `github.com/jasonkneen/openclicky`（macOS 菜单栏，push-to-talk 语音）。
  - `github.com/jvaught01/flicky`（又名 pango07/flicky，"Clicky but for PC"，**Electron** 重写，跨 Windows/macOS/Linux，MIT）（[github.com/jvaught01/flicky](https://github.com/jvaught01/flicky)、[Reddit r/SideProject](https://www.reddit.com/r/SideProject/comments/1slys08/)）。
  - `github.com/Bitshank-2338/clicky-windows`（clicky.foo，离线 Windows 版，见 §7）。

---

## 6. 隐私模型（屏幕数据是否上云 / 留存 / 授权）

**结论：商业版 Clicky 会把截图与语音上云（经其后端代理转发给第三方 AI 供应商）；截图不落盘留存，但保留文本摘要作上下文；仅在按热键时截屏；声称 GDPR 合规。**

商业版（一手来源，[heyclicky.com/privacy-policy](https://www.heyclicky.com/privacy-policy) + [heyclicky.com](https://www.heyclicky.com/) FAQ）：
- **上云与否**：**上云**。"heyclicky captures screenshots and voice input locally on your Mac in response to your push-to-talk actions, and **sends those payloads to our backend proxy so that our AI providers can respond**."（隐私政策 §3.1）
- **第三方供应商**：内容（截图、转写、prompt）经后端代理转发给 **Anthropic、OpenAI、Deepgram、Cerebras**；"We do not sell your data."（隐私政策 §3.2）
- **留存策略**：FAQ —— "we only see your screen when you press the hotkey, and **screenshots are never stored**. we do keep **basic text summaries** so heyclicky has context. you can delete your account and all its data in settings."（即：截图不留存；文本摘要留存；账号数据可自助删除）。隐私政策 §3.3："retain your data for the period necessary…"（未给出具体天数）。
- **授权方式**：macOS 系统级权限（Screen Recording / 屏幕捕获、以及仅用于热键的 Accessibility 权限）+ **push-to-talk 显式触发**（按键才截屏/收音）；合规声明遵循 GDPR。
- **密钥托管**：开源原型用 **Cloudflare Worker 代理**持有 API key，"your keys never ship in the app binary…the app calls Worker endpoints instead of shipping those provider keys"，并为 AssemblyAI websocket 派发**短时令牌**（[github.com/farzaa/clicky](https://github.com/farzaa/clicky)、[isaacflath.com](https://isaacflath.com/writing/how-clicky-works)）。注意：这保护的是"供应商密钥不外泄"，**并不改变"用户屏幕数据要过代理并送达云端 AI"这一事实**。

对照（本地优先的第三方复刻，见 §7）：clicky.foo/clicky-windows 主打离线本地：可跑 **Ollama** 本地模型、whisper.cpp 本地 STT、Tesseract 本地 OCR，宣称唤醒词"always listening **locally** —— nothing is sent until you speak"，对话记录写**本地 SQLite**（[clicky.foo](https://clicky.foo/)、[github.com/Bitshank-2338/clicky-windows](https://github.com/Bitshank-2338/clicky-windows)，第三方声称）。

---

## 7. 可复用结论（面向 EvidenceLoop 浏览器 Web 应用的"视觉指点引导"）

### 7.1 一句话结论

Clicky 的**交互范式**（点 + 说 + 语音讲解 + 末尾机器可解析的"指点指令"）高度值得借鉴；但它的**底层实现是 OS 级的**（`ScreenCaptureKit` 全屏截图 + 系统级点击穿透 overlay 窗口 + 全局热键 + 坐标反算），这一层**不适用**于沙箱化的浏览器 Web 应用。好消息是：数学/作文作业本身就渲染在 EvidenceLoop 自己的 DOM 里，**你根本不需要 OS 级截图与 OS 级 overlay**——用**浏览器内 DOM/SVG/Canvas 标注**即可，且比 Clicky 的"截图→视觉 LLM 猜像素坐标→三重坐标变换"**更精确、更稳、更省**。

### 7.2 可直接借鉴（reusable）

1. **"文本 + 指点指令"解耦的输出协议（最值得抄的一点）**：让 LLM 在口语回答末尾追加机器可解析的指令，App 用正则拆分——语音归语音、指点归渲染层。Clicky 用 `[POINT:x,y:label]`；在 Web 里改成**面向 DOM 的指令**更强，例如 `[POINT:selector="#step-3"]` / `[HIGHLIGHT:elementId]` / `[ANNOTATE:range=…]` / 无处可指时 `[POINT:none]`。这样"讲什么(TTS)"与"指哪里(overlay)"彻底解耦，与 Clicky 同构。
2. **语音管线整体可移植（STT 流式 → LLM → TTS）**，且浏览器原生支持：
   - **STT**：Web Speech API `SpeechRecognition`（部分浏览器本地）或流式云 STT（Deepgram/AssemblyAI/Whisper，走 WebSocket）。可沿用 push-to-talk，降低复杂度与误触发。
   - **LLM**：数学/作文的题面通常是**结构化文本/LaTeX/DOM**，可直接作为上下文，**多数情况下不需要视觉 LLM**——比截图更准更省，也更符合本地优先立场。
   - **TTS**：Web Speech API `SpeechSynthesis`（本地、免费）或云 TTS（ElevenLabs 等）求音质。
   - 若要"抢话/打断"式自然对话，可选全双工 realtime（OpenAI Realtime / Gemini Live）；但 Clicky 证明"push-to-talk + 流式 STT + 独立 TTS"已够用且更简单。
3. **虚拟 buddy + 覆盖层的呈现思路**：Clicky"画自己的三角、不动真实光标"的思路，在 Web 里等价为**在自己应用内叠一层 SVG/Canvas/绝对定位层**，画高亮环、箭头、下划线、虚拟指针，指向作文的具体词句或数学解题的具体步骤；标注可自动淡出（抄 clicky.foo 的 whiteboard annotations）。
4. **导师式 prompt 设计**：Clicky 系统提示词"为耳朵而非眼睛写、短句、不念代码、结尾'埋钩子'而非问 yes/no"等，对语音家教体验直接可用。
5. **本地优先的证据/日志设计**：clicky.foo 的"本地 SQLite 学习日志 + SM-2 间隔复习 + 隐私守卫 + 拖入 PDF/DOCX 作上下文"与 EvidenceLoop 的循证/本地化取向天然契合，可作为家教侧数据模型的参考。

### 7.3 不适用 / 不要照搬（not applicable）

1. **OS 级屏幕捕获**（`ScreenCaptureKit` / 持续截图整块屏幕）：Web 页面无法捕获任意 OS 屏幕；唯一途径 `getDisplayMedia()`（Screen Capture API）需**用户手势 + 每次会话授权**、产出的是 MediaStream(视频)、且无法画到标签页之外——对"引导自家 DOM 内的作业"既不必要又太重、太打扰。**只有当你要跨别的桌面 App 引导时才需要**（EvidenceLoop 场景用不到）。
2. **macOS 三重坐标变换管线**（截图像素 ↔ 显示器 ↔ SwiftUI）：Web 里用 DOM 坐标/`getBoundingClientRect()` 即可，**整段跳过**。别把"视觉 LLM 猜像素坐标"这套引进来——已知 DOM 时它只会更不准。
3. **系统级点击穿透 overlay 窗口 / 全局热键 / Accessibility 权限**：浏览器都没有也不需要；用 DOM overlay + 页面内快捷键替代。
4. **把整屏截图发给云端视觉 LLM**：与 EvidenceLoop"本地化、审慎上云"立场冲突。优先发送**结构化 DOM/文本/LaTeX 的最小载荷**；确需图像时（见下）只截取你自己的元素区域，并考虑本地模型。

### 7.4 一个例外：手写数学需要"视觉"，但仍无需 OS 级捕获

若数学作业是**手写/画板**（stylus `<canvas>`），确实需要图像输入。做法：**只导出你自己的 `<canvas>` 元素**为图片（`canvas.toDataURL()`）→ 交给视觉 LLM 或**本地 OCR / math-OCR** 模型（对齐本地优先），或直接用你掌握的笔迹 stroke 数据。关键点仍成立：**你拥有该元素，无需 OS 级屏幕捕获**。

### 7.5 建议的最小可行路线（MVP）

- 作业渲染在 EvidenceLoop DOM 内 → 把题面/学生作答以**结构化文本(+必要时局部 canvas 截图)**作为上下文；
- push-to-talk：Web Speech API 或流式 STT 取转写；
- LLM 输出"口语讲解 + 末尾 DOM 指点指令"；
- 前端正则拆分：文本 → TTS 播报；指令 → 在 SVG/Canvas overlay 层高亮/画箭头指向对应 DOM 元素；
- 数据本地留存（IndexedDB/本地 SQLite-wasm）+ 仅按需、最小化上云，符合合规立场。
- 参考实现优先看 **clicky.foo / clicky-windows（本地优先、教育定位）** 与 **flicky（Electron 跨平台）** 的开源代码，而非仅看 macOS 原型。

---

## 来源清单

### 一手来源（官方 / 创始人 / 官方源码）
- Clicky 官方产品站：https://www.heyclicky.com/
- Clicky 官方隐私政策：https://www.heyclicky.com/privacy-policy
- Clicky 官方开源原型仓库（MIT，含 README 与前置条件/供应商/Cloudflare Worker 说明）：https://github.com/farzaa/clicky
- Clicky 商业版发布仓库（二进制 DMG）：https://github.com/farzaa/clicky-releases
- 创始人 Farza 原始演示推文（README 引用为出处）：https://x.com/FarzaTV/status/2041314633978659092
- 创始人 Farza 关于"新功能转闭源"的推文（README 引用）：https://x.com/FarzaTV/status/2043402737828962489
- 创始人 Farza X 主页 / highlights（spatial context 等，摘要级）：https://x.com/FarzaTV 、 https://x.com/FarzaTV/highlights
- 创始人 Farza LinkedIn "Introducing Clicky Agents"（摘要级）：https://www.linkedin.com/posts/farza-majeed-76685612a_introducing-clicky-agents-this-is-the-simplest-activity-7454552863227285504-vQrQ

### 源码级技术拆解（基于 farzaa/clicky 开源仓库，逐段引用其 Swift 源码与系统提示词——半一手）
- Isaac Flath, "Point and Talk: How Clicky's AI Interface Works"（2026-05）：https://isaacflath.com/writing/how-clicky-works

### 第三方开源复刻（各自项目的一手来源；作为 §7 参考架构，非官方 Clicky）
- clicky.foo（离线 Windows 版落地页，Ollama/OCR/highlight ring/tutor）：https://clicky.foo/
- Bitshank-2338/clicky-windows（离线 Windows，AmbientListener/whisper.cpp/Tesseract/SQLite+SM-2）：https://github.com/Bitshank-2338/clicky-windows
- jvaught01/flicky（Electron 跨平台复刻，MIT）：https://github.com/jvaught01/flicky
- jasonkneen/openclicky（macOS 菜单栏开源版）：https://github.com/jasonkneen/openclicky
- Reddit r/SideProject（Flicky 作者自述 Electron 重写）：https://www.reddit.com/r/SideProject/comments/1slys08/

### 二手报道（仅用于定位一手来源，未作结论依据）
- xda-developers 报道 Clicky：https://www.xda-developers.com/someone-built-tiny-ai-that-lives-next-to-your-cursor-the-most-useful-thing-ive-tried-this-year/
- Aakash Gupta "Cursor Layer" newsletter：https://www.news.aakashg.com/p/cursor-layer-toolkit
- X @VaibhavSisinty 关于 agent/annotations 的演示帖（摘要级）：https://x.com/VaibhavSisinty/status/2067199252317769940

### 需排除的同名对象（消歧用，非本调研对象）
- Clicky Analytics（网站流量分析，勿混淆其隐私政策）：https://clicky.com/terms/privacy
