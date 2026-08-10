# Issue T22 — 音视频/转写 → 闪卡与小测草稿

**Triage**: ready-for-agent
**Source PRD**: [prds/T22-media-to-flashcard-drafts.md](../prds/T22-media-to-flashcard-drafts.md)
**Build order**: 7（体验加深项）

## What to build

一条端到端纵向切片：扩展 T15 的 `materialImport` 模块，增加媒体转写入口——`sourceKind` 扩展 `transcript` / `audio` → `POST /api/teacher/material-import/transcript`（粘贴字幕/WebVTT 直接进 T15 job）→ `POST /api/teacher/material-import/audio`（feature flag 控制，默认安全关闭或本地 STT）→ 复用 T15 的草稿校对闸门（修正 → 确认 → 入库）→ 教师材料导入页增加「粘贴字幕」/「上传音频」入口 → 合规：出境开关关闭时拒绝非本地 STT（复用 T10 egress gate）；学生课堂录音默认禁止作题库材料，仅推荐教师讲解录音 + 确认勾选。

闪卡可作为 `fill_blank` 或轻量 Flashcard 内容类型。

## Acceptance criteria

- [ ] 粘贴字幕可生成草稿并确认入库（复用 T15 闸门）
- [ ] 音频路径有 feature flag，默认安全关闭或本地
- [ ] 出境开关关闭时拒绝非本地 STT
- [ ] 复用 T15 确认路径测试通过
- [ ] 实现报告 `docs/product-roadmap/reports/T22-implementation-report.md` 完成

## Blocked by

- [ISSUE-T15](../issues/ISSUE-T15.md)（本票在 T15 闸门与 MaterialImportJob 模型之上扩展，必须 T15 先建）
