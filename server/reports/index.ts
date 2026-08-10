/**
 * T19 学情周报模块的公共出口。
 *
 * 分层（与 T18 `server/studyPlan/` 完全同构，便于交叉阅读）：
 *   buildWeeklyReport        纯函数内核（硬事实 → 周报，确定性可重放）
 *   WeeklyReportService      只读端口编排（收集硬事实 → 调纯函数 → 隐私净化）
 *   attachReportNarrative    建议层外挂（llm_inference + 非空 + 无 PII 三验）
 *   renderWeeklyReportHtml   打印友好 HTML（纯函数，无依赖）
 *   WeeklyReportExportStore  自有导出台账（迁移 0015）
 *   handleWeeklyReportApi    HTTP 面（教师 JSON / 教师 HTML / 学生 JSON）
 */
export { buildWeeklyReport } from './buildWeeklyReport'
export type { BuildWeeklyReportOptions } from './buildWeeklyReport'
export {
  attachReportNarrative,
  isAcceptableNarrative,
  REDACTED_TIP_TEXT,
  WeeklyReportService
} from './WeeklyReportService'
export type {
  GenerateWeeklyReportOptions,
  WeeklyReportServiceOptions
} from './WeeklyReportService'
export {
  escapeHtml,
  renderWeeklyReportHtml
} from './renderWeeklyReportHtml'
export { WeeklyReportExportStore } from './WeeklyReportExportStore'
export type { WeeklyReportExportStoreOptions } from './WeeklyReportExportStore'
export { handleWeeklyReportApi } from './weeklyReportRoutes'
export type {
  WeeklyReportNarrator,
  WeeklyReportResponse,
  WeeklyReportRouteContext
} from './weeklyReportRoutes'
export {
  WeeklyReportUnitMissingError,
  WeeklyReportWindowError
} from './ports'
export type {
  WeeklyReportAliasReader,
  WeeklyReportAttemptReader,
  WeeklyReportAuditSink,
  WeeklyReportExportEntry,
  WeeklyReportExportRecorder,
  WeeklyReportMasteryReader,
  WeeklyReportMistakeReader,
  WeeklyReportOrgReader,
  WeeklyReportPlanReader,
  WeeklyReportTipReader
} from './ports'
