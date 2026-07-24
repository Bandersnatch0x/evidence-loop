# T14 教师批量发提示 — 实现报告

## 范围

T08「批量发提示」graduate 为独立消息通道：TeachingUnit 范围内 fan-out + 学生收件箱。
**永不**写 `result.score` / evidence / MasteryProfile。短信/推送/家长端出界。

## 完成

| 层 | 改动 |
|----|------|
| **数据** | SQLite `teacher_tips` + `teacher_tip_deliveries`（migration 0006） |
| **服务** | `TeacherTipStore` / `TeacherTipService`：send fan-out、list、markRead；enrollment 门 + 单元教师归属 |
| **API** | `POST/GET /api/teacher/tips`；`GET /api/student/tips`；`POST /api/student/tips/:id/read` |
| **契约** | `TeacherTip` / `TeacherTipDelivery` / `CreateTeacherTip*` / `StudentTipItem` |
| **UI** | 教师工作台「发提示」标签；学生「我的练习」顶栏「老师提示」收件箱 |
| **铁律测试** | 发 tip 后 Attempt `result` JSON 字节级不变 |

## 验证

| 命令 | 结果 |
|------|------|
| `npx vitest run tests/teacherTips.test.ts` | 11/11 |
| `npx vitest run tests/productDataModel.test.ts` | 9/9（含 legacy Attempt 归一化） |
| `node scripts/e2e-demo-loops.mjs http://127.0.0.1:5280` | 16/16（E2E 同波次修复） |

## 顺带修复（E2E 解锁）

| 问题 | 修复 |
|------|------|
| legacy bare EvaluationResult 行导致 `/api/evaluations` 500 | `AttemptStore.normalizeAttempt` 兼容旧 shape |
| E2E `text=EvidenceLoop` 命中隐藏 mobile header | 改为等 `.sidebar strong` |
| Vite HMR 端口冲突 | `VITE_HMR_PORT` 默认 24679 |

## 出界（未做）

- 短信 / 邮件 / App 推送 / 微信
- 家长端
- AI 自动生成群发文案
- 聊天室 / 多轮对话
