# 循证环 · EvidenceRing · 弱网演练清单（决赛现场）

> 决赛现场可能无公网、无阿里云密钥、STT 失败或网络闪断。本文把每条演示路径的**网络依赖**拆开，给出「判断 → 15 秒动作 → 衔接口播句 → 恢复后回切」的逐段降级。配套 [DEMO-final-preflight.md](./DEMO-final-preflight.md) 故障决策树 D7；多模态降级详见 [DEMO-multimodal-fallback.md](./DEMO-multimodal-fallback.md)。
> 身份常量：学生 `learner-demo` · 教师 `teacher-demo` · 单元 `tu-demo` · 端口 `5280`（备用 `18473`）。
> 铁律编号：①证据打分 ②LLM 不改分 ③练习≠正式掌握 ④终裁不折叠 ⑤提示不是分 ⑥PII 不出境。

---

## 一、网络依赖总览（上场前背熟）

| 演示段 | 网络依赖 | 降级路径 |
|--------|----------|----------|
| 提交 → Runner → Evidence → 分数（铁律①②） | **无**（纯本机） | 不需要降级，弱网不影响 |
| 练习态求助 / LLM 讲解 | 外网 LLM（可选；未配 `LLM_API_KEY` 也可跑） | mock 输出 / 直接提交展示证据分 |
| 语音问 → 讲解 → 高亮（多模态） | 阿里云 STT **或** Web Speech（浏览器） | `STT_PROVIDER=webspeech` / 预录转写 / 关 flag |
| TTS 朗读 | 浏览器 `speechSynthesis`（部分系统需联网 voice） | 无声完成管道 / 不讲朗读 |
| 教师布置 / 发提示 / 终裁 / 学情 | **无**（纯本机） | 不需要降级 |
| E2E 自检（上场前可选） | **无**（localhost） | 跳过不影响演示 |

> 结论一句话：**主评分闭环 + 教师侧全部操作零外网**；只有「多模态语音」这一段有网络依赖，且有三层兜底。现场网络最坏情况 = 多模态段降级，其余铁律原样演示。

---

## 二、环境预检（T-30，弱网版）

> 与 [DEMO-final-preflight.md](./DEMO-final-preflight.md) T-30 配合使用，只列网络相关项。

- [ ] 服务起来：`$env:PORT='5280'; npm run dev`，本地 `http://127.0.0.1:5280` 可达（本地启动不依赖公网）
- [ ] 是否要演示语音？现场**有网且已配密钥**才演示阿里云链路；否则按下方 演练 A 提前切 `STT_PROVIDER=webspeech`
- [ ] 若确认现场**无公网**：提前 `MULTIMODAL_ENABLED=false` 或 `STT_PROVIDER=webspeech`，并在心里过一遍「语音不是必需段」的口播（见 C 段）
- [ ] 预录短视频备好（无麦 / 语音全灭兜底）：`docs/screenshots/demo-videos/live-fallback.webm`（~30s）
- [ ] 网络可用性现场探测：开 `http://127.0.0.1:5280` 后，看 Network 面板有没有对外的失败请求（阿里云 / LLM 域名）——有失败就提前切降级

---

## 三、逐段降级决策树

### W1 · 完全无公网（评审现场断网 / 内网隔离）

```
判断：浏览器 Network 面板外网请求全失败 / curl 外网不通
  ├─ 15 秒动作：
  │   1. 口播：「主评分闭环零外网依赖，我直接演示核心铁律。」
  │   2. 多模态非必需——若本机已配 webspeech 且浏览器可用则保留，否则关 flag
  │   3. 提交 → 展示 Runner → Evidence → 分数（铁律①②照常）
  ├─ 衔接口播句：「我们的运行器、题库、评分、站内消息全部本机闭环；外网只挂可选能力（语音、LLM 辅导）。」
  ├─ 恢复后回切：无需回切，弱网不影响主路径
  └─ 红线：不要试图演示「语音」又现场现配密钥——提前配好或直接跳过
```

### W2 · 有网但无阿里云密钥 / 密钥失效（STT 503）

```
判断：`POST /api/multimodal/stt/start` 503 / token 获取失败 / 401
  ├─ 15 秒动作：
  │   1. 停下语音演示，口播：「语音我切浏览器 Web Speech 通道。」
  │   2. 改 `MULTIMODAL_ENABLED=true` + `STT_PROVIDER=webspeech`，重启
  │   3. 刷新后按住说话短句，演示讲解 + 高亮（无阿里云依赖）
  ├─ 衔接口播句：「STT 是插拔式抽象：阿里云和 Web Speech 同协议，审计都记 modality:'voice'。」
  ├─ 恢复后回切：返回当前时码对应段
  └─ 备用：Chrome 无 SpeechRecognition → 预录转写（控制台触发 pipeline）或干脆跳过语音段
```

### W3 · 慢网 / 闪断（Slow 3G-style）

```
判断：页面请求卡顿 / 语音流断断续续 / ask 接口 llm-thinking 卡住
  ├─ 15 秒动作：
  │   1. 语音：切 webspeech（浏览器本地识别，不依赖视频流）；再卡就跳过语音段
  │   2. 求助：不等，口播：「主评分不依赖大模型，我直接提交展示证据分。」
  │   3. 提交一题 → Runner → Evidence → 分数（本地，秒出）
  ├─ 衔接开口播：「辅导慢是模型通道的事；打分走证据通道，两条路物理隔离。」
  ├─ 恢复后回切：LLM 恢复可补朗读讲解；否则继续错题本 / 教师段
  └─ 注意：慢网下**不要刷新页面等网络**——本机接口不受影响，直接点
```

### W4 · 语音全灭（无麦 / 浏览器不支持 / 公司网屏蔽 Google）

```
判断：麦克风无权限 / `SpeechRecognition` 未定义 / TTS 无声
  ├─ 15 秒动作：
  │   1. 口播：「语音只读不改分，是可选项；flag 关即回退，评分闭环零回归。」
  │   2. 放预录短视频 `docs/screenshots/demo-videos/live-fallback.webm`（~30s）补语音观感
  │   3. 或直接跳过，继续主路径（提交 / 错题本 / 教师）
  ├─ 衔接口播句：「多模态是辅导更自然，不是评分多一个来源。」
  ├─ 恢复后回切：跳过不影响铁律演示
  └─ 若评委只关心合规 → 教师「语音次数」面板 + 审计无原文（021）
```

### W5 · 本机配置异常（非网络，交互操练用）

```
判断：服务起不来 / 角色错 / 收件箱空 / 无待终裁
  ├─ 15 秒动作：见 [DEMO-final-preflight.md](./DEMO-final-preflight.md) D1/D2/D5/D8
  ├─ 句：按对应决策树口播
  └─ 本文不重复——弱网只影响网络依赖段
```

---

## 四、演练清单（上场前本机过一遍）

**演练 A · 切 Web Speech**
- [ ] `MULTIMODAL_ENABLED=true` + `STT_PROVIDER=webspeech` + 无 `ALIYUN_NLS_*` → 重启
- [ ] Chrome 允许麦克风 → 按住说话短句 → 讲解文本 + 高亮出现
- [ ] Network 面板无阿里云 NLS 域名成功依赖
- [ ] 审计 `modality:'voice'` 仍写

**演练 B · 模拟弱网**
- [ ] DevTools → Network → Slow 3G（或 Offline 闪断）
- [ ] 主路径：提交 → 分数秒出（无感知）
- [ ] 语音：webspeech 路径可用；aliyun 路径会 503 → 现场话术到位
- [ ] ask 慢时 UI 停 `llm-thinking` → error 文案可读，**不污染评分结果**

**演练 C · 完全关多模态（红线）**
- [ ] `MULTIMODAL_ENABLED=false` → VoiceCompanion / OverlayLayer 不挂载
- [ ] `POST /api/multimodal/*` → 503 + `X-Feature-Disabled: multimodal`
- [ ] 提交代码评分与关闭前一致，全绿

**演练 D · 备用口播路径**
- [ ] 5 分钟版心里过一遍：铁律 → 求助不改分（降级：直接提交证据分）→ 终裁不折叠 → 提示不是分
- [ ] 语音段口播背熟：「语音只读证据、不改分；flag 关即回退，评分闭环零回归。」

---

## 五、故障应急速查

| 症状 | 立刻 |
|------|------|
| 完全无公网 | 关 flag / webspeech；主路径照常；口播「零外网闭环」 |
| 阿里云 token / STT 503 | `STT_PROVIDER=webspeech` 重启 |
| Chrome 无 SpeechRecognition | 换最新 Chrome；现场勿用纯 Firefox 中文语音 |
| 屏蔽 Google（Web Speech 后端） | 预录转写：开发者控制台触发 pipeline；或英短句；或离线 mock |
| LLM 无响应 / 未配 key | 口播「未配 LLM_API_KEY 完全离线可运行」→ 直接提交 |
| 完全无麦 | 预录短视频 `live-fallback.webm`；或直接跳过语音段 |
| 评委只关心合规 | 教师「语音次数」面板 + 审计无原文（021） |

---

## 相关文档

| 文档 | 用途 |
|------|------|
| [DEMO-final-preflight.md](./DEMO-final-preflight.md) | 决赛现场 SOP（本文是它的弱网附录） |
| [DEMO-multimodal-fallback.md](./DEMO-multimodal-fallback.md) | 多模态降级演练（演练 A/B/C 详版） |
| [DEMO-cue-card.md](./DEMO-cue-card.md) | 一页卡点 + 故障 10 秒处理 |
| [DEMO-expert-qa.md](./DEMO-expert-qa.md) | 专家问答库（Q1.2 语音隔离 / Q7 多模态不污染分） |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | 部署（数据布局 / 端口 / 零外网） |
| [ROADMAP.md](./ROADMAP.md) | 决赛第 4 项「弱网切 Web Speech」 |