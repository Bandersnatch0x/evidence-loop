# ADR 0003：Demo 级别合规方案

## 状态

已采纳（Demo/复赛阶段）

## 背景

当前系统**完全无审计日志**、**无访问控制**、**无 PII 检测**，存在合规风险。但复赛时间线（1 个月）是硬约束，无法在短时间内实现生产级合规。

合规研究警示：
- Mem0 文档："**retrievable by design**，敏感值要先加密/哈希"
- 当前 `EvaluationResult` 直接存储数据，无审计追踪
- 所有 API 端点完全公开，无身份验证

## 决策

采用 **"真审计日志 + 假多租户 + 基础 PII 检测"** 的混合方案：

### 1. 审计日志（真）
- **存储**：SQLite WAL 模式（非 JSON 文件）
- **完整性**：哈希链（`prevHash`）+ HMAC-SHA256 签名
- **性能**：异步批量写入队列（5 秒或 100 条 flush）
- **字段**：`{timestamp, actorRole, action, resourceType, resourceId, result, ...}`

### 2. 访问控制（假）
- **假多租户**：硬编码 3 个角色（学生/教师/管理员），前端 UI 切换器
- **显式警告**：响应头 `X-Security-Warning: Demo environment - no authentication`
- **真审计**：审计日志记录假角色操作（`actorRole: 'student'`）
- **接口抽象**：`SessionProvider` 接口，Demo 用 `MockSessionProvider`，生产替换为 `CasSessionProvider`

### 3. PII 检测（最小化）
- **范围**：仅检测 3 个字段（`summary`、`rejectionReason`、`evidence[].actual`）
- **方法**：基础正则（中文姓名、手机号、邮箱、学号）
- **策略**：检测到 PII **拒绝存储**（返回错误让学生清理）
- **关键发现**：当前 `EvaluationResult` 不存储学生代码，无需扫描完整代码

### 4. 生产化路径标记
在 `docs/COMPLIANCE.md` 显式标注：
```
⚠️ 本系统当前为 Demo 阶段，未实现完整的 PII 检测与数据分层存储。
真实学生数据处理前，必须实施以下措施：
- 数据分层存储（代码层 90 天 TTL，分数层 5-7 年保留）
- 被遗忘权 API（DELETE /api/evaluations/:id）
- Mem0 集成前的脱敏网关
```

## 后果

### 正面
- **时间线匹配**：3-5 工作日可完成（审计日志 2 天，访问控制 1 天，PII 检测 1-2 天）
- **真实审计证据**：虽然访问控制是假的，但审计日志是真的，可复现"谁在何时做了什么"
- **误用防范**：显式警告响应头 + 文档标注，避免 Demo 代码被误用到生产
- **迁移路径清晰**：`SessionProvider` 接口让后期真实身份验证迁移成本可控（3-4 工日）

### 代价
- **假安全性**：学生可直接伪造角色（通过修改 `X-Demo-Role` 头），但显式警告降低了误用风险
- **PII 检测绕过**：正则检测只能捕获"粗心"泄露，有意绕过（如 `zhang_san` 变体）几乎无法阻止
- **结构性风险**：代码结构本身即身份指纹（代码风格、错误模式、命名风格可用于重新识别），这是不可消除的固有风险

### 生产化前必需（当前未实施）
1. **数据分层存储**：
   - 代码层：单独表，90 天 TTL，学生可提前删除
   - 分数层：独立表，毕业后 5-7 年保留期，不可删除
   - 审计层：只追加，与分数同步保留

2. **被遗忘权 API**：
   - `DELETE /api/evaluations/:id`（学生删除自己的代码层）
   - `POST /api/rights/erasure-request`（完整 GDPR 流程）

3. **Mem0 集成前的脱敏网关**：
   - 仅发送"脱敏后的问题模式"，不是代码片段
   - DPA（数据处理协议）+ 隐私政策明确说明

## 被采纳的替代方案

**完整 RBAC + JWT**（生产级）：审计日志最完整，但复赛时间线内无法完成（5-7 工日），且对 Demo 阶段过度设计。

## 相关决策

- ADR 0001：证据优先评分（审计日志是证据可复现性的保障）
- ADR 0002：容器隔离选型（容器选型是合规强化的基础）
- docs/research/mem0-memory-architecture.md（Mem0 的"retrievable by design"警示）
