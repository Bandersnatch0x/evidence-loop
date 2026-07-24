# T02 认证与会话系统 — 实现报告

## 完成内容

1. **密码与凭证**
   - `server/auth/password.ts`：`node:crypto` scrypt 哈希（`scrypt$N$r$p$salt$key`），零新 native 依赖
   - 学生一次性激活码生成 + 哈希校验

2. **挂在 T01 User 模型**
   - `users` 表复用（loginId = 老师邮箱 / 学生学号）
   - Migration `0003_auth.sql`：`auth_credentials` + `auth_sessions`
   - `AuthStore` 幂等 `ensureAuthSchema`（与 openMemoryDatabase 迁移路径一致）

3. **会话机制（裁决：服务端会话，非裸 JWT）**
   - HttpOnly cookie `el_sid` → SQLite `auth_sessions` 行（可吊销）
   - `RealSessionProvider`（别名 `AuthSessionProvider`）实现 `SessionProvider`
   - `MockSessionProvider` 保留为演示后门，`actorSource: 'demo'`

4. **模式开关**
   - `AUTH_MODE=mock|real`（默认 mock，现有 demo/测试不破）
   - `DEMO_AUTH=true` 强制 mock（任务级开关）
   - `createSessionProvider()` 工厂供主装配接线

5. **业务用例 `AuthService`**
   - 老师自助注册（邮箱+密码）
   - 老师导入学生名单 → 激活码
   - 学生学号+激活码首登强制设密 / 密码登录
   - 登录 / 登出 / 改密 / 会话解析

6. **路由 `server/auth/authRoutes.ts`（未改 `server/index.ts`）**
   - `POST /api/auth/register|login|activate|logout|password`
   - `GET  /api/auth/me`
   - `POST /api/auth/students/import`
   - 导出 `tryHandleAuthRoute` 供 coordinator 统一挂载

## 验收

| 检查项 | 结果 |
|--------|------|
| `npx vitest run` | 308 passed / 1 skipped（原 286 + 22 auth） |
| `npm run lint` | 0 errors |
| `npx tsc --noEmit` | 0 errors |
| better-sqlite3 | `^11` 未升 |
| 无 any / 无 `!` 断言 | 遵守 |
| 主装配 | 未改 `server/index.ts` |

## 接线提示（留给 coordinator）

```ts
import { createSessionProvider } from './auth/createSessionProvider'
import { AuthStore } from './auth/AuthStore'
import { AuthService } from './auth/AuthService'
import { tryHandleAuthRoute } from './auth/authRoutes'
import { openMemoryDatabase } from './db/memorySchema'

// AUTH_MODE=real + shared product DB
const db = openMemoryDatabase(memoryDbPath)
const authStore = new AuthStore(db)
const auth = new AuthService(authStore)
const sessions = createSessionProvider({ db, store: authStore })

// inside handleApi, before other routes:
if (await tryHandleAuthRoute(request, response, requestUrl, { auth, sessions })) {
  return
}
```

## 裁决对齐说明

任务摘要曾写「JWT + RealSessionProvider」；正式裁决文档 `T02-auth-system.md` 明确 **HttpOnly Cookie + 服务端会话（不用 JWT）**。实现以裁决为准，cookie 仅承载不透明 session id。
