# [wayfinder:ticket] T15 材料 → 草稿题（教师校对闸门）

## Question

黑客松高频能力「上传教材/笔记 → 自动出测验」在本产品中必须改写成：**LLM 只生成草稿题，教师校对确认后才入库**，且未确认题不可用于测评态。对齐 ChatEDU 的内容入口，守 D2 证据分级与 ADR-0001 铁律。

**来源**：国外教育黑客松调研 Wave A-①；扩展 T04（OCR/文档解析）与 T03（题库）的「非扫描材料」路径。

**Blocked by**: T03（Question 结构）、T04（草稿→校对→入库闸门可复用）、T09（标准解析可选）、T10（出境：学生 PII 永不出；题目内容默认境内 LLM）

---

## 要定什么

1. **输入形态（MVP）**  
   - 纯文本粘贴 / `.txt` / 已有 T04 电子文档解析产出的文本。  
   - **不做**（本票）：音视频转写、任意网页抓取、学生端自助出题。

2. **生成物**  
   - 候选草稿题列表：优先 `choice` / `fill_blank` / `numeric`；可选 1 道 `essay` 提纲题。  
   - 每题候选字段：题干、选项/答案草稿、建议 `questionType`、建议 `kpIds`、可选 `solution` 草稿。  
   - 全部标 `provenance: llm_inference`，状态 `draft`，**不能**进测评、不能喂正式 MasteryProfile。

3. **闸门**  
   - 复用 T04：「草稿 → 教师逐题确认/修正 → `published` 入库」。  
   - 确认时强制：答案权威为 `authored_key`（teacherId）；无答案的题不得确认入库用于测评。  
   - 生成失败/低置信：标红 + 手工录入降级，不阻塞题库。

4. **与 AI 出题出界的边界**  
   - PRODUCT-MAP Out of scope 写明「AI 自动出题」——本票**不**做无人工的自动入库，只做「省打字的草稿生成器」。  
   - 学生端无入口；仅教师题库工作台。

5. **配额与降级**  
   - 与 T05/演示 AI 同构：`LLM_API_KEY` 未配 → 模板假草稿（固定 2 题样例）可演示校对流。  
   - 每教师每时段生成次数上限（配置项，v1 仅提示不收费）。

---

## 建议 MVP 形状

### 数据

```
MaterialImportJob {
  id, teacherId, teachingUnitId?,
  sourceKind: 'paste' | 'text_file' | 'doc_parse',
  sourceRef?: string,          // 文件 hash 或 blob 路径
  rawTextHash: string,         // 不落全文到日志
  status: 'pending' | 'generated' | 'partially_confirmed' | 'done' | 'failed',
  createdAt
}
DraftQuestion {
  id, jobId, teacherId,
  payload: QuestionDraftShape, // 对齐 T03 录入表单
  status: 'draft' | 'confirmed' | 'discarded',
  provenance: 'llm_inference',
  confirmedQuestionId?: string // 入库后指向 Question.id
}
```

存储：product SQLite 新表；原文可短暂存 blob/内存，确认后可丢原文（仅留 hash）以减 PII 面。

### API（草案）

| 方法 | 路径 | 角色 | 说明 |
|------|------|------|------|
| POST | `/api/teacher/material-import` | teacher | body: text 或 upload ref → 创建 job + 生成草稿 |
| GET | `/api/teacher/material-import/:jobId` | teacher | job + draft 列表 |
| PATCH | `/api/teacher/material-import/drafts/:id` | teacher | 修正草稿字段 |
| POST | `/api/teacher/material-import/drafts/:id/confirm` | teacher | 校验答案 → 写入题库 published |
| POST | `/api/teacher/material-import/drafts/:id/discard` | teacher | 丢弃 |

### UI

- 教师题库页：**「从材料生成草稿」**（粘贴区 + 可选文件）。  
- 校对列表：并排原文片段（可截断）与题表单；确认/丢弃；批量确认仅允许「已填答案」的题。

### 测试

- 未 confirm 的 draft 不可被 assessment 场次引用（422 或查询不可见）。  
- confirm 后 Question 带 `authored_key` + teacherId。  
- 架构：生成路径不写 score/evidence/Attempt。  
- 无 LLM key 时模板路径仍可走通校对。

---

## 出界（本票不做）

- 学生自助「扔 PDF 开练」  
- 无校对自动入库  
- 视频/语音材料（→ T22）  
- 跨教师题库共享  
- 把 LLM 生成答案当 `test_case` 证据  

---

## 验收（Done 定义）

1. 教师粘贴一段样例讲义 → 得 ≥2 道 draft。  
2. 修正并 confirm 1 道 → 题库可见且可布置测评。  
3. 未 confirm 题不可出现在测评选题器。  
4. 铁律测试：全流程零 score 写入。  
5. 实现报告 `docs/product-roadmap/reports/T15-implementation-report.md`。

---

## 状态

**OPEN** — 待实现。

## 关联

[[T03-question-bank]] [[T04-ocr-import]] [[T09-standard-solution]] [[T10-data-egress-compliance]]  
CONTEXT：D2 证据分级；LLM 永不改分、不捏造评分证据。
