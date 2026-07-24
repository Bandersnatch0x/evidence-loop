# T06 学情自动闭环（推题引擎通电）— 实现报告

## 完成内容

### 1. `server/adaptive/` 编排层（产品闭环，零重写 FSRS/依赖链）

| 模块 | 职责 |
|------|------|
| `NextPracticeService` | 学生「今天该练的」：FSRS due → 依赖链薄弱点 → **D4 `taughtKpIds` 过滤** → 题库按 KP+难度选题 |
| `AssignByWeaknessService` | 老师一键按全班薄弱点布置：聚合班级薄弱 KP（∩ taught）→ `assembleByKnowledgePoints` → 批量 Attempt 占位 |
| `EvidenceProjector` | **D1 双模投影**：practice/assessment 都喂 FSRS；**仅 assessment** 写正式 MasteryProfile |
| `OrgReader` / `SqliteOrgReader` / `InMemoryOrgReader` | 读 TeachingUnit / Enrollment（复用 T01 表） |
| `adaptiveRoutes` | `GET /api/adaptive/next`、`POST /api/adaptive/assign-weakness`（与 T02/T03 同款独立挂载） |

### 2. 合约（`shared/contracts.ts`）

- `NextPracticePlan` / `NextPracticeItem` / `PracticePrioritySource`
- `AssignWeaknessRequest` / `AssignWeaknessResult`

### 3. 算法要点（守 D1 / D4）

1. **FSRS due**（`ReviewScheduler.listDue`）最高优先；未教 KP 丢弃。
2. **依赖链**（`InterventionService.suggestNextIntervention`）：目标 KP 必须也在 `taughtKpIds` 内，否则回退到已教 weakKp，**绝不推未教前置**。
3. **题库耦合**：只决策 KP+优先级；题目经 `QuestionStore.list({ authorId, kpIds, difficulty })` 选取（教师私有库）。
4. **布置占位**：`status: 'rejected' / rejectionReason: 'assigned_not_started'`，默认 `mode: 'practice'`（巩固喂调度、不进测评掌握度）；可选 `assessment`。

### 4. 测试

`tests/adaptiveLoop.test.ts` — 11 例：

- NextPractice：FSRS 优先 + D4 过滤、依赖链填槽、未教前置不推、空 taught 空队列
- AssignByWeakness：班级聚合 + 批量 Attempt、显式 kpIds ∩ taught、教师所有权
- EvidenceProjector：practice 只喂 FSRS；assessment 双写
- HTTP：next 学生可见 / 跨学生 403、assign-weakness 教师 201 / 学生 403

## 验收

| 检查项 | 结果 |
|--------|------|
| `npm test` | **364 passed** / 1 skipped（原 353 + 新增 11） |
| `eslint server/adaptive tests/adaptiveLoop.test.ts shared/contracts.ts` | **0 errors** |
| T06 相关 `tsc` | **无错误** |
| 全仓 `npm run lint` / `tsc --noEmit` | **红于 `server/import/*`（T04 并行产出，本工单禁改）** |
| better-sqlite3 | 仍为 `^11` |
| 未改 | `server/tutoring/`、`server/import/`、`server/auth/`、`src/`、`server/mastery/*` 算法体、`server/review/*` |

## 未做（有意留给装配 / 后续波次）

- 未把 `handleAdaptiveApi` 挂进 `server/index.ts`（与 T02/T03 一致，由协调器统一装配）
- 主 evaluate 路径仍走 legacy `JsonEvaluationStore`；`EvidenceProjector` 供 Attempt 路径复用
- 班级学情矩阵 UI（T08）/ 学生「今日练习」页（T07）未做前端

## 挂载示例（协调器）

```ts
import {
  handleAdaptiveApi,
  NextPracticeService,
  AssignByWeaknessService,
  SqliteOrgReader
} from './adaptive'
// after session resolve:
if (await handleAdaptiveApi(req, res, url, {
  nextPractice, assignByWeakness, user
})) return
```
