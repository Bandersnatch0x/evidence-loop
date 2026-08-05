# 教学演示模块构建规格（Teaching Demonstration Module Spec）

> 状态：构建规格（可直接进入 /to-tickets 拆票与实施）
> 来源：wayfinder 地图 `.scratch/teaching-demonstration-studio/map.md`（Status CLEARED，16/16 票 closed）+ 16 张决策票 + `CONTEXT.md` + 仓库事实核对
> 引用约定：每条关键决策标注来源票号，如 [票 02]。本规格只陈述已定决策，不引入新决策；模糊处标注「[待实施期确认]」。

---

## 1. 概述

### 1.1 目标

把现有「题目内嵌可视化」重构为产品内独立的**教学演示模块**：教师可在桌面浏览器制作专业 2D、3D 与动画场景并编排视频，作品经审核进入**公共素材库**，题目与知识点通过**固定版本引用**在全端播放。本规格汇总全部已关闭决策，作为实施拆票的唯一依据（实现者读本规格 + 相关票即可开工）。

核心立场（地图 Charting 阶段钉死，全部继续成立）：

- 一级成品是 `TeachingDemonstration / 教学演示`；`MediaAsset / 素材` 是被成品引用的图片、模型、音频、纹理或视频源文件 [地图 #1]。
- 多维分类：格式（可编辑场景 | 视频）× 空间（2D | 3D）× 行为（静态 | 动画 | 互动），可表达「3D 动画」等组合 [地图 #2]。
- 统一场景编辑器；AI 是可选创作助手，输出可编辑草稿，教师确认后才保存或发布 [地图 #3]。
- 产品内独立模块：独立领域、存储、API、编辑器、公共库与播放器；首版同部署不拆微服务 [地图 #4]。
- 创作端 = 专业创作套件，桌面浏览器完整创作；桌面/平板/手机全端播放 [地图 #5]。
- 视频只做封面、章节、播放区间等编排，不做剪辑 [地图 #6]。
- 公共库先审后发；新增平台级 `PublicLibraryReviewer / 公共库审核员` [地图 #7]。
- 公共作品支持固定版本引用与带来源派生；不做多人共同编辑 [地图 #8]。
- `Question / 题目` 与 `KnowledgePoint / 知识点` 可引用教学演示；`QuestionType / 题型` 不引用，评分边界不变 [地图 #9]。
- 现有 `Question.visualization`、demo registry 与预置演示迁移为独立教学演示及固定版本；迁移期只读兼容旧字段，目标模型不长期双轨 [地图 #10]。
- 教学演示与播放行为不进入评分证据链，LLM 不改分的现有铁律不变 [地图 #11]。

### 1.2 范围

- 领域模型与数据模型（migration 0008+ 表族）设计。
- `SceneDocument` 场景文档契约（唯一真源格式）。
- API 契约：创作 / 草稿 / 提交 / 撤回 / 审核 / 公共库检索 / 媒体 / 引用管理。
- 播放器运行时契约（唯一只读消费端）。
- 渐进迁移（expand-contract：Phase E 双读 → Phase C 写路径切换 → 终删）。
- 原型验证要求（票 06 创作工作台、票 13 发现/播放）与 v1 验收门。

### 1.3 非目标（Out of scope，来自地图）

- 在地图内直接实现或迁移产品代码（本规格为实施输入，不是实施）。
- 首版拆成独立微服务或独立应用 [地图 #4]。
- 手机或平板上的完整专业创作能力 [地图 #5]。
- 多轨剪辑、转场、调色、音频混合、特效合成等完整视频工作站 [地图 #6]。
- `QuestionType / 题型` 级默认演示或演示参与 Runner、Rubric、Evidence、score [地图 #9]。
- 多人实时共同编辑同一教学演示；公共复用采用引用与派生 [地图 #8]。
- 校级管理员、学校组织治理或审核员访问教学成绩 [地图 #7]。
- 素材交易、付费市场、广告、直播、录课与完整课程编排 [地图]。

v1 明确延后项（票 15）：HLS/ABR 与多码率、服务端 3D 缩略图 renderer、自动字幕/翻译、非 YT/Vimeo 外链 adapter（含中国大陆站点）、多轨剪辑/转场/调色/音混、移动端专业创作、多人协作、任意脚本沙箱、Draco/KTX2、素材交易市场、CDN 部署（按票 03 接口演进，非 v1 验收项）[票 15]。

### 1.4 术语表（域词与既有决策衔接）

| 域词 | 含义 | 关键衔接 |
|---|---|---|
| TeachingDemonstration / 教学演示 | 教师创作成品的小型聚合根 | 票 02；不从属题库，不进评分链 [地图 #9] |
| DemonstrationDraft / 演示草稿 | 与作品一对一、可高频保存的独立可变聚合 | 票 02 |
| DemonstrationVersion / 演示版本 | 提交时冻结的不可变可播放快照 | 票 02、04 |
| MediaAsset / 素材 | 可跨作品复用的独立资源身份（图片/模型/音频/纹理/视频） | 票 03；地图 #1 |
| MediaBlob / 不可变 blob | 内容寻址（SHA-256）的物理文件 | 票 03；`server/media/paths.ts` 契约 |
| MediaDerivative / 派生物 | 按 recipe 幂等生成的加工产物（展示图/缩略图/播放版） | 票 03 |
| UploadSession / 上传会话 | tus 断点续传会话，先配额预留 | 票 03 |
| MediaJob / 媒体作业 | 带租约的持久化处理作业 | 票 03 |
| ExternalVideoRef / 外链视频引用 | YouTube/Vimeo 官方 embed 引用，非 blob | 票 03 |
| DemonstrationReference / 演示引用 | 题目/知识点 → 发布版本的有序固定引用 | 票 12 |
| PublicLibraryReviewer / 公共库审核员 | 平台级内容治理角色（标志列，非 role 枚举） | 票 04、14 |
| PublicReference / 公共引用 | 固定版本引用 + 手动升级语义 | 票 08 |
| SceneDocument / 场景文档 | 产品自有规范化 JSON，唯一真源 | 票 10 |
| DemonstrationPlayer / 演示播放器 | 唯一只读消费端，零耦合评分链 | 票 07 |
| TeacherStudio / 教师创作工作台 | 桌面三区布局创作套件（前端异步 chunk） | 票 06、14 |
| AIAssistantBoundary / AI 创作助手边界 | 结构化生成、检查点草稿、教师确认 | 票 09 |

既有域衔接：`Evidence / Runner / Rubric / Attempt / MasteryProfile / PublicationReview / provenance` 见 `CONTEXT.md`；`Question.visualization` 旧模型见 §7。

---

## 2. 领域模型

聚合边界总原则（票 02）：**小型作品根 + 独立内容聚合**——作品根不内嵌持续变化的场景/视频内容或历史版本；草稿、版本、素材均为独立聚合，引用关系不重新耦合。

### 2.1 TeachingDemonstration / 教学演示（小根）

职责（票 02）：
- 维护稳定作品身份、作者（ownerId）、当前管理元数据、来源链。
- 维护「当前草稿 / 待审版本 / 当前发布版本」的生命周期关系。
- 不内嵌场景、视频或历史版本内容。

关键不变量：
- 与 `DemonstrationDraft` 一对一关联；与多个 `DemonstrationVersion` 关联 [票 02]。
- 删除 = 只软删身份（`deleted_at`）；草稿、版本或外部固定引用仍在使用的内容与素材 blob 必须保留，只有不再受任何保留引用保护且超过保留期后才能回收 [票 02]。
- 派生公共作品会创建新的作品根与草稿，永久记录来源版本 [票 02、08]。

### 2.2 DemonstrationDraft / 演示草稿

职责（票 02）：与一个教学演示**一对一**关联的独立可变聚合，承担专业编辑器高频保存（含 AI 检查点快照，票 09）。

关键不变量：
- 不能被题目、知识点或公共库直接引用 [票 02]。
- 提交后草稿继续独立编辑；候选版本获批只使该版本成为当前发布版本，**绝不回退、覆盖或自动合并**草稿 [票 02]。

### 2.3 DemonstrationVersion / 演示版本

职责（票 02、04）：提交审核时从草稿生成的**不可变、可播放快照**，完整冻结：标题、说明、多维分类、许可、场景/视频内容、素材清单、AI 参与披露、来源链。

关键不变量：
- 审核（`submitted | approved | rejected | withdrawn`）只改变生命周期状态，**不改变快照内容** [票 04]。
- 同一教学演示**最多一个待审版本**；再次提交前必须等待或撤回 [票 04]。
- 公共库只展示**最新发布版本**；旧发布版本停止接受新引用，但已有题目/知识点固定引用继续播放 [票 02、08]。
- 已发布作品的更新 = 提交新版本再审；旧发布版本在新版本获批前继续公开展示并供既有引用播放 [票 04]。

### 2.4 提交与发布并发模型（票 02、04）

```
草稿（可编辑，持续变化）
   │  POST /submit  冻结快照 → demonstration_versions(status=submitted)
   ▼
submitted ──批准──► approved（当前发布版本；后续新版本获批后停止接受新引用）
   │ 驳回 ──► rejected（附理由，草稿可修改后重新提交为新审核轮次）
   │ 撤回 ──► withdrawn
   └─（草稿不因审核结果变化；继续编辑）
```
- 批准/驳回只改变版本状态，不改变版本内容；教师可随时继续编辑草稿 [票 02、04]。
- 驳回后修改草稿重新提交 = 新审核轮次（新版本）[票 04]。

### 2.5 MediaAsset / MediaBlob / MediaDerivative / UploadSession / MediaJob（媒体族）

职责（票 03 + 调研 §3.1）：
- `MediaAsset`：独立资源身份（kind: image|audio|model3d|video|subtitle），可被多个教学演示复用；不独占文件。
- `MediaBlob`：内容哈希不可变物理文件（`data/media/<sha256>.<ext>`）；`hash` 全局唯一。
- `MediaDerivative`：`assetId + role(display|thumbnail|poster|playback|caption) + blobHash + sourceBlobHash + recipeName + recipeVersion`；相同 `sourceBlobHash + recipeName + recipeVersion` 幂等复用。
- `UploadSession`：tus 会话 + 配额预留（`quotaReservationBytes`）。
- `MediaJob`：带租约（`leaseOwner/leaseExpiresAt`）的持久化作业，重启可续跑。

关键不变量（票 03、调研 §3.1）：
- 版本引用具体 `assetId + blobHash/derivativeHash`；替换文件必须产生新内容引用，历史版本绝不静默变化 [票 02、03]。
- 上传期间只写随机临时文件；完成后服务端流式重算 SHA-256、鉴定真实类型、扫描、原子提交 [票 03]。
- 状态机 `uploading → quarantined → inspecting → processing → ready`，任何一步可 `rejected/failed`；有非 `ready` 媒体的候选版本不得提交审核 [票 03]。
- SQLite 只存元数据/会话/配额/作业；blob 在文件系统 [票 03]。
- `BlobStore / UploadStore / MediaProcessor` 三接口从第一天存在；v1 `FsBlobStore` + 本地 worker，生产换 S3/独立 worker，不改变领域身份或版本快照 [票 03、14]。
- 素材删除只软删身份；被草稿、待审版本、已发布版本或固定引用使用的 blob 必须保留，零引用且超保留期才物理回收 [票 02、03]。

### 2.6 ExternalVideoRef / 外链视频引用

职责（票 03）：`provider(yt|vimeo) + providerVideoId + canonicalUrl + health + checkedAt + consecutiveFailures`。

关键不变量：
- 版本快照引用**引用与编排元数据**而非第三方内容；平台不提供内容不可变保证 [票 03]。
- v1 仅 YouTube/Vimeo 官方 embed 白名单 adapter（纯字符串解析 provider ID，服务端不请求用户 URL、不渲染 oEmbed `html`）[票 03、调研 §7.1]。
- 健康状态 `unknown|healthy|degraded|unavailable|private|embed_forbidden`；三个独立检查窗口仍失败才判不可用；**绝不自动改写或删除历史版本** [票 03]。

### 2.7 DemonstrationReference / 演示引用（票 12）

- `Question` / `KnowledgePoint` ↔ `DemonstrationVersion` **多对多有序**；`role: primary | supplementary`（每题最多 1 主 + 补充上限 8）。
- 引用对象 = **作品 ID + 版本 ID 复合固定**（同票 08）：建立时固定当时最新发布版本，绝不容许「最新」漂移。
- 教师（作者本人）可为私有题绑定已发布公共作品或本人私有发布版本；公共/种子题只读；学生不可绑定；绑定/解绑不触发审核 [票 12]。
- 纯展示语义铁律：仅存 `demonstration_references` 表，与题目判定数据物理隔离；绝不进入 QuestionType/Runner/Rubric/Evidence；架构测试守护评分路径零读取 [票 12]。

### 2.8 PublicLibraryReviewer / 公共库审核员（票 04、14）

- 平台级内容治理角色，只负责公共教学演示的审核、下架与申诉；不进入教学组织、不管理学校/成绩/教学账号 [票 04]。
- 实现为 `users` 表 `public_library_reviewer` 标志列，**不扩 role 枚举**（现 `student|teacher|admin`，0003_auth.sql）[票 14]。
- 审核员只读公共库治理端点，永不被授予教学/成绩/审计查看权 [票 04、14]。

### 2.9 删除与回收总则（票 02、08）

- 作品删除：只隐藏作品身份；仍被引用/派生的内容保留。
- 素材删除：只软删身份；被引用 blob 保留，零引用且超保留期才回收；临时上传用更短 TTL，不与正式回收共用规则（调研 §8）。
- 源作品失效：已固定引用与已发布派生继续播放，不自动删除、不改写历史；引用处显示「源不可用」标记 + 通知；新引用与新派生随即停止；侵权/违规裁定后审核员可强制处置，限期替换 [票 08]。

---

## 3. 数据模型（migration 0008+）

### 3.1 迁移惯例（仓库事实，实施必须遵守）

- 迁移为 `server/db/migrations/` 下纯 SQL 文件，`migrate.ts` 按文件名排序、`schema_migrations` 表幂等应用（现有 0001–0007，含 `meta/` 目录）[仓库事实]。
- 可选列采用「0007 SQL 迁移 + `ensureQuestionVisualizationColumn` backfill 双保险」模式（`server/db/migrate.ts`）[仓库事实，参照 0004/0007]。
- 新表族统一放 `0008_demonstration_module.sql`（或按实施粒度拆 0008+，见 §10 拆票）。
- Drizzle TS-first schema 声明与 SQL 迁移同步维护（`server/db/schema.ts` 模式）[仓库事实]。

### 3.2 表清单与字段（票 14 定形 + 票 03/调研 §3.1 定媒体族）

主键约定：沿用 `text('id').primaryKey()`（UUID 风格）；时间戳 `text('..._at')` ISO 字符串（与现有表一致）。

**作品族**：

```
teaching_demonstrations
  id            TEXT PK          -- 稳定作品身份
  owner_id      TEXT NOT NULL    -- 作者（users.id）
  meta_json     TEXT NOT NULL    -- 当前管理元数据（标题/说明/多维分类/许可/来源链等管理快照）
  deleted_at    TEXT             -- 软删时间；NULL = 有效

demonstration_drafts
  id              TEXT PK
  demonstration_id TEXT NOT NULL UNIQUE   -- 与作品一对一
  document_json   TEXT NOT NULL  -- SceneDocument（当前可编辑态）
  checkpoint_json TEXT           -- AI 检查点快照序列（票 09）
  updated_at      TEXT NOT NULL

demonstration_versions
  id                   TEXT PK
  demonstration_id     TEXT NOT NULL
  status               TEXT NOT NULL  -- submitted | approved | rejected | withdrawn
  snapshot_document_json TEXT NOT NULL -- 不可变 SceneDocument 快照
  classification       TEXT NOT NULL  -- 多维分类 JSON（format×space×behavior）
  license              TEXT NOT NULL  -- 分发许可（v1 白名单，集合 [待实施期确认]）
  ai_disclosure        TEXT NOT NULL  -- AI 参与披露（必填，票 04）
  source_chain_json    TEXT           -- 派生来源链（来源作品+版本+作者，票 08）
  media_manifest_json  TEXT NOT NULL  -- 素材清单（blob hash/类型/尺寸/处理状态/派生物 hash）
  reviewer_note        TEXT           -- 驳回理由 / 审核备注
  frozen_at            TEXT NOT NULL  -- 提交冻结时间
```

**媒体族**（字段来自调研 §3.1 建议，命名对齐现有契约）：

```
media_assets
  id                  TEXT PK
  owner_id            TEXT NOT NULL
  kind                TEXT NOT NULL  -- image|audio|model3d|video|subtitle
  original_blob_hash  TEXT NOT NULL
  status              TEXT NOT NULL
  display_name        TEXT NOT NULL  -- 清洗后的展示名，绝不参与磁盘路径
  created_at          TEXT NOT NULL
  deleted_at          TEXT

media_blobs
  hash                TEXT PK       -- SHA-256 内容寻址，全局唯一
  canonical_extension TEXT NOT NULL -- 服务端确认的规范扩展名（非用户文件名）
  media_type          TEXT NOT NULL
  byte_size           INTEGER NOT NULL
  storage_key         TEXT NOT NULL -- data/media/<hash>.<ext> 相对路径（paths.ts 契约）
  scan_status         TEXT NOT NULL -- ClamAV 结果；不可用时 fail-closed 保持 quarantined
  created_at          TEXT NOT NULL

media_derivatives
  id                 TEXT PK
  asset_id           TEXT NOT NULL
  role               TEXT NOT NULL  -- display|thumbnail|poster|playback|caption
  blob_hash          TEXT NOT NULL
  source_blob_hash   TEXT NOT NULL
  recipe_name        TEXT NOT NULL
  recipe_version     TEXT NOT NULL
  -- UNIQUE(source_blob_hash, recipe_name, recipe_version) 幂等复用

upload_sessions
  id                   TEXT PK
  owner_id             TEXT NOT NULL
  intended_kind        TEXT NOT NULL
  declared_bytes       INTEGER NOT NULL
  received_bytes       INTEGER NOT NULL  -- 服务端实际计数，不只信 Content-Length
  temp_key             TEXT NOT NULL
  state                TEXT NOT NULL  -- uploading|quarantined|inspecting|processing|ready|rejected|failed
  quota_reservation_bytes INTEGER NOT NULL
  expires_at           TEXT NOT NULL  -- 24h Upload-Expires
  created_at           TEXT NOT NULL

media_jobs
  id               TEXT PK
  asset_id         TEXT NOT NULL
  job_type         TEXT NOT NULL
  state            TEXT NOT NULL
  attempts         INTEGER NOT NULL DEFAULT 0
  available_at     TEXT NOT NULL
  lease_owner      TEXT
  lease_expires_at TEXT
  last_error_code  TEXT

external_video_refs
  id                  TEXT PK
  owner_id            TEXT NOT NULL
  provider            TEXT NOT NULL  -- youtube|vimeo（v1 白名单）
  provider_video_id   TEXT NOT NULL
  canonical_url       TEXT NOT NULL
  health              TEXT NOT NULL  -- unknown|healthy|degraded|unavailable|private|embed_forbidden
  checked_at          TEXT
  consecutive_failures INTEGER NOT NULL DEFAULT 0
  last_failure_code   TEXT
```

**引用表**（票 12）：

```
demonstration_references
  id               TEXT PK
  question_id      TEXT NULL       -- 与 kp_id 恰一（CHECK）
  kp_id            TEXT NULL
  demo_version_id  TEXT NOT NULL   -- 作品 ID + 版本 ID 复合固定（版本表已含作品归属）
  role             TEXT NOT NULL   -- primary | supplementary
  ord              INTEGER NOT NULL
  -- UNIQUE(question_id, role, ord) / UNIQUE(kp_id, role, ord) 约束排序
  -- UNIQUE(question_id, role) 约束 primary 至多 1（DB 层 + 服务层双保险）
```

**配额预留**（票 03 §4.2）：账户配额（每教师 5 GiB 逻辑、2 并发上传、1 并发视频作业、临时盘预留 ≤3 GiB）在 `upload_sessions` 创建时事务内预留，不单独建配额表；按「owner 首次引用一个原始 hash」计逻辑字节，全局物理去重不得让租户免费占用他人额度，也不得通过响应差异泄露 hash 存在性 [票 03、调研 §4.2]。

### 3.3 SQLite 约束与索引（实施要点）

- CHECK 约束：`demonstration_references` 的 `(question_id IS NULL) != (kp_id IS NULL)`（恰一）；`demonstration_versions.status IN (...)`；`upload_sessions.state IN (...)`；`external_video_refs.health IN (...)`。
- 唯一索引：
  - `demonstration_drafts(demonstration_id)` UNIQUE（一对一）。
  - `media_blobs(hash)` PK + 全局唯一。
  - `media_derivatives(source_blob_hash, recipe_name, recipe_version)` UNIQUE（幂等）。
  - `demonstration_references(question_id, ord)` / `(kp_id, ord)` UNIQUE；`(question_id, role)` / `(kp_id, role)` 部分唯一（primary 至多 1）。
- 常规索引（检索/队列热路径）：
  - `teaching_demonstrations(owner_id)`、`(deleted_at)`。
  - `demonstration_versions(demonstration_id, status)`、`(status, frozen_at)`（审核队列）。
  - `upload_sessions(owner_id, state)`、`(expires_at)`（过期清理）。
  - `media_jobs(state, available_at)`（租约认领）、`(lease_expires_at)`。
  - `external_video_refs(provider, health)`（复检扫描）。
  - `demonstration_references(demo_version_id)`（失效通知、被引用计数——质量信号，票 11）。
- 媒体路径契约不可改：`server/media/paths.ts` 的 `data/media/<sha256>.<ext>`、路径逃逸检查（`assertMediaPathSafe`）、64 位 hex hash 校验 [仓库事实、票 03]。

### 3.4 权限与审计（票 14）

- 审核员 = `users.public_library_reviewer` 标志列（AuthStore 迁移），不扩 role 枚举 [票 14]。
- 发布/驳回/下架/举报/升级引用为**强制审计事件**（复用现有 audit HMAC 链，`actorRole`）[票 14]。
- 评分链隔离为**架构级约束**：`demonstration_*` 表与 QuestionType/Runner/Rubric/Evidence 物理隔离；架构测试断言评分路径零读演示表、播放器零写 [票 12、14]。

---

## 4. SceneDocument 契约（票 10 全量）

### 4.1 定位

产品自有规范化 JSON 场景文档 = **唯一真源**：编辑器写入、版本快照冻结（票 02）、播放器只读求值（票 07）、AI 起稿产物（票 09）、导入导出归一格式全部指向同一文档。文档**纯数据、确定性、零脚本**（无可执行代码、无引擎脚本字段、无运行时求值）。PlayCanvas 是首版 3D 编辑器内核（票 16），但文档不含其私有序列化或脚本——**换内核 = 换解释器**，文档契约不变 [票 10]。

### 4.2 顶层 section 清单（票 10）

| section | 内容 |
|---|---|
| `documentMeta` | 类型 / `sceneFormatVersion` / 单位坐标 / 生成器 |
| `objectTree` | 节点层级 / 变换 / 可见性 |
| `geometry2D` | SVG 子集：rect/circle/ellipse/path/line/polyline/polygon/text |
| `geometry3D` | glTF 2.0 资产引用 + 实例化；内联图元 box/sphere/cylinder/cone/plane/torus/ring |
| `materials` | 基础 PBR + 2D 填充/描边 |
| `skeletons` | 骨骼/关节/glTF skin 引用/形态键 |
| `particles` | 参数化粒子，确定性种子，可降级静态 |
| `timeline` | 确定性补间/关键帧 + 视频编排（章节/播放区间） |
| `interactions` | 声明式互动白名单，严格同票 07 四种类型 |
| `mediaRefs` | MediaAsset id + blob hash + 用途（票 03 CAS） |
| `fontsAndFormulas` | web-safe 字体白名单 + LaTeX 子集 |
| `editorMetadata` | 编辑器视图状态，播放端忽略 |
| `runtimeVersion` | `sceneFormatVersion` + `capabilities[]` |
| `viewerConfig` | 默认相机/灯光/背景/预算提示 |

### 4.3 开放标准 vs 产品扩展划分（票 10）

- **开放标准承载「有什么」**（资产内容事实格式，可无损 round-trip）：SVG 子集（2D 几何）、glTF 2.0（3D 网格/材质/骨骼/形态键，票 16 白名单）、WebVTT（字幕）、LaTeX 子集（公式）、JSON 容器。
- **产品 schema 承载「怎么编、怎么演、怎么互动」**：对象树、时间线补间、互动声明、媒体编排、编辑器元数据；**显式命名空间 + 版本化**。
- 发布快照同时含 glTF 源引用与导入后场景文档（票 16）；SVG/glTF 资产与场景文档并列发布。
- SVG/glTF 只作交换与发布快照，不作完整编辑文档 [票 01、10]。

### 4.4 Schema 校验（zod 信任边界）

- 复用 ADR-0015 `visualizationSchema` 的 zod 信任边界模式：`sceneDocumentSchema.parse` 为唯一入库/渲染闸门 [票 10、仓库事实 visualizationSchema.ts]。
- 硬校验失败拒存；软警告随保存提示（hard/soft 分法，同 `geometrySanity.ts` 模式）。
- 读时容错：非法快照静默丢弃或降级为静态替代并提示，不崩播放器。

### 4.5 能力协商

- 文档 `capabilities` 声明需求；消费端能力探测（WebGL1/2、设备分级）产出 `full → simplified → static-alternative → refuse-with-message`（对齐票 07 降级分级）；**协商在加载前完成，不静默错渲染**（票 16）。
- 编辑器端同清单决定功能可用性。

### 4.6 版本迁移（N-2）

- 版本快照不可变（票 02）：文档携带 `sceneFormatVersion`；播放器/编辑器支持 **N-2 版本**。
- 读旧版本在内存执行版本化纯迁移函数后播放/编辑；**永不回写快照**（不可变铁律）。
- 迁移失败 → 静态替代 + 明确提示；新内容一律写当前格式。

### 4.7 导入导出

- 导入 = glTF 2.0 白名单（复用票 03 GLB 门禁：Khronos Validator + 节点/三角面/纹理资源上限）+ SVG 子集 + MediaAsset 引用；不支持扩展显式拒绝或显式降级并提示（票 16），绝不静默错渲染。
- 导出 = 发布快照（glTF 源 + 场景文档）+ 静态封面（SVG/PNG，供票 07 无障碍替代与缩略）。
- 只承诺**资产级 round-trip**；产品扩展编排语义不做完整 round-trip 承诺（诚实记录）[票 10]。

### 4.8 安全限制（票 10 + 票 03）

- 零脚本纯数据。
- URL 引用白名单：仅 MediaAsset blob 与外链视频白名单（YouTube/Vimeo 官方播放域）。
- 字体白名单（web-safe）。
- SVG 导入用**无实体展开**解析器（XXE 防御）。
- 资源数量上限：节点/三角面/纹理像素/动画时长，复用票 03 GLB 门禁阈值思路，v1 配置化。
- 校验失败/超限 → 拒绝加载 + 降级提示，不静默截断。
- 上传媒体走票 03 门禁：类型白名单、三方比对、ClamAV 扫描 fail-closed、真实解析、隔离执行 [票 03、调研 §5]。

### 4.9 与旧 Visualization 的关系

旧 `Question.visualization` 三 kind（`ball_stick` / `curve` / `primitives`）按票 05 盘点走适配器映射到文档 `geometry3D` 图元；迁移期只读兼容、不长期双轨（拆票给 14）[票 05、10、14]。

---

## 5. API 契约（票 14 定形）

挂载方式：单体 `server/index.ts` 统一鉴权中间件后的模块路由器（沿用 `handleQuestionBankApi` 等 7 个 `handle*Api` 挂载模式，返回 true 即消费请求）[仓库事实、票 14]。模块目录 `server/demonstration/`；媒体路由在 `server/media/` 扩展。

> 端点路径、方法、鉴权、关键载荷形状齐全；完整 OpenAPI 由实施补充，此处不写。

### 5.1 创作 / 草稿 / 提交 / 撤回（作者，教师角色）

| 端点 | 方法 | 鉴权 | 说明 |
|---|---|---|---|
| `/api/demonstrations` | POST | teacher | 创建作品根（含初始元数据），返回作品 ID；派生入口带 `sourceWorkId/sourceVersionId`（票 08） |
| `/api/demonstrations/:id/draft` | GET | owner | 读取草稿 SceneDocument + 检查点列表 |
| `/api/demonstrations/:id/draft` | PUT | owner | 整篇保存草稿 SceneDocument（zod 硬校验，硬失败拒存）；AI 检查点写 `checkpoint_json`（票 09） |
| `/api/demonstrations/:id/submit` | POST | owner | 冻结不可变版本快照（status=submitted）；前置：所有媒体 `ready`、AI 披露必填、许可必填；同作品已有待审版本则拒绝 |
| `/api/demonstrations/:id/withdraw` | POST | owner | 撤回自己的待审版本（submitted → withdrawn） |
| `/api/demonstrations/:id` | DELETE | owner | 软删作品身份；引用保护的版本与 blob 保留（票 02） |
| `/api/demonstrations/:id/takedown` | POST | owner | 作者主动下架已发布作品；公共固定引用继续播放（票 04） |

### 5.2 审核（PublicLibraryReviewer，标志列鉴权）

| 端点 | 方法 | 鉴权 | 说明 |
|---|---|---|---|
| `/api/reviewer/queue` | GET | reviewer | 待审版本队列（`submitted` 状态 + 举报待处理） |
| `/api/reviewer/versions/:id/approve` | POST | reviewer | 批准 → approved（成为当前发布版本）；只改状态不改内容 |
| `/api/reviewer/versions/:id/reject` | POST | reviewer | 驳回（附 `reason`）→ rejected；草稿可修改重提 |
| `/api/reviewer/versions/:id` | GET | reviewer | **证据面板**：可播放预览、素材清单（blob hash/类型/尺寸/处理状态）、外链健康、来源链、版权/许可/AI 披露、举报与历史审核记录；永不暴露学生/成绩/教学私有数据（票 04） |
| `/api/reviewer/publications/:id/takedown` | POST | reviewer | 审核员下架（侵权/违规裁定后强制处置，通知引用者限期替换，票 08） |
| `/api/reviewer/appeals/:id` | POST | reviewer | 处理作者申诉 |

### 5.3 举报与通知

| 端点 | 方法 | 鉴权 | 说明 |
|---|---|---|---|
| `/api/publications/:id/reports` | POST | 任意登录用户 | 举报进入审核员队列（票 04） |
| 站内通知 | — | — | 「有新版本」「源不可用」「强制处置限期替换」通知：复用 T14 站内消息通道或公共库通知中心（票 08；通道选择 [待实施期确认]） |

### 5.4 公共库检索（票 11 + 票 14）

`GET /api/library?q=&subject=&level=&kp=&format=&space=&behavior=&license=&sort=`（登录用户可访问；公开内容可匿名读 [待实施期确认]）

- 检索 = 字段加权（标题/说明/学科/学段/知识点/分类/作者/许可/来源/健康状态）+ 全文；筛选走 facet（学科/学段/格式/空间/行为/许可）。
- 排序 = 结构化相关性优先 + 质量信号（被引用次数、审核状态、健康状态）；播放/收藏热度只作辅助展示不参与默认排序。
- 返回：演示卡片（标题/说明/作者/许可/多维分类/封面/固定版本号/健康状态/来源徽标/被引用数）。
- 预览按需（点击后加载，不自动拉外链）[票 11、13]。

### 5.5 媒体（票 03 + 票 14）

| 端点 | 方法 | 鉴权 | 说明 |
|---|---|---|---|
| `/api/media/upload-sessions` | POST | teacher | 创建上传会话：校验 intended kind / declared size，**事务内预留配额**，返回 tus upload URL；`Tus-Max-Size` + 24h `Upload-Expires` |
| tus PATCH（upload URL） | PATCH | 会话 | 分片续传；每 PATCH 校验声明长度/实际读取长度/owner/会话状态/剩余配额；支持 tus checksum 扩展 |
| tus HEAD | HEAD | 会话 | 恢复断点（`Upload-Offset`） |
| `/api/media/blobs/:hash` | GET | 授权 | 流式返回：206/416 Range、`Accept-Ranges`、正确 `Content-Type`/`Content-Length`/`ETag`（内容 hash）/`X-Content-Type-Options: nosniff`；私有内容 `Cache-Control: private, no-store`，公开 hash URL 派生物 `public, max-age=31536000, immutable`（票 03、调研 §6.1） |
| `/api/media/upload-sessions/:id` | DELETE | owner | 取消会话：释放配额、清理临时文件 |
| 音视频上传 | POST | teacher | **未配置 `MEDIA_FFMPEG_PATH` 前 capability-disabled**：创建 session 前返回禁用，不接受原件后卡 processing（票 03、15） |

上传完成语义（服务端）：收满 → `quarantined` 入队 → worker 流式重算完整 SHA-256、三方比对、ClamAV（不可用 fail-closed 保持 quarantine）、真实解析（Sharp/ffprobe/Khronos Validator 子进程隔离 + 资源上限）、产派生物 → SQLite 事务内提交 blob/资产/派生物并释放配额预留 [票 03、调研 §4.1/§5]。

### 5.6 引用管理（票 08、12、14）

| 端点 | 方法 | 鉴权 | 说明 |
|---|---|---|---|
| `/api/questions/:id/demonstration-references` | PUT | 题目作者 | 全量写引用列表（questionId + demoVersionId + role + order）；服务层校验：目标版本存在且 `approved`、primary ≤1、补充 ≤8、私有题可绑公共发布版本或本人私有版本 [票 12] |
| `/api/kps/:id/demonstration-references` | PUT | 教师 | 知识点侧同构（1 主 + 8 补充有序） |
| `/api/references/:id` | GET | 登录 | 引用详情：固定版本、上游最新版本、徽标状态（`up_to_date | new_version_available | source_unavailable`）[票 08、12] |
| `/api/references/:id/upgrade` | POST | 引用者（教师） | 手动确认升级引用到新版本（**绝不自动漂移**）；强制审计事件 |
| `/api/questions/:id/demonstration-references` | DELETE | 题目作者 | 移除引用（二次确认在 UI 层，票 13）；明示仅解除引用不删公共库作品 |

引用读取链：`question/kp → reference → version` 单向只读；评分路径零读取由架构测试守护 [票 12、14]。

### 5.7 鉴权与审计汇总（票 14）

- 统一鉴权中间件（现有 session 体系，T02）；角色 + `public_library_reviewer` 标志列。
- 强制审计事件：发布提交、撤回、批准、驳回、下架、举报、引用升级（现有 audit HMAC 链 + `actorRole`）。
- 播放器相关端点只读：`GET /api/demonstrations/:id/versions/:versionId/player`（发布快照播放载荷）[端点形态 [待实施期确认]，语义已定：只读不可变快照、不含草稿]。

---

## 6. 播放器契约（票 07 全量）

`DemonstrationPlayer / 演示播放器` 是教学演示的**唯一只读消费端**：只解释不可变版本快照（票 02），不解析草稿、不执行任何可执行代码、不接触评分路径。

### 6.1 解释模型（三路内容，同一播放器）

1. 静态 2D/3D 场景：2D = SVG 渲染；3D = PlayCanvas 引擎运行时（与创作端同栈，票 16）；glTF 2.0 白名单导入件按发布快照播放。
2. 时间线动画：只执行**确定性补间/关键帧**（PlayCanvas 动画系统，票 16 边界）；播放器不做逻辑求值。
3. 视频编排：封面/章节/播放区间 + `ExternalVideoRef`（票 03 YouTube/Vimeo 官方 embed 白名单、点击后加载；不重编码、不生成 HLS）；章节可混排场景段与视频段。

可播放内容一律来自不可变版本快照；静默漂移在播放端零实现成本（票 08）。

### 6.2 作者开放互动（声明式白名单，四种）

- 相机旋转/缩放（orbit）
- 视角切换（预设视点）
- 步骤显隐（节点按 step 显隐）
- 对象点击高亮（pick + 高亮/标签）

以场景文档声明式节点表达，播放器统一解释；**不开放任意脚本、插件或运行时求值代码**（票 09 一致，脚本沙箱未定）。题型/知识点不因引用演示获得新交互语义（票 12）。

### 6.3 确定性

- 场景文档全部内容确定性求值：固定相机/灯光/材质参数，无随机种子、无环境依赖（仅能力探测降级可改变渲染等级）。
- 同一版本快照跨端渲染同一结果；视口自适应只是投影/布局变化、不改场景语义。
- glTF 不支持扩展明确拒绝或显式降级并提示，绝不静默错渲染（票 16）。
- 确定性由纯函数测试守护（沿用 `*Projection.ts` 纯函数范式，ADR-0013）。

### 6.4 沙箱隔离

- 不执行场景文档代码（无 eval/Function/动态 import/任意 URL fetch）。
- 资源加载只走票 03 门禁产物（hash 不可变 blob、MIME 白名单、ClamAV fail-closed）与 CSP（iframe `sandbox` + `frame-src` 仅官方播放域）。
- 渲染局限于 WebGL canvas / SVG 子树。
- **播放器不接收、不透传学生提交内容**（与旧 `CubeSectionScene(submission)` 模式切割——新播放器与提交零耦合）；媒体只读不可变 blob。

### 6.5 资源预算

- v1 配置化上限复用票 03 GLB 门禁思路：节点数、三角面数、纹理像素、动画时长、单章素材清单字节数。
- 超预算资产拒绝加载并显示降级提示、不静默截断（票 16 显式降级立场）。
- 预算在发布前由审核证据面板可见（素材清单，票 04）；播放端为第二道强制。

### 6.6 懒加载

- 首屏只加载入口场景与必需资源；章节/视频/3D 模型按需懒加载（章节跳转才拉该章资源；外链 iframe 点击后才加载，票 03）。
- 播放器入口轻量，3D 引擎 chunk 按需加载（沿用 ADR-0013 React.lazy 思路，引擎换 PlayCanvas）。

### 6.7 播放控制（统一控件，键盘可达）

播放/暂停、时间轴跳转、章节跳转、全屏，全端同一套控件；播放控制必须键盘可达（Tab 顺序 + Enter/Space）；`visibilitychange` 时停止动画循环并释放后台渲染，恢复时确定性续播；暂停不丢状态。

### 6.8 全屏

原生 Fullscreen API；全屏沿用同一场景文档、同一确定性求值；全屏入口键盘可达；退出恢复内嵌视口，播放位置/交互状态不丢失。

### 6.9 低性能降级（分级）

- 能力探测（WebGL 可用性/版本、内存、设备类别）决定渲染等级：**完整 3D → 简化渲染（降纹理/LOD/关阴影）→ 静态替代物（封面/首帧）**；降级有提示、不静默。
- `prefers-reduced-motion` 时动画静态化。
- 降级是播放器侧自适应，不改场景文档、不改变语义。

### 6.10 无障碍替代

- 版本可携带 alt 文本/静态封面/视频章节字幕（WebVTT，票 03）。
- 播放器提供文字替代视图（字幕文本/步骤文本）。
- WCAG AA 对比度、颜色不单独表意。
- 点击高亮等互动提供非指针替代（Tab 到达 + Enter/Space 激活）。
- 静态替代物与文字替代合并为同一降级路径，不重复实现。

### 6.11 跨端一致性

- 桌面/平板/手机渲染同一份场景文档，视口自适应不改语义。
- 移动端触摸映射（单指旋转/双指缩放），键盘端方向键旋转（启用时）。
- 手机端播放器内嵌不遮挡作答（票 13 原型验证，不做卡片嵌套）。

### 6.12 评分链隔离（铁律）

- 播放器零耦合评分路径：不产生、不接收、不透传 evidence / score / Attempt / MasteryProfile。
- 播放行为（观看时长、交互次数）至多作为匿名展示统计，不进证据链、不改变任何分（地图 #11 + ADR-0001/0013/0015 同立场）。
- **明确不做 0010 式 `render_artifact`**——播放是媒体体验，非学生提交的评分相关画面。
- 播放器不接收 submission；题型引用演示为纯展示语义（票 12）；`QuestionType`/Runner/Rubric/Evidence 不变。

### 6.13 与旧 Visualizer 的关系（衔接票 14）

- 新播放器替代现有 `Visualizer` registry（r3f/canvas2d，ADR-0013/0015）。
- 迁移期旧 3 种 Visualization kind + 内置场景按票 05 兼容分类走「适配器 / 只读兼容」；播放器 v1 可同时接受「场景文档」与「旧 Visualization 映射场景文档」两种输入。
- 目标模型不长期双轨（地图 #10）。

### 6.14 YAGNI（延后/不做，票 07）

任意脚本与插件沙箱（未定）；多轨编辑/HLS/转码（票 03）；播放行为进证据链与 render_artifact；自动字幕/转写（票 03 延后）；高精度粒子/IK/custom shader（票 16 拒绝或降级）；服务端渲染预览（票 03 用作者封面）；跨端播放进度续播。

---

## 7. 渐进迁移（票 05 盘点 + 票 14 架构）

### 7.1 旧能力盘点事实（票 05，仓库已核对）

**数据契约**（`shared/contracts.ts`）：`Visualization` 判别联合三 kind（纯数据 JSON）——
- `ball_stick`：atoms（id 唯一、element 1–2 字母、position 三元有限，1–200）+ bonds（端点存在）+ 可选 label。
- `curve`：points 2–2000 预采样三元有限 + 可选 secondaryPoints（DNA 双链）+ crossBars ≤500 + label。
- `primitives`：nodes ≤100（id/position/role）+ edges ≤200（端点存在）+ label。

**校验与生成**：`visualizationSchema.ts`（zod 信任边界，superRefine hardGeometryIssues，z.union 非 discriminatedUnion）；`geometrySanity.ts`（MIN_BOND 0.15 / MAX_BOND 4.5 / COORD_BOUND 50，hard 阻止保存/soft 仅警告）；`generateVisualization`（LLM_API_KEY 未配置返回 no-llm 不抛异常，temperature 0.3、maxTokens 4000）。

**存储与迁移**：`questions.visualization_json TEXT`（migration 0007 + `ensureQuestionVisualizationColumn` backfill）；QuestionStore 读时容错（非法 JSON 静默丢弃）；`QuestionBankService.adoptVisualization`（确认入库、null 清除、不碰 scores/evidence）；`questionValidation.ts:361` draft 校验。

**API**：`POST /api/questions/:id/preview-visualization`（LLM 提议，不持久化）；`POST /api/questions/:id/adopt-visualization`（确认入库）；`POST /api/student/preview-visualization`（学生只预览，永不保存）；Assignment GET 投影（`server/index.ts:616` 条件带出；`projectQuestionAssignment.ts:60-105` `resolveVisualizationForAssignmentId` 优先 `seed:<id>` 再 `id`）。

**Visualizer registry**（`src/components/visualizer/`）：`SceneKind = 'r3f' | 'canvas2d'`；7 个内置场景（4 r3f：chem-vsepr-methane/water、cube-section、chem-crystal-nacl/diamond；2 canvas2d：physics-projectile-xy/y）；`Visualizer.tsx` 分发优先级：assignment.visualization → registry 按 assignment.id → null 不渲染；R3F 场景 React.lazy（~600KB 出首包）。

**Demo seed**（`demoVisualizations.ts`）：3 个（physics-magnetic-helix→curve、bio-dna-double-helix→curve+secondaryPoints+crossBars、numeric-ohm-law→primitives）；`ensureDemoVisualizations` 幂等、不覆盖教师数据。

**数据面**：23 个内置 assignments 顶层 id，其中 **7 个注册了可视化场景**（4 r3f + 2 canvas2d + 3 seed viz，cube-section 重叠）。

**测试**：6 个（questionVisualization 端点流、visualizationSchema、demoVisualizations、geometrySanity、projectQuestionAssignment、assignmentVisualizationPassthrough，共 ~868 行）。

**未提交改动**：10 个前端文件 + styles.css 的展示层 CSS 现代化（`.viz-scene*` class），无几何/行为/契约变更；UI 重构下可能作废（低风险）。

### 7.2 兼容性分类（票 05，供迁移工具与适配器使用）

| 分类 | 清单 | 迁移方式 |
|---|---|---|
| **可无损转换**（纯数据 → 场景文档初始快照） | 3 种 teacher-authored Visualization kind、3 个 demo seed、MoleculeGeometry 常量（分子/晶体） | 原样映射，无需解析器 |
| **需要适配器** | registry 的 assignment.id 硬编码路由 → 场景文档引用；`seed:<id>` 投影（`resolveVisualizationForAssignmentId`）；`Assignment.visualization` passthrough（contracts.ts:528 + index.ts:616）；canvas2d ProjectileScene 特殊路径 | 「新引用表优先、旧字段回退」只读分支 |
| **只能暂时兼容** | `questions.visualization_json` 列 + 读时容错；`StudentVizPreview` 学生侧生成入口（去留裁决）；LLM 生成链路（归属票 09）；未提交 CSS 改动 | Phase E 双读；Phase C 裁决/删除 |

### 7.3 Phase E（expand，双读）[票 14]

- 新表 + 新 API 与旧模型并行；旧 `Question.visualization`、registry、adopt/preview 端点**全功能保留**。
- 无损转换项由迁移工具映射为 SceneDocument 初始快照（票 10 格式），**一次迁移 + CI 双读校验**（旧 JSON 与新 SceneDocument 结果一致）。
- 适配器项加「新引用表优先、旧字段回退」分支，只读。
- 23 个内置 assignments 中 7 个含场景的全部迁为预置 demonstrations（`SEED_AUTHOR_ID` 归属沿用）；E2E 回归保证可播。

### 7.4 Phase C（contract，写路径切换）[票 14]

- `adoptVisualization` → 写新引用 + 演示（写路径切换）。
- `preview-visualization` 路由到新 drafts。
- 学生侧 `StudentVizPreview` 按票 07 播放器契约**裁决去留**（教师独占创作则移除；裁决点 [待实施期确认]）。
- 引擎迁移（票 16 PlayCanvas）：R3F/canvas2d registry 场景走迁移期只读适配器；新播放器接管后按 glTF 白名单导入/降级路径迁入。
- `questions.visualization_json` 在双读稳定后**删除列**（删除时点：Phase C 双读稳定后，实施期按运行数据确认 [待实施期确认]）。

### 7.5 回滚与用户改动保护 [票 14]

- `schema_migrations` 逐文件回滚。
- 双写期间新表故障 → 旧路径照常，不阻塞评分与做题；每阶段独立提交。
- 草稿独立于版本（票 02）：迁移期间用户编辑不受影响、**不覆盖用户改动**（`ensureDemoVisualizations` 幂等模式：仅当缺失才写入）。

### 7.6 测试护栏（并入 §9 验收门）[票 14]

- 架构测试：评分路径零读演示表、播放器零写（现有 `tests/architecture.test.ts` 模式）。
- 迁移测试：legacy 读兼容、双写一致性、快照冻结不可变。
- 端点测试：上传状态机/配额释放/孤儿清理、审核流状态机、引用固定不漂移 + 升级确认。
- E2E：现 16 条 demo loops 回归全绿 + 新增「检索→派生→创作→提交→审核→引用→学生播放」闭环。

---

## 8. 原型验证要求（票 06 + 票 13，均已走查完毕进入规格）

> 两票原型方案、评议方式与已定结论如下；实施拆票不再要求重做原型，但票 15 的**交互门 contingent on 票 13 走查**（§9.4）。

### 8.1 票 06：教师专业创作工作台原型

**交互模型（三区布局，已定）**：
- 左：对象树 + 资源面板（MediaAsset 库 / glTF 导入件）。
- 中：画布/视口（2D/3D 场景切换，PlayCanvas 运行时）。
- 右：属性检查器 + 动画时间线（补间/关键帧）+ AI 起稿抽屉（票 09 边界）。
- 顶栏：公共库检索/派生（票 11 筛选 + 票 08 来源链）、预览、版本保存、提交审核（票 04 流程）。

**教学可理解性**：预置模板场景 + 向导式「建场景 → 加对象 → 调动画 → 预览 → 提交」五步引导；AI 起稿一键落草稿（检查点快照，票 09）；专业能力（对象树/属性检查器/完整时间线）默认折叠、按需展开。

**原型介质与评议**：PlayCanvas 引擎 HTML 壳（直接起 PlayCanvas 工程 + 自定义 HTML 侧栏/顶栏面板，假数据或 mock API；1–2 天，与票 16 同栈）；3–5 名教师真实走查「检索 → 派生 → 场景 → 动画 → 预览 → 提交」全流程 + 结构化反馈（任务完成率、迷路点、专业功能可理解度、AI 起稿采纳率）；反馈回流票 07 与票 10。

### 8.2 票 13：发现与播放工作流原型

**已定交互形态（全部派生自已锁决策，不新增能力）**：

(a) 教师侧——题目编辑器与知识点管理各设「教学演示」抽屉区，共用同一检索组件（复用票 11 facet + 字段加权全文）。五步流：① 检索（facet + 关键词）；② 预览（点击卡片按需加载播放器预览，懒加载 + 资源预算校验，不自动拉外链，可试玩四种互动）；③ 引用（主/补充槽位；主槽唯一、替换二次确认；补充上限 8 超限禁用）；④ 排序（补充拖拽，触屏上移/下移兜底，主演示固定首位）；⑤ 移除（二次确认，明示「仅解除引用，不删除公共库作品」）。版本管理内嵌引用卡片：固定版本号；「有新版本」徽标 → 预览 → 手动「升级到 vX」（票 08）；「源不可用」置灰、保留播放、站内通知。取舍：**内嵌抽屉（选定）**；否决独立检索页与弹窗。

(b) 学生侧——触点矩阵：做题中仅渲染主演示（题干下方、作答区上方，静态封面 + 播放按钮，**不自动播放**）；解析页主演示 + 补充折叠列表；知识点页主演示默认展开；共同规则 = 学生主动点击才播放。播放收敛到唯一只读播放器；来源区分用最小徽标（公共库显示「作者 + 许可 + 版本」、教师自创「我的演示」）；**来源只影响展示信息、不影响能力**。取舍：封面 + 手动播放（选定）；否决自动播放。

(c) 桌面与移动端——桌面：页面流内嵌块，按场景纵横比定高（16:9 或场景比例），与作答区同屏不遮挡。移动：**流式布局独立区块**——不悬浮、不自动全屏遮罩、不卡片嵌套；全屏仅用户主动触发；视口懒加载、离开视口即卸载；移动端默认更低资源档；横竖屏只重排不重载；切题销毁实例释放内存、切后台仅暂停保留状态。

(d) 原型方案——复用票 06 壳的可点击 HTML 高保真（5 条闭环路径：教师题目编辑器引用闭环 / 教师知识点管理增删排序与版本徽标 / 学生做题-解析 / 学生知识点浏览 / 横切来源徽标+新版本+源不可用+移动端响应式）；数据：mock 检索 12 条左右演示卡片覆盖各 facet、1 个真实 PlayCanvas 示例场景（复用票 06）+ 2 个静态 SVG、四种互动各 1 个可玩实例；裁剪：不做真实检索后端、不做真 3D 资产、AI 生成器只留入口占位。评议：3–5 名教师每人 60–90 分钟（任务式走查 + 结构化访谈）；输出任务完成率 + 卡点分级 P0 阻断 / P1 建议 / P2 可选；总预算 2 天内。

**明确延后项（票 13）**：自动播放/播放进度记忆；知识点侧主/补充上限差异化（暂 1+8）；真实检索后端（规格已定，开发阶段实现）；移动真机走查、键盘快捷键全集、无障碍细节清单（走查后 P1/P2 排期）；旧 AI 可视化生成器迁移合并；来源展示策略细化。

---

## 9. v1 验收门（票 15 全量）

### 9.1 v1 交付能力（PlayCanvas 栈，票 16；创作端桌面浏览器，全端播放）

- **统一创作运行时**：2D 与 3D 共用 PlayCanvas 运行时与 SceneDocument，不引入 Fabric/第二渲染内核（若票 13 原型证明 PlayCanvas 2D 不达验收，备选 Fabric 作显式替换裁决，不开静默双轨）[票 15]。
- **3D 专业 DCC**：场景装配 + 基础几何/材质/灯光/相机 + 时间线（关键帧/参数化补间）+ **网格拓扑/UV/骨骼创建**（票 16 首版内含）；复杂粒子/IK/自定义 shader 走 glTF 2.0 白名单导入，不支持特性显式拒绝或静态降级，绝不静默错渲染。
- **动画**：PlayCanvas 动画系统（骨骼/形态键/补间产品内编辑）；AI 助手生成结构化对象 + 参数化补间，检查点草稿、教师逐项确认（票 09）。
- **视频编排**：封面/章节/播放区间；平台托管上传（tus）+ 外链（YouTube/Vimeo 官方 embed 白名单）；不剪辑。
- **公共库**：检索/筛选/详情、线性审核流、举报、下架、派生来源链、固定版本引用 + 升级通知（票 04/08/11/12）。
- **播放器**：三路内容（SVG/PlayCanvas 场景、确定性补间、视频编排）+ 4 种白名单互动，零脚本；确定性求值、资源预算、懒加载、分级降级（3D→简化→静态替代）、无障碍（alt/WebVTT/文字替代、键盘可达、WCAG AA 关键路径）、桌面/平板/手机同文档跨端一致（票 07）。
- **迁移**：23 内置 assignments 的 7 个可视化场景全数可播；旧字段读兼容至终删（票 14 Phase E/C）。

### 9.2 质量预算（v1 可测门，配置化阈值先落地后按运行数据调整）

**媒体上限**（票 03 §4.2）：
| 类型 | 单文件硬上限 | 解码后/时长上限 | v1 派生物 |
|---|---|---|---|
| JPEG/PNG/WebP | 25 MiB | 40 MP；最长边 16,384 px | 1600 px 展示图；480 px 缩略图 |
| 音频 | 250 MiB | 120 分钟；≤2 声道（播放版） | 1 个兼容播放版 |
| GLB | 200 MiB | 节点/三角面/纹理尺寸/总解码纹理像素分别设限 | 用户封面（自动 3D 缩略图延后） |
| 视频 | 2 GiB | 120 分钟；单视频流 + 主音轨进入播放版 | 1 个 MP4 播放版；1 张 poster |
| WebVTT | 2 MiB | 50,000 cues；UTF-8 | 规范化 caption blob |

**账户配额**（票 03 §4.2）：每教师 5 GiB 逻辑原始内容、同时 2 个上传、临时盘预留 ≤3 GiB、同时 1 个视频处理作业；**先预留后完成**。

**性能**：编辑器为教师路由专属异步 chunk，学生播放器不加载编辑器 UI/Studio；首屏与包体以**真实 PoC 实测**（gzip/Brotli、首屏、内存、WebGL context、移动帧率），不用 npm 解包体积判定；典型桌面场景 **≥60fps**、中档移动设备 **≥30fps**（能力协商降级路径兜底）。

**安全**：上传 fail-closed（ClamAV 不可用保持 quarantined）；三方比对 + 真实解析（Sharp/ffprobe/Khronos Validator 子进程隔离 + 资源上限）；拒绝 SVG/HTML/PDF/archive/任意 URL；XXE/URL/字体白名单、零脚本（票 10/03）；**ffmpeg 未获许可审查前托管音视频转码显式禁用（capability-disabled）**。

**审核**：待审版本不阻塞既有播放与引用；驳回附理由可修改重提；同一作品最多一个待审版本。

**浏览器矩阵**：桌面 Chrome/Edge 当前 + 前 1 版本、Firefox/Safari 当前；WebGL1 设备走降级或明确拒绝清单，不静默错渲染。

**评分链不变**：现有 evidence-first 铁律测试全绿；播放器零耦合评分路径由架构测试守护。

### 9.3 验收护栏（DoD）

1. `npm run check` 全绿（lint + 全量 vitest + tsc --noEmit + build）。
2. 票 14 §7.6 测试清单全绿（架构/迁移/端点/引用语义）。
3. E2E：16 条 demo loops 回归 + 新演示闭环用例全绿。
4. 性能 PoC 实测表落地（首屏/包体/帧率/内存），超预算即拒载并有降级提示。
5. 播放器验收护栏（票 07）：① 确定性回归——同版本快照跨端渲染一致；② 资源预算强制——超限拒绝+提示；③ 键盘可达——播放控制全 Tab 可达、focus-visible；④ 降级路径可触发——能力探测/静态替代物有测试；⑤ 架构守卫——播放器 import 图不含评分/证据/Attempt 模块。

### 9.4 Contingent on 票 13（交互门）

引用/发现交互（题目编辑器、知识点管理、学生作答/解析/知识点浏览时的呈现与互动）与播放器互动/降级细节的验收门，在**票 13 原型教师走查通过后冻结**；本规格先锁结构性与非交互门，不阻塞 14 拆票与开工 [票 15]。

---

## 10. 拆票建议（供 /to-tickets）

拆分维度：**按里程碑（Phase E 基础 → Phase C 切换）分组，模块内按领域切片**。编号沿用地图票号表达依赖。

### 10.1 建议拆票清单

| 拆票候选 | 内容摘要 | 依赖（票号） | 并行性 |
|---|---|---|---|
| T-A 数据层 | migration 0008+ 表族 + Drizzle schema + 审计事件接入 | 票 02/03/04/12/14 决策 | 与 T-B 可并行 |
| T-B 媒体管线 | `server/media/` 扩展：BlobStore/UploadStore/MediaProcessor 三接口、FsBlobStore、tus 端点、上传状态机、配额预留、Range 端点、ClamAV/Sharp/Khronos 门禁、ffmpeg capability-disabled | 票 03 + 调研 §3/§4/§5/§6 | 与 T-A 可并行；T-C 前置 |
| T-C SceneDocument 契约 | `sceneDocumentSchema` zod、section 定义、N-2 版本迁移函数、能力协商、导入导出（glTF/SVG 白名单）、安全限制 | 票 10 | 依赖 T-B（GLB 门禁复用）；T-D/E/F/G 前置 |
| T-D 领域服务 | `server/demonstration/`：作品/草稿/版本生命周期、提交冻结、审核状态机、删除回收、引用服务（增删排序校验）、通知触发 | 票 02/04/08/12 | 依赖 T-A、T-C |
| T-E 公共库检索 | `/api/library` 字段加权全文 + facet + 排序（相关性 + 被引用次数）、元数据校验（作者提案 + 审核员核对冻结） | 票 11 | 依赖 T-A、T-D |
| T-F 审核端点 | reviewer queue/approve/reject/证据面板/takedown/appeals、举报、强制审计 | 票 04/14 | 依赖 T-D、T-E |
| T-G 播放器 | StudentPlayer 只读运行时：三路内容、四种互动、确定性求值、预算、懒加载、降级分级、无障碍、跨端、评分链隔离架构守卫 | 票 07/10/16 | 依赖 T-C；与 T-H 可并行 |
| T-H 创作工作台 | TeacherStudio 前端（三区布局 + 五步向导 + AI 抽屉 + 时间线 + PlayCanvas 2D/3D 运行时接入）、异步 chunk 隔离 | 票 06/09/16 | 依赖 T-C；与 T-G 可并行 |
| T-I AI 创作助手 | 结构化生成（zod 输出）、检查点快照、逐项接受/回滚、配额预留、降级手动作业 | 票 09 | 依赖 T-C、T-D |
| T-J 引用 UI + 通知 | 教师抽屉（检索→预览→引用→排序→移除）、版本徽标/手动升级、源不可用置灰、站内通知接线 | 票 08/12/13 | 依赖 T-E、T-G |
| T-K Phase E 迁移 | 无损转换映射工具（3 kind + 3 seed + MoleculeGeometry → SceneDocument）+ CI 双读校验；7 个内置场景迁为预置 demonstrations；适配器只读分支 | 票 05/10/14 | 依赖 T-A、T-C |
| T-L Phase C 切换 | adoptVisualization 写路径切换、preview 路由到 drafts、StudentVizPreview 去留裁决、旧列删除、逐文件回滚 | 票 05/14 | 依赖 T-K + T-G/T-H 就绪 |
| T-M v1 验收 | 质量预算配置落地、性能 PoC 实测表、浏览器矩阵、E2E 新闭环、DoD 全绿 | 票 15 | 依赖 T-A..T-L；交互门 contingent on 票 13 走查（已完成，按结论冻结） |

### 10.2 顺序约束与并行组

- **可并行**：{T-A, T-B}（数据 + 媒体）；{T-G, T-H}（播放器 + 工作台，均依赖 T-C）；T-E 与 T-F 在 T-D 后可并行。
- **顺序链**：T-C 依赖 T-B（GLB 门禁）；T-D 依赖 T-A + T-C；T-E/T-F 依赖 T-D；T-J 依赖 T-E + T-G；T-K 依赖 T-A + T-C；T-L 依赖 T-K 且需 T-G/T-H 就绪；T-M 收尾全部。
- **里程碑**：M1 = {T-A, T-B, T-C}（地基：表、媒体、文档契约，可先跑通上传→blob→快照）；M2 = {T-D, T-E, T-F}（服务与治理闭环）；M3 = {T-G, T-H, T-I}（播放与创作前端）；M4 = {T-J, T-K, T-L}（引用闭环 + 迁移切换）；M5 = T-M（验收）。
- 标注：[待实施期确认] 项集中在 T-L（兼容窗口长度、StudentVizPreview 去留、旧列删除时点、通知通道选择），不阻塞 M1–M3。

---

## 11. 未覆盖 / 留待实施期的决策点

以下均非新决策，为实施期才可确认的次级项；实现者遇到时按此处标注处理，不自行发明答案：

1. **兼容窗口长度与旧列删除时点**：Phase E 双读持续时间、`questions.visualization_json` 删除时点、回滚粒度——票 14 规定在 Phase E/C 拆票实施时按运行数据确认 [票 14、地图 Not yet specified]。
2. **高级交互脚本/插件/沙箱能力**：场景运行时确认后才能明确——v1 明确延后 [票 07 YAGNI、地图]。
3. **无障碍创作辅助、低性能设备降级与静态替代物细节**：票 13 原型走查后按 P1/P2 排期；无障碍细节清单（键盘快捷键全集、真机走查）延后 [票 13、地图]。
4. **分发许可白名单具体集合**：版本级分发许可 v1 固定白名单（如 CC BY 系列），具体集合另定 [票 04、调研]。
5. **站内通知通道选择**：复用 T14 站内消息通道或公共库通知中心——二选一 [票 08]。
6. **FFmpeg 许可审查**：`MEDIA_FFMPEG_PATH` 配置与编解码器/专利审查，独立决策；获批前音视频转码 capability-disabled [票 03、15]。
7. **ClamAV 交付与 SLA**：随单部署交付方式、病毒库更新 SLA [票 03 延后项]。
8. **真实账户/组织配额、跨租户去重与删除保留期**：v1 用 §9.2 保守配额，生产按运行数据调整 [票 03 延后项]。
9. **GLB 精确阈值**（节点/三角面/纹理像素具体数值）：v1 配置化，先落地后调 [票 03、07、15]。
10. **学生侧生成入口去留**（`StudentVizPreview`）：Phase C 裁决，教师独占创作则移除 [票 05、14]。
11. **公开内容匿名可读性**：`/api/library` 与播放载荷对未登录用户是否开放——[待实施期确认]。
12. **源作品失效的强制处置替换期长度**：审核员强制处置后的限期替换窗口——[待实施期确认]。
13. **旧未提交 CSS 改动**（`.viz-scene*` 样式现代化）：UI 重构下可能作废，迁移时裁决保留/丢弃 [票 05]。

---

*规格完。决策追溯：全部内容可在 map.md + issues/01–16 与 docs/research/{browser-authoring-engine,media-video-pipeline}.md、CONTEXT.md 中找到原始依据。*
