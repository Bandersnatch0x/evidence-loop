# PRD: T15 材料 → 草稿题（教师校对闸门）

**状态**: OPEN
**开建顺序**: 2
**来源**: 教师出题效率增强需求；扩展 T04（OCR/文档解析）与 T03（题库）的「非扫描材料」路径

---

## Problem Statement

「上传教材/笔记 → 自动出测验」这类能力在本产品中如果直接做，会违反 ADR-0001 铁律（LLM 不捏造评分证据）和 D2 证据分级（未确认题不可用于测评态）。教师需要一个"省打字的草稿生成器"——LLM 从讲义文本生成候选题目草稿，但教师必须逐题校对确认后才入库，且未确认题不可用于测评。

## Solution

在教师题库工作台增加「从材料生成草稿」入口：教师粘贴文本或上传 `.txt` → LLM 生成候选草稿题（优先 choice / fill_blank / numeric）→ 教师逐题校对修正 → 确认入库为 `published` Question（`source: authored_key`）。全部草稿标 `provenance: llm_inference`，未确认题不可被 assessment 场次引用。无 LLM key 时降级为模板假草稿（固定 2 题样例），校对流不受阻。

## User Stories

1. 作为教师，我想粘贴一段讲义文本后自动生成候选题目草稿，以便省去手工录入的时间。
2. 作为教师，我想在校对列表中并排看到原文片段和生成的题目表单，以便快速判断题目质量。
3. 作为教师，我想逐题修正草稿的字段（题干、选项、答案、知识点标注），以便确保题目正确。
4. 作为教师，我想逐题确认或丢弃草稿，以便只有我审核过的题才进入题库。
5. 作为教师，我想批量确认"已填答案"的草稿，以便加速校对流程。
6. 作为教师，我想在生成失败或低置信时看到标红提示并能手工录入降级，以便不阻塞题库工作。
7. 作为教师，我想在无 LLM 配置时仍能走通校对流（模板假草稿），以便 Demo 和开发环境可用。
8. 作为教师，我想确认入库的题带 `authored_key` 答案权威标记和我的 teacherId，以便溯源。
9. 作为学生，我不应有此功能的入口，以便题目生成仅限教师。
10. 作为系统，未确认的草稿题不可出现在测评选题器中，以便防止 AI 生成的未审核题进入正式评分。
11. 作为开发者，我想在 CI 中验证生成路径零 score / evidence / Attempt 写入，以便守护铁律。
12. 作为教师，我想看到生成任务的进度状态（pending → generated → partially_confirmed → done），以便追踪校对进度。
13. 作为教师，我想确认后的题立即可用于布置作业和测评，以便无缝衔接教学流程。

## Implementation Decisions

### 要定什么

1. **输入形态（MVP）**：纯文本粘贴 / `.txt` / 已有 T04 电子文档解析产出的文本。不做音视频转写（→ T22）、任意网页抓取、学生端自助出题。

2. **生成物**：候选草稿题列表，优先 `choice` / `fill_blank` / `numeric`，可选 1 道 `essay` 提纲题。每题候选字段：题干、选项/答案草稿、建议 `questionType`、建议 `kpIds`、可选 `solution` 草稿。全部标 `provenance: llm_inference`，状态 `draft`，不能进测评、不能喂正式 MasteryProfile。

3. **闸门**：复用 T04「草稿 → 教师逐题确认/修正 → `published` 入库」。确认时强制：答案权威为 `authored_key`（teacherId）；无答案的题不得确认入库用于测评。生成失败/低置信：标红 + 手工录入降级，不阻塞题库。

4. **配额与降级**：与 T05/演示 AI 同构——`LLM_API_KEY` 未配 → 模板假草稿（固定 2 题样例）可演示校对流。每教师每时段生成次数上限（配置项，v1 仅提示不收费）。

### API / 数据草案

**数据模型**：

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

**API 端点**：

| 方法 | 路径 | 角色 | 说明 |
|------|------|------|------|
| POST | `/api/teacher/material-import` | teacher | body: text 或 upload ref → 创建 job + 生成草稿 |
| GET | `/api/teacher/material-import/:jobId` | teacher | job + draft 列表 |
| PATCH | `/api/teacher/material-import/drafts/:id` | teacher | 修正草稿字段 |
| POST | `/api/teacher/material-import/drafts/:id/confirm` | teacher | 校验答案 → 写入题库 published |
| POST | `/api/teacher/material-import/drafts/:id/discard` | teacher | 丢弃 |

### 模块变更

- 新增 `server/materialImport/` 模块（service + store + routes），对齐 questionbank 模式。
- 复用 T03 Question 结构和 T04 草稿→校对→入库闸门模式。
- 前端教师题库页增加「从材料生成草稿」入口 + 校对列表 UI。
- `tests/architecture.test.ts` 增加守护：materialImport 路径不写 score/evidence/Attempt。

## Testing Decisions

### 测试缝隙

- **主缝隙**：新 `tests/materialImport.test.ts` — HTTP API 级集成测试，覆盖完整流程（POST 生成 → GET 列表 → PATCH 修正 → POST confirm → 题库可见）。
- **架构守护缝隙**：`tests/architecture.test.ts`（扩展）— 验证 `server/materialImport/` 不 import mastery/review/runner/scoring 路径。

### 测试内容

1. 未 confirm 的 draft 不可被 assessment 场次引用（422 或查询不可见）。
2. confirm 后 Question 带 `authored_key` + teacherId，状态 `published`。
3. 架构：生成路径不写 score/evidence/Attempt。
4. 无 LLM key 时模板路径仍可走通校对（降级测试）。
5. discard 后 draft 状态变更，不产生 Question。
6. 批量确认仅允许"已填答案"的题。

### 好测试的标准

只测外部行为（API 响应状态码 + 响应体 + 副作用——题库是否可见），不测 LLM 生成内容质量。参考现有 `tests/importOcr.test.ts` 和 `tests/questionBank.test.ts` 的模式。

## Out of Scope

- 学生自助「扔 PDF 开练」
- 无校对自动入库（AI 自动出题入库在 PRODUCT-MAP Out of scope）
- 视频/语音材料（→ T22）
- 跨教师题库共享
- 把 LLM 生成答案当 `test_case` 证据

## Further Notes

### 验收（Done 定义）

1. 教师粘贴一段样例讲义 → 得 ≥2 道 draft。
2. 修正并 confirm 1 道 → 题库可见且可布置测评。
3. 未 confirm 题不可出现在测评选题器。
4. 铁律测试：全流程零 score 写入。
5. 无 LLM key 时模板降级路径走通。
6. 实现报告 `docs/product-roadmap/reports/T15-implementation-report.md`。

### 关联旧票

- [[T03-question-bank]]：Question 结构、题库录入表单
- [[T04-ocr-import]]：草稿→校对→入库闸门模式
- [[T09-standard-solution]]：标准解析可选挂载
- [[T10-data-egress-compliance]]：学生 PII 永不出境；题目内容默认境内 LLM
- CONTEXT：D2 证据分级；LLM 永不改分、不捏造评分证据
