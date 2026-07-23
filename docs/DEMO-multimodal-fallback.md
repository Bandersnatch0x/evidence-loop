# 弱网 / 无阿里云 STT 降级演练

**目标**：评审现场无公网、无阿里云密钥、或中文 WebSocket STT 失败时，**演示仍可跑通**。

## 架构回顾（ADR-0005 §3）

| 链路 | 主 | 兜底 |
|------|----|------|
| STT | 阿里云 NLS 实时识别（`STT_PROVIDER=aliyun`） | Web Speech API（`webspeech` / 浏览器） |
| TTS | Web Speech `speechSynthesis` | 无声完成管道（jsdom/测试环境直接 resolve） |
| LLM 指点 | 真实 LLM（可选） | 服务端 mock dual-channel 输出 |

主评分闭环 **不依赖** STT/TTS；`MULTIMODAL_ENABLED=false` 时全站回到复赛前状态。

## 演练 A：关闭阿里云，切 Web Speech

### 步骤

1. 编辑环境（示例 `.env` / shell）：

```bash
MULTIMODAL_ENABLED=true
STT_PROVIDER=webspeech
# 不要设置或清空 ALIYUN_NLS_* / 相关密钥
```

2. 重启：

```bash
npm run dev
```

3. Chrome 打开工作台，允许麦克风。
4. 按住说话，说一句中文或英文短句。
5. 确认：
   - 前端 `useVoiceSession` 使用浏览器 `SpeechRecognition` / `webkitSpeechRecognition`
   - `POST /api/multimodal/ask` 仍返回 mock/LLM 讲解 + HIGHLIGHT
   - 高亮与 TTS（若系统有中文 voice）仍可用

### 预期

- 不出现「必须连接阿里云才能演示」的硬失败。
- 网络面板中 **无** 对阿里云 NLS 域名的成功依赖（webspeech 路径）。
- 审计仍写 `modality:'voice'` 元数据。

## 演练 B：模拟弱网

1. DevTools → Network → Throttling → **Slow 3G** 或 Offline 闪断。
2. 若 `STT_PROVIDER=aliyun`：
   - `POST /api/multimodal/stt/start` 可能 503；
   - 现场话术：立即改 `STT_PROVIDER=webspeech` 并刷新（演练 A）。
3. 仅 `ask` 接口慢时：
   - UI 应停在 `llm-thinking`，失败后 `error` 文案可读，**不污染评分结果**。

## 演练 C：完全关闭多模态（红线）

```bash
MULTIMODAL_ENABLED=false
```

| 检查项 | 预期 |
|--------|------|
| VoiceCompanion / OverlayLayer / MathProblem | 不挂载 |
| `POST /api/multimodal/*` | 503 + `X-Feature-Disabled: multimodal` |
| 提交代码评分 | 与 Phase 1 前一致，全绿 |

## 故障应急速查

| 症状 | 动作 |
|------|------|
| 阿里云 token 失败 | `STT_PROVIDER=webspeech` |
| Chrome 无 SpeechRecognition | 换最新 Chrome；勿用纯 Firefox 中文现场 |
| 公司网屏蔽 Google（Web Speech 后端） | 预录转写：开发者在控制台触发 pipeline；或英短句；或离线 mock |
| 现场完全无麦 | 用自动化测试 / 预先打开的录屏（可选 30s 短视频） |
| 评审只关心合规 | 直接演示教师「语音次数」面板 + 审计无原文（021） |

## 验收清单

- [ ] `STT_PROVIDER=webspeech` 下完整走通一次语音问 → 讲解 → 高亮
- [ ] `MULTIMODAL_ENABLED=false` 后评分闭环无回归
- [ ] 审计无转写原文、无音频路径
- [ ] 教师 multimodal-usage 仅次数

## 相关文档

- [ADR-0005 多模态视觉指点](./adr/0005-multimodal-visual-pointing.md)
- [DEMO-multimodal-code.md](./DEMO-multimodal-code.md)
- [DEMO-multimodal-math.md](./DEMO-multimodal-math.md)
- [DEMO-multimodal-essay.md](./DEMO-multimodal-essay.md)

## 视频素材

- 概念开场：[`docs/screenshots/demo-videos/opener-fallback.webm`](./screenshots/demo-videos/opener-fallback.webm)
- 实机录屏：[`docs/screenshots/demo-videos/live-fallback.webm`](./screenshots/demo-videos/live-fallback.webm)
- 混剪说明：[`docs/screenshots/demo-videos/README.md`](./screenshots/demo-videos/README.md)
