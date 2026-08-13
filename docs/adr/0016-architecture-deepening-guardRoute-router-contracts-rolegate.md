# ADR 0016：架构深化 — guardRoute / 路由纵切 / contracts 分域 / RoleGate

## 状态

已采纳（2026-04-12，架构评审 C1-C4 落地）

## 背景

随 T01-T23 接线收口，`server/index.ts` 膨胀至 1116 行，混合三种职责：
HTTP 入口、Vite 中间件、生产静态资源、错误信封、**以及 8 条内联路由**（cohort /
audit / mastery / interventions / review / multimodal / assignments）。这 8 条
内联路由各自手写同一套 authorize→audit-denied→403 仪式——`index.ts` 内
8× `authorizeAccess` + 18× `createRouteAuditor`，且 reviewer-isolated 拒绝消息
在 9 处手工拷贝，已是 message-drift 的 bug magnet。

同时：
- `shared/contracts.ts` 单文件 1280 行 / 109 个导出，跨所有 bounded context
  （Evaluation / Attempt / Mastery / Tutoring / Teacher …），无 seam，无 locality。
- `src/App.tsx` 8 个视图分支各自重复 `demoRole === 'student' ? <View/> : <denied/>`
  仪式，Sidebar 已在 nav item 上携带 `roles[]`，App 重新实现一遍。

评审经 deletion test 确认四处都是 shallow pattern（删除后复杂度在 N 处重现，
不集中）。

## 决策

### 1. guardRoute 深模块（C1，Strong）

新增 `server/http/guardRoute.ts`。一个接口：
`guardRoute({db,audit,user,response,request,action,resourceType,forbidden,studentId?})`
→ `{allowed:false}`（已写 403 + denied-audit）或 `{allowed:true,auditor}`。

authorize + denied-audit + 403 消息映射（role / reviewer-isolated / student-isolated）
全部藏在实现里。`reviewer-isolated` 消息漂移从 9 拷贝收为 1 处。

### 2. 内联路由纵切（C2，Strong）

8 条内联路由抽到与 `evaluationRoutes`（C1 #36）相同的 `handle*Api → boolean`
seam 之后：`handleAssignmentApi` / `handleCohortApi` / `handleKnowledgeApi` /
`handleAuditApi` / `handleMultimodalApi` / `handleMasteryApi` / `handleReviewApi`。

`server/index.ts` 从 1116 行降至 623 行，成为纯 dispatcher：resolve URL → 有序
try 每个 handler → 404。dispatcher 的接口是「有序 try」——一个 pattern，N 个
实现藏在后面。

### 3. contracts 分域（C3，Worth exploring）

`shared/contracts.ts`（1280 行 / 109 导出）按 CONTEXT.md bounded context 拆为
11 个子模块：`evaluation` / `mastery` / `org` / `question` / `visualization` /
`knowledge` / `import` / `adaptive` / `tutoring` / `practice` / `teacher`。

`shared/contracts.ts` 保留为 barrel `export * from './contracts/index'`，~140 个
旧 import 路径**零改动**。每个 context 现在是独立 module，有自己 seam。

### 4. RoleGate 深模块（C4，Worth exploring）

新增 `src/components/RoleGate.tsx` + `rolePredicates.ts`。接口：
`<RoleGate role={demoRole} allow={['student']} deniedMessage="...">{children}</RoleGate>`

App.tsx 8× 重复 ternary 收为 `<RoleGate>`。`isStudentRole` / `isTeacherRole`
predicate 独立文件，Sidebar 与 App 共用单一 allow 来源。

### 5. ApiContext god-bag（C5，Speculative）

报告列为 Speculative，明确依赖 C2 完成后再评估。**本次不做**。现状
（compose → flat bag → slice per handler）是常见可接受形态；贸然拆 facade 可能
只是把 slicing 搬地方，不集中复杂度。

## 后果

### 正面
- **locality**：authorize→audit 策略集中 `guardRoute`；cohort 逻辑在 cohort 路由；
  WeeklyReport 类型改动不再触碰 Evaluation。
- **leverage**：64 处仪式 → 1 接口；8 处 ternary → 1 组件；109 类型 1 文件 → 11 seam。
- **testability**：interface is the test surface——guardRoute / RoleGate 各自单测。
- **AI-navigable**：index.ts 纯 dispatcher；contracts 按 concept 分文件。
- **message drift 消除**：reviewer-isolated 拒绝文案一处定义。

### 负面
- contracts 拆分跨模块 import 增多（barrel 兜底，零调用方改动）。
- 新 handler 文件数 +7，初看目录更碎——但每个文件职责单一，deletion test 通过。

## 验证基线
- `tsc --noEmit` 0 error
- `eslint` 0 error（4 react-refresh warning 已清，predicates 分文件）
- `vitest run` 141 文件 / 1389 passed / 6 docker-skipped（环境相关）

## 守护
- `tests/routeOrder.test.ts` 守 Effort 2 委托顺序（已绿）。
- `tests/architecture.test.ts` 守评分隔离 + assignment display layer（已更新指向
  `assignmentRoutes.ts`，已绿）。
- `tests/guardRoute.test.ts` 守 authorize→audit→403 仪式契约。
- `tests/RoleGate.test.tsx` 守 role-gate 行为。

未来若有人把内联回填 index.ts 或在路由里手写 authorize→403，routeOrder /
architecture 守护会先报警；guardRoute 是新路由的默认路径。
