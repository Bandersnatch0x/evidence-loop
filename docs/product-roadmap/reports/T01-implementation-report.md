# T01 产品数据模型演进 — 实现报告

## 完成内容

1. **`shared/contracts.ts`**
   - `EvidenceSource` + `EvidenceItem.source` 必填（D2）
   - 组织模型：`Term` / `Class` / `Subject` / `TeachingUnit` / `Enrollment`
   - 人：`Person` / `User`（`student` | `teacher`）
   - `SessionMode` + **`Attempt` 聚合根**（内嵌 `EvaluationResult`）

2. **Drizzle ORM（TS-first schema + SQL migrations）**
   - 依赖：`drizzle-orm@^0.44` + `drizzle-kit@^0.31`；**`better-sqlite3` 保持 `^11`**
   - `server/db/schema.ts` — TS schema
   - `server/db/migrations/0001_memory_layer.sql` — 收编 mastery/review/evaluations
   - `server/db/migrations/0002_product_org.sql` — users/terms/classes/teaching_units/enrollments/attempts
   - `server/db/migrate.ts` + `memorySchema.ts` 走 idempotent `schema_migrations` 路径

3. **Expand-contract 存储**
   - 保留 `JsonEvaluationStore`
   - 新增 `JsonAttemptStore`（`AttemptStore extends EvaluationStore`）
   - `evaluationToLegacyAttempt`：裸 EvaluationResult 默认 `mode: 'assessment'`

4. **Mastery 投影器 mode 分流（铁律）**
   - `MasteryService.collectEvidence`：AttemptStore 路径下 **`mode !== 'assessment'` 直接跳过**
   - practice 不进正式 MasteryProfile；FSRS 仍可走 `applyFromEvaluation`（未改 review 路径）
   - `tests/architecture.test.ts` 守护 computeMastery 签名 + MasteryService 过滤

5. **媒体内容寻址**
   - `data/media/.gitkeep`
   - `server/media/paths.ts`：`media/<sha256>.<ext>` 路径工具

## 验收

| 检查项 | 结果 |
|--------|------|
| `npm test` | 286 passed / 1 skipped（原 276 + 新增） |
| `npm run lint --max-warnings 0` | 0 errors |
| `npx tsc --noEmit` | 0 errors |
| practice 不进掌握度 | 架构测试 + `productDataModel.test.ts` |
| better-sqlite3 | `^11.10.0`（未升 v13） |

## 未做（有意留给后续波次）

- HTTP API 尚未切换到 `AttemptStore`（仍用 `JsonEvaluationStore`；并存就绪）
- 未改 `server/runner/*`、`server/multimodal/*`、`server/advisory/*`、`src/*`
- 无 SQLite Attempt 持久化实现（JSON AttemptStore 已就位；表已建）
- OCR 写入 media 字节（仅路径约定 + 目录）
