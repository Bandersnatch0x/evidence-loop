# ADR 0017：圆桌动线深化 — hash 路由 / 干预闭环 / cohort 合并 / a11y

## 状态

已采纳（2026-04-12，圆桌辩论 P0-P2 落地）

## 背景

功能矩阵 + 入口操作动线评审（产品 PM / 信息架构师 / 教育专家 / 可访问性
四方圆桌）发现三处代码确证的动线断裂：

1. **状态不可恢复**：`activeView` 仅 `useState`，刷新丢页面。`demoRole`
   走 localStorage 但 view 不走 → 刷新后「角色对、页面错」，比全丢更糟。
2. **模拟考入口断裂**：`StudentPlanHub.onStartMockExam(paperId)` 签名正确，
   但 `App.tsx` 写成 `() => setActiveView('practice')`，paperId 在 App 层
   被丢弃；assessment 语义丢失。
3. **干预→再练闭环断开**：`api.ts` 已导出 `getNextIntervention`，但
   `MasteryView` 零调用——循证环「诊断→干预」前端断。`TeacherTipsInbox`
   的 questionId 只渲染文本，无重练按钮。`TodayPractice` 的
   `onStartQuestion` 类型层连 mode 参数都没有。

另有两处分歧：`teacher-tools` 该否并入 `teaching`；`cohort` 与
`cohort-mastery` 该否合并。

## 决策

### P0 · hash 路由持久化（共识 1）

新增 `src/lib/useHashRoute.ts`：零依赖 hash 路由，序列化
`#role=&view=&questionId=&paperId=`。`useHashRoute` 读初始状态 + 监听
`hashchange`；`useHashWriter` 合并写入。App 用它 seed `activeView`/
`demoRole` 并在变更时写 hash。

不引 `react-router`——demo 级路由用 hash 够，避免新依赖。

### P0 · 模拟考 paperId 透传（共识 2）

`onStartMockExam` 改为 `(paperId) => { writeHash({view:'practice', paperId});
setActiveView('practice') }`。paperId 进 hash 持久化，practice view 的
成套试卷会话列表会展示该 paper。

### P0 · 干预→再练闭环（共识 3）

- `MasteryView`：selectedKpId 变化时调 `getNextIntervention(studentId,
  kpId)`，渲染干预卡（薄弱 KP → 目标 KP + 链路 + 「立即再练」按钮，调
  `onStartQuestion(targetKp, 'practice')`）。
- `TeacherTipsInbox`：加 `onStartQuestion` prop，带 questionId 的 tip 加
  「立即重练」按钮。

ADR-0001 守：干预是建议，永不写 score/evidence。

### P1 · TodayPractice 双模

`onStartQuestion` 签名改 `(questionId, mode) => void`。`QuestionCard` 加
`secondaryActions` 字段。dependency-gap 卡片渲染「测评态」次按钮
（薄弱补链可双模）；fsrs_due 卡片不双模（复习走 ReviewView 1-4 评分，
≠ 新开 attempt）。

### P1 · cohort 合并单入口双 tab（裁决 B）

新增 `CohortShell`：overview / mastery matrix 两个 tab。导航层合并
（Sidebar 删 cohort-mastery 顶级项）；组件层保留（CohortView 与
CohortMasteryView 各自维持数据获取逻辑——二者获取路径本就分叉）。
`cohort-mastery` 保留为 AppView 兼容 legacy hash，落地 mastery tab。

### P1 · Sidebar roving tabindex + 方向键

primary-nav 实现 roving tabindex：仅 active 项 tabIndex=0，其余 -1；
方向键 ↑↓←→ 移焦点。对齐 WorkspaceTabs 的键盘模型。

### P2 · teacher-tools 保留为工具箱（裁决 A）

不并入 teaching——teaching 的 `requiresUnit` 门控是产品叙事骨架
（线性出题流），并入 4 个无门控工具会破坏门控 + 撑大首屏 chunk
（TeacherStudio 已 lazy 拆 chunk 证明体积压力）。保留顶级入口。

### P2 · reviewer 角色前端入口

新增 `reviewer` AppView + Sidebar nav 项（教师/管理员可见）。占位
指向 `/api/reviewer/queue`。reviewer 是 flag（`public_library_reviewer`）
不是 DemoRole，此处仅占位，真正门控在后端 `authorizeAccess`。

## 后果

### 正面
- 刷新状态可恢复（hash 持久化）。
- 模拟考 paperId 不再吞没。
- 循证环诊断→干预→再练前端连通。
- 班级学情入口从 6 降到 5（cohort 合并）。
- 键盘导航对齐 roving tabindex 模型。

### 负面
- hash 路由是 demo 级方案（无嵌套路由、无 URL params 类型）。生产化前
  需评估是否升级 react-router（或保持 hash + 扩展）。
- reviewer 入口仅占位，真实审核 UI 仍走 API。

## e2e

圆桌动线深化后全量 e2e 通过（17/18，PlayCanvas 3D viewport 测
偶发 WebGL 渲染时序 flaky，单跑绿，非回归）。

此前失败的「teacher question editor」测已修：根因是 demo teacher
（`teacher-demo`）题库列表按 `authorId` 过滤，seed 题 author 是
`system-builtin`，列表为空。修复：`QuestionBankService.list` 现返回
teacher 自己题 + seed 题（只读）；`QuestionSummary` 加 `authorId` 字段；
`QuestionBankPanel` 对 seed 题（`system-builtin`）禁用编辑/删除按钮，标
「预置库 · 只读」；e2e 测创建 teacher-owned 题再编辑。

## 守护
- `tests/App.test.tsx` 守 hash router 初始化 + 导航。
- `tests/masteryView.test.tsx` 守 MasteryView 干预渲染（mock
  getNextIntervention）。
- `tests/extractedHandlersContract.test.ts` 守路由 handler seam。
- 圆桌 P0-P2 的 vitest 1406 passed（6 docker-skipped）。
