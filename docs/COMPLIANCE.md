# 安全、隐私与合规

## 数据范围

- 当前 Demo 仅使用本地匿名样例与本地评估历史。
- 不连接真实学籍、成绩、身份认证或 LMS。
- `.data/` 目录被 `.gitignore` 忽略，不进入仓库。

## Demo 合规能力（ADR-0003）

⚠️ 本系统当前为 Demo 阶段，未实现完整的 PII 检测与数据分层存储。
真实学生数据处理前，必须实施数据分层、被遗忘权 API，以及 Mem0 集成前的脱敏网关。

- **真审计日志**：SQLite WAL（`.data/audit.sqlite`）+ 哈希链 + HMAC-SHA256（`AUDIT_HMAC_SECRET`），异步批量写入；评估与权限检查会写入审计记录。查询：`GET /api/audit?studentId=&from=&to=`（教师/管理员）。
- **假多租户**：`X-Demo-Role: student|teacher|admin` + 前端角色切换器；`SessionProvider` 接口便于替换为真实 CAS/JWT。
- **显式警告**：所有 API 响应包含 `X-Security-Warning: Demo environment - no authentication`。
- **权限过滤**：`/api/cohort` 仅教师/管理员；`/api/evaluations` 按角色过滤（学生仅看自己）。
- **✅ 记忆层硬事实（掌握度 + 复习调度）已隔离于评分闭环**：`server/mastery/*` 与 `server/review/*` 不得 import `server/memory/*`、`mem0ai`、`@xenova/transformers` 或 `ollama`；`computeMastery()` 保持纯函数 `(evidences: Evidence[]) => number`。架构守护测试（`tests/architecture.test.ts`）在 CI 中硬性拦截违规，失败消息指向 ADR-0006 双聚合根隔离红线。
- **✅ Phase 1 多模态合规**：核心评分闭环（`server/domain/EvaluationAgent.ts`、`server/mastery/*`、`server/review/*`）不得 import `server/multimodal/*` 或 `server/stt/*`；`MULTIMODAL_ENABLED=false` 时全站现有 API 行为不变，`/api/multimodal/*` 返回 503 + `X-Feature-Disabled: multimodal`，前端不加载 `<VoiceCompanion>` 与 `<OverlayLayer>`。架构守护 + Feature Flag 冒烟测试（`tests/architecture.test.ts`、`tests/multimodal-flag-smoke.test.ts`）守护 ADR-0005 红线。
- **✅ 模态级数据治理（ADR-0005 §7 / 工单 021）**：
  - 审计事件含 `modality: 'text' | 'voice'`（`canvas` 留 Phase 2）；语音会话只记 `durationMs` / `transcriptChars` / `piiHitCount`，**不记转写原文**。
  - `POST /api/multimodal/ask` 成功响应带 `X-Modality-Mode: voice`；后端不写原始音频到磁盘。
  - 前端对话历史走 IndexedDB，每条带 `expiresAt`（24h TTL），启动与 `beforeunload` 时 purge。
  - 教师 `GET /api/cohort/multimodal-usage?classId=` 仅返回 `{ studentId, voiceCount, lastVoiceAt }`；学生 403。

## 评分与模型边界

- 分数只来自测试/静态证据与确定性量规。
- 模型（如配置）只生成受证据约束的反馈文案。
- 模型不得改分、不得捏造未产生的证据。
- 教师视图只给干预建议，不自动写入正式成绩。

## 运行安全

- 默认本地 Python 子进程带超时、输出上限与基础静态约束，但**没有内核级网络或资源隔离**，不得直接暴露给不可信公网流量。
- 显式设置 `PYTHON_RUNNER=docker` 后，提交在预热容器池中执行。池容器使用 `--network=none`、内存/CPU/PID 限制、只读根文件系统、受限 tmpfs、非 root 用户、`no-new-privileges` 与 capability 全量丢弃。
- Docker 模式启动时必须成功预热；Docker CLI、daemon 或镜像不可用会阻止服务启动，不会静默降级到子进程。
- 单元测试验证安全参数、池复用、排队和异常容器回收；Docker daemon 与镜像可用时，集成测试会在真实容器内探测外连并验证失败。
- 请求体有大小限制；畸形 JSON 返回 400，超大请求返回 413。
- 生产静态资源服务使用路径边界检查，降低目录穿越风险。

## Docker 模式剩余边界

- 容器隔离不等同于微虚拟机或独立宿主隔离；Docker daemon 本身仍是高权限基础设施。
- 当前没有租户身份认证、提交级审计、镜像签名/漏洞门禁或跨实例资源配额。
- `--network=none` 隔离外部网络和宿主网络，但容器自己的 loopback 仍存在；文档和验收不把它表述为“无任何网络接口”。
- 公开生产部署前仍需完成身份认证、授权、审计、镜像治理、daemon 隔离和数据存储迁移。

## 开源与第三方依赖

- 项目代码采用 Apache-2.0。
- 可使用商业模型 API，但必须在材料中披露。
- 未配置 `LLM_API_KEY` 时完全离线可运行。

## 教育场景合规提示

- 当前不处理未成年人真实身份数据。
- 正式上线前需完成：机构授权、隐私政策、数据最小化、访问控制与审计日志。
- 任何成绩相关动作必须保留人工确认链路。

## 当前合规状态（Demo 阶段）

⚠️ 本系统当前为 Demo 阶段，未实现完整的 PII 检测与数据分层存储。
真实学生数据处理前，必须完成下文"生产化前必需"章节列出的措施。

下表汇总各项合规能力的当前状态。所有标注 ✅ 的能力均有对应实现代码与测试守护（见"实现一致性核对"）。

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 容器隔离 | ✅ 已实施 | `PYTHON_RUNNER=docker` 时提交在预热容器池执行，`--network=none` 阻断外连，配合内存/CPU/PID 限制、只读根、`cap-drop=ALL`、`no-new-privileges`、非 root 用户。 |
| 审计日志 | ✅ 已实施 | SQLite（`.data/audit.sqlite`）+ 哈希链（`prevHash`）+ HMAC-SHA256 签名，异步批量写入；篡改可通过 `verifyIntegrity()` 检测。 |
| PII 检测 | ✅ 已实施（Demo 级） | 入库前扫描 `summary`、`rejectionReason`、`evidence[].actual` 三个自由文本字段（中文姓名、手机号、邮箱、学号），命中即拒绝存储（返回 422）。 |
| 访问控制 | ✅ 已实施（假多租户） | `X-Demo-Role` 头 + `MockSessionProvider` 提供学生/教师/管理员三角色；所有响应带 `X-Security-Warning` 显式警告头；`/api/cohort`、`/api/audit` 仅教师/管理员，学生仅能访问自己的记录。 |
| 记忆层硬事实隔离 | ✅ 已实施 | 掌握度 + 复习调度（`server/mastery/*`、`server/review/*`）隔离于评分闭环，不得 import 记忆/向量/LLM 依赖；架构守护测试硬性拦截（ADR-0006）。 |
| 数据分层存储 | ⚠️ 未实施 | 代码层与分数层尚未分表，无差异化 TTL 与保留期。见"生产化前必需"。 |
| 被遗忘权 | ⚠️ 未实施 | 尚无 `DELETE /api/evaluations/:id` 与擦除请求流程。见"生产化前必需"。 |

## 生产化前必需

下列措施在当前 Demo 阶段**未实施**，处理真实学生数据前必须完成：

1. **数据分层存储**
   - 代码层：单独表，90 天 TTL，学生可提前删除。
   - 分数层：独立表，毕业后 5–7 年保留期，不可由学生删除。
   - 审计层：只追加，与分数同步保留。
2. **被遗忘权 API**
   - `DELETE /api/evaluations/:id`：学生删除自己的代码层记录。
   - `POST /api/rights/erasure-request`：完整 GDPR 擦除请求流程与人工审批链路。
3. **Mem0 集成前的脱敏网关**
   - 仅向外部记忆服务发送"脱敏后的问题模式"，绝不发送原始代码片段或自由文本。
   - 配套 DPA（数据处理协议）与隐私政策明确说明数据流向与保留策略。

## 实现一致性核对

以下核对确认上表中每个 ✅ 项都有对应的实现代码与测试守护：

- **容器隔离** → `server/runner/DockerPythonRunner.ts`（`buildDockerRunArgs` 生成 `--network=none` 等硬化参数、`verifyNetworkIsolation()` 外连探测）；测试 `tests/dockerPythonRunner.test.ts`、`tests/integration.test.ts`。
- **审计日志** → `server/audit/AuditStore.ts`（哈希链 + HMAC + `verifyIntegrity()`/`tamperForTest()`）；测试 `tests/auditStore.test.ts`、`tests/integration.test.ts`。
- **PII 检测** → `server/pii/PIIDetector.ts`（`detectEvaluationPII`），入库拦截见 `server/index.ts` `POST /api/evaluations`；测试 `tests/piiDetector.test.ts`、`tests/integration.test.ts`。
- **访问控制** → `server/auth/MockSessionProvider.ts` + `server/index.ts`（角色过滤、`X-Security-Warning` 头）；测试 `tests/accessControl.test.ts`、`tests/integration.test.ts`。
- **记忆层硬事实隔离** → `server/mastery/*`、`server/review/*` 与架构守护 `tests/architecture.test.ts`（ADR-0006 双聚合根隔离红线）。
