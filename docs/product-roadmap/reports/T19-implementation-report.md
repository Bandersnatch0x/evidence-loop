# T19 学习周报 — 实现报告

## 范围

按周生成学生学情周报（JSON + 打印友好 HTML）：完成度、测评趋势、薄弱知识点、
错题 Top、练习活动量、下周建议、教师提示摘录七个固定章节。**每个数字必须可追溯**。

**不做**：AI 编造统计数字、真实姓名/手机号/邮箱进报告、写回 score/evidence/mastery。

## 完成

| 层 | 文件 | 内容 |
|----|------|------|
| **契约** | `shared/weeklyReport.ts` | `WeeklyReport` 全类型 + 固定章节顺序/标题 + 可执行不变量（`findUnbackedMetrics` / `findUnbackedItems` / `isAdvisoryNarrative`）+ 扁平硬事实输入（`WeeklyReportHardFacts`） |
| **纯函数内核** | `server/reports/buildWeeklyReport.ts` | `HardFacts → WeeklyReport`。无 db/store；每个数字锚定扫描样本；缺证据 ≠ 零；全序确定性 |
| **编排** | `server/reports/WeeklyReportService.ts` | 只读端口收集硬事实 → 纯函数生成 → 出口隐私净化；`attachReportNarrative`（provenance + 非空 + PII 三验）只外挂不改数字 |
| **打印** | `server/reports/renderWeeklyReportHtml.ts` | 无依赖纯函数 HTML 渲染（教师 HTML 端点用，另存 PDF） |
| **持久化** | `server/reports/WeeklyReportExportStore.ts` + 迁移 `0015_weekly_report_exports.sql` | 自有导出台账（只记录导出动作，不含报告正文） |
| **HTTP** | `server/reports/weeklyReportRoutes.ts` | 教师 JSON / 教师 HTML / 学生 JSON；三道权限门（角色 → 单元归属 → enrollment） |
| **UI** | `src/components/reports/`（TeacherWeeklyReportPanel / StudentWeeklyReportView / WeeklyReportSections） | 教师选生看报 + 学生自看 + 分节渲染 |
| **测试** | `tests/weeklyReport.test.ts` | 21 项：空态诚实、每个数字挂锚点、确定性、D1 练习不入正式分、narrative 闸门、窗口/隐私/降级、HTTP 形状与 403 |

## 关键设计决策

1. **派生计数锚定扫描样本而非空数组**：`完成 0 次` 的 evidenceRefs 挂的是被扫描的全部 12 次提交——「在这 12 次里完成 0 次」可核对，凭空一个 0 不可核对。
2. **缺证据 ≠ 零**：没有掌握度快照的 KP 不进薄弱章节（与 T18 同口径），绝不当作 0 分。
3. **PII 面收敛**：`Attempt → 扁平事实` 只取硬字段，summary/evidence.actual 等自由文本物理上不进报告；教师提示正文过 PIIDetector，命中即整段隐去；displayName 只允许安全别名。
4. **T18 计划是可选端口**：端口缺失或抛错 →「下周建议」章节降级 `insufficient_evidence`，整份报告照常 200，绝不整份 500。
5. **narrative 引用透传**：`attachReportNarrative` 返回新对象，章节的 metrics/items/series 引用原样透传——LLM 文案在物理上不可能改数字。

## 待接线（本票不改共享 glue 文件，需人工粘贴）

**1. `server/serverTypes.ts`** — `ApiContext` 增加：

```ts
import type { WeeklyReportService } from './reports'
// ApiContext 内：
  weeklyReport: WeeklyReportService
```

**2. `server/serverContext.ts`** — 在 `tips` / `evidenceProjector` 之后构造（依赖 T18 StudyPlanService，接线顺序需在 `studyPlan` 之后）：

```ts
import { WeeklyReportService } from './reports'
// studyPlan 构造之后：
const weeklyReport = new WeeklyReportService({
  attempts: store,
  mastery: memory.mastery,
  mistakes,
  tips,
  org,
  plan: studyPlan
})
// context 对象加：
  weeklyReport,
```

**3. `server/index.ts`** — import + 委托路由段：

```ts
import { handleWeeklyReportApi } from './reports'
```

```ts
  if (await handleWeeklyReportApi(request, response, requestUrl, context)) {
    return
  }
```

**4. `tests/architecture.test.ts`** — 追加守护：`server/reports` 目录不得 import runner/mastery/review/evaluation 写路径（模式写法与 T18/T16 守护一致）。

**5. 前端** — 教师工作台挂 `<TeacherWeeklyReportPanel />`，学生工作台挂 `<StudentWeeklyReportView />`。

## 验证

| 命令 | 结果 |
|------|------|
| `npx tsc --noEmit` | 0 error |
| `npx vitest run tests/weeklyReport.test.ts` | 21/21 通过 |

未跑全量套件（并行工单占用）。

## 出界（未做）

- 周报邮件 / 推送自动发送
- 自定义章节 / 模板编辑器
- LLM 生成统计数字（只允许 narrative 文案）
- 跨学期 / 超 31 天窗口的长报告
