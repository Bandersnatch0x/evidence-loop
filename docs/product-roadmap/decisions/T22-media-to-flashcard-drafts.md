# [wayfinder:ticket] T22 音视频/转写 → 闪卡与小测草稿

## Question

黑客松常见「YouTube/课堂录音 → 闪卡/测验」。本票在 T15 材料草稿之上增加 **媒体转写入口**：STT/字幕 → 文本 → 复用 T15 草稿生成与教师校对闸门。守 T10：含学生语音的强 PII **永不出境**。

**来源**：国外教育黑客松调研 Wave C-⑧。

**Blocked by**: T15（草稿闸门）、T04（校对 UI）、现有 `server/stt/*` 与 multimodal 合规、T10

---

## 要定什么

1. **输入 MVP**  
   - 教师上传音频（时长上限，如 15min）或粘贴字幕/WebVTT。  
   - **暂缓**：任意 YouTube URL 拉取（版权与抓取稳定性）；若做仅允许教师粘贴已下载字幕。

2. **流水线**  
   ```
   媒体 → STT/字幕文本 → MaterialImportJob(sourceKind=transcript)
        → DraftQuestion / DraftFlashcard → 教师确认 → 入库
   ```  
   - 闪卡可作为 `fill_blank` 或轻量 `Flashcard` 内容类型（若不想新类型，统一进填空草稿）。

3. **隐私**  
   - 学生课堂录音若含同学声音：默认 **禁止** 作题库材料，或强制本地 STT + 不落盘原文（对齐 ADR-0005 音频不落盘精神）。  
   - MVP 推荐：**仅教师讲解录音/无学生发言素材** + 确认勾选。

4. **与评分**  
   - 同 T15：未确认不进测评。

---

## 建议 MVP 形状

### API

| 方法 | 路径 | 角色 | 说明 |
|------|------|------|------|
| POST | `/api/teacher/flashcard-drafts` | teacher | 字幕/转写文本 → 闪卡草稿（主路径） |
| POST | `/api/teacher/flashcard-drafts/audio` | teacher | feature flag；须带 transcript（audioBase64 无真 STT 时 拒） |
| POST | `/api/teacher/material-import/transcript` | teacher | **别名** → flashcard-drafts（票路径兼容） |
| POST | `/api/teacher/material-import/audio` | teacher | **别名** → flashcard-drafts/audio |

### 测试

- 无确认不入库。  
- 出境开关关闭时拒绝非本地 STT。  
- 复用 T15 确认路径测试。

---

## 出界（本票不做）

- 自动爬取视频网站  
- 学生端上传全家桶  
- 视频剪辑器  

---

## 验收（Done 定义）

1. 粘贴字幕可生成草稿并确认入库。  
2. 音频路径有 flag，默认安全关闭或本地。  
3. 实现报告 `docs/product-roadmap/reports/T22-implementation-report.md`。

---

## 状态

**OPEN** — Wave C；**Blocked by T15**。

## 关联

[[T15-material-to-draft-questions]] [[T10-data-egress-compliance]] ADR-0005 multimodal  
CONTEXT：模态级数据治理。
