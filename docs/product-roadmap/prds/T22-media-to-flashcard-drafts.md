# PRD: T22 音视频/转写 → 闪卡与小测草稿

**状态**: OPEN
**开建顺序**: 7（体验加深项；Blocked by T15）
**来源**: 音视频材料出题需求

---

## Problem Statement

「课堂录音/字幕 → 闪卡/测验」能力。T15 已建立了「材料文本 → 草稿题 → 教师校对入库」的闸门，但仅支持纯文本输入。教师需要从音频讲解或字幕文件生成草稿题，且含学生语音的强 PII **永不出境**（T10 egress gate）。本票在 T15 之上增加媒体转写入口。

## Solution

在 T15 材料导入入口增加媒体路径：教师上传音频（时长上限 15min）或粘贴字幕/WebVTT → STT/字幕解析为文本 → 复用 T15 的 `MaterialImportJob(sourceKind=transcript)` → DraftQuestion / DraftFlashcard → 教师校对闸门。闪卡可作为 `fill_blank` 或轻量 Flashcard 内容类型。学生课堂录音默认禁止作题库材料，MVP 仅推荐教师讲解录音/无学生发言素材。

## User Stories

1. 作为教师，我想粘贴一段字幕文本（WebVTT 格式）后自动生成草稿题，以便从视频讲解中提取测验。
2. 作为教师，我想上传一段自己讲解的音频（≤15min）后自动转写并生成草稿题，以便从录音中出题。
3. 作为教师，我想在转写后复用 T15 的校对闸门（修正 → 确认 → 入库），以便保持一致的审核流程。
4. 作为教师，我想生成的闪卡可作为 `fill_blank` 或轻量 Flashcard 内容，以便灵活使用。
5. 作为教师，我想在音频路径默认安全关闭或本地 STT，以便防止学生语音 PII 出境。
6. 作为教师，我想在确认时勾选「无学生发言素材」声明，以便合规使用。
7. 作为系统，出境开关关闭时拒绝非本地 STT，以便守 T10 egress gate。
8. 作为系统，无确认不入库（复用 T15 闸门），以便守 D2。
9. 作为系统，学生课堂录音含同学声音时默认禁止作题库材料，以便保护学生 PII。
10. 作为开发者，我想复用 T15 确认路径测试，以便不重复造测试基础设施。
11. 作为教师，我不想自动爬取视频网站，以便避免版权和稳定性问题。

## Implementation Decisions

### 要定什么

1. **输入 MVP**：教师上传音频（时长上限 15min）或粘贴字幕/WebVTT。暂缓任意 YouTube URL 拉取（版权与抓取稳定性）；若做仅允许教师粘贴已下载字幕。

2. **流水线**：

```
媒体 → STT/字幕文本 → MaterialImportJob(sourceKind=transcript)
     → DraftQuestion / DraftFlashcard → 教师确认 → 入库
```

闪卡可作为 `fill_blank` 或轻量 `Flashcard` 内容类型（若不想新类型，统一进填空草稿）。

3. **隐私**：学生课堂录音若含同学声音，默认禁止作题库材料，或强制本地 STT + 不落盘原文（对齐 ADR-0005 音频不落盘精神）。MVP 推荐：仅教师讲解录音/无学生发言素材 + 确认勾选。

4. **与评分**：同 T15——未确认不进测评。

### API / 数据草案

| 方法 | 路径 | 角色 | 说明 |
|------|------|------|------|
| POST | `/api/teacher/material-import/transcript` | teacher | 字幕文本直接进 T15 job |
| POST | `/api/teacher/material-import/audio` | teacher | feature flag；本地/境内 STT |

复用 T15 的 `MaterialImportJob` + `DraftQuestion` 数据模型，`sourceKind` 增加 `'transcript'` 和 `'audio'`。

### 模块变更

- 扩展 `server/materialImport/` 模块（T15），增加 transcript 和 audio 入口。
- 复用现有 `server/stt/` 和 multimodal 合规基础设施（ADR-0005）。
- 复用 T10 egress gate 配置（`LLM_PROVIDER` / `OCR_PROVIDER` 模式扩展到 STT）。
- 前端教师材料导入页增加「粘贴字幕」和「上传音频」入口。

## Testing Decisions

### 测试缝隙

- **主缝隙**：扩展 `tests/materialImport.test.ts`（T15）— 增加 transcript 路径测试。
- **合规缝隙**：扩展 `tests/multimodalCompliance.test.ts` 或新测试 — 验证出境开关关闭时拒绝非本地 STT。

### 测试内容

1. 无确认不入库（复用 T15 测试路径）。
2. 出境开关关闭时拒绝非本地 STT（T10 egress gate 守护）。
3. 粘贴 WebVTT 字幕可生成草稿并确认入库。
4. 音频路径有 feature flag，默认安全关闭或本地。
5. 架构：transcript 路径不写 score/evidence/Attempt（复用 T15 架构守护）。

### 好测试的标准

只测外部行为（API 响应 + egress gate + 闸门），不测 STT 转写质量。参考现有 `tests/importOcr.test.ts` 和 `tests/sttProvider.test.ts` 的模式。

## Out of Scope

- 自动爬取视频网站
- 学生端上传全家桶
- 视频剪辑器

## Further Notes

### 验收（Done 定义）

1. 粘贴字幕可生成草稿并确认入库。
2. 音频路径有 flag，默认安全关闭或本地。
3. 出境开关关闭时拒绝非本地 STT。
4. 复用 T15 确认路径测试通过。
5. 实现报告 `docs/product-roadmap/reports/T22-implementation-report.md`。

### 关联旧票

- [[T15-material-to-draft-questions]]：草稿闸门、MaterialImportJob 模型（**Blocked by**）
- [[T10-data-egress-compliance]]：学生 PII 永不出境；出境配置开关
- ADR-0005：multimodal 音频不落盘精神
- CONTEXT：模态级数据治理
