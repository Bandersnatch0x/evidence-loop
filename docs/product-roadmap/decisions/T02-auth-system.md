# [wayfinder:grilling] T02 认证与会话系统

## Question
真登录（账号密码/学号 + 真会话）替换假多租户。要定：
- 登录方式（学号+密码？老师邮箱？）、会话机制（cookie/JWT，守之前 ADR）、密码存储（哈希方案）
- 老师注册/开通流程（两层无管理员，老师如何自助建账号）
- 学生账号由老师导入分配后如何首次登录（初始密码/激活码？）
- 与现有 SessionProvider/MockSessionProvider 的迁移路径（保留 demo 切换作为演示后门？）

**Blocked by**: T01（账号挂在 User/组织模型上）

---

## 状态：已关闭

## Resolution（裁决）

**登录方式**：
- 老师：**邮箱 + 密码**，自助注册（两层无管理员，老师即最高自助单位）
- 学生：**学号 + 密码**，账号由老师导入名单时批量生成，不能自助注册（学号唯一性由老师所在教学单元命名空间保证）

**会话机制**：**HttpOnly Cookie + 服务端会话**（不用 JWT）。理由：单体 Node 服务、SQLite 会话表即可、避免 JWT 吊销难题、守 ADR-0003 的服务端可控原则。会话表进 SQLite（复用 T01 的库），`sessionId → userId + role + expiresAt`。

**密码存储**：**bcrypt/argon2id**（Node 原生 `crypto.scrypt` 亦可，零依赖）。绝不明文/可逆。学生初始密码 = 系统生成的**激活码**，首次登录强制改密。

**老师注册/开通**：老师自助注册（邮箱验证在 Demo 级可跳过，标记 boundary），注册即获得建班/建教学单元/导入学生的权限。

**学生首次登录**：老师导入名单 → 系统按学号批量建账号 + 生成一次性**激活码**（老师线下发给学生）→ 学生用「学号 + 激活码」首登 → 强制设密码 → 激活码失效。

**SessionProvider 迁移路径（expand-contract）**：
- `SessionProvider` 接口不变（现有抽象正确）
- 新增 `AuthSessionProvider implements SessionProvider`：从 Cookie 解析真实会话
- 保留 `MockSessionProvider` 作为**演示后门**，但用环境变量 `AUTH_MODE=mock|real` 切换，生产/真实模式禁用 mock（守 T01 铁律：判别字段思路复用——mock 会话在审计里标 `actorSource:'demo'`，可追溯可过滤）
- `X-Demo-Role` 头仅在 `AUTH_MODE=mock` 下生效

**守铁律/合规**：登录/会话/密码全程本地（SQLite），不出境（对齐 T10）。审计已有 `actorRole/actorId`，认证接入后 `actorId` 从真实会话来而非头部伪造。

**graduate 的 fog**：邮箱验证服务（Demo 跳过，生产必需）→ 加入 Not yet specified。
