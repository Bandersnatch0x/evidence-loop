/**
 * T23 能力证据包 / 作品集导出模块的公共出口。
 *
 * 分层（与 T18/T19/T20 完全同构，便于交叉阅读）：
 *   buildPortfolio              纯函数内核（硬事实快照 → 包，确定性可重放）
 *   PortfolioExportService      只读端口编排（收集硬事实 → PII 净化 → 组装）
 *   renderPortfolioReadme       人类可读 README（纯函数）
 *   buildZip / readZipEntry     零依赖 zip 归档（STORE，可测试）
 *   PortfolioExportStore        自有导出台账（迁移 0019）
 *   handlePortfolioApi          HTTP 面（学生导出自己 / 教师导出在读学生）
 *
 * 整个模块的 import 图里没有任何一条边指向 server/mastery、server/review、
 * server/runner、server/tutoring —— 「导出不写分」是结构性成立的。
 */
export { buildPortfolio } from './buildPortfolio'
export type {
  PortfolioAttemptFact,
  PortfolioHardFacts
} from './buildPortfolio'
export {
  PortfolioExportService,
  REDACTED_PORTFOLIO_TEXT
} from './PortfolioExportService'
export type {
  ExportPortfolioOptions,
  PortfolioExportServiceOptions
} from './PortfolioExportService'
export { renderPortfolioReadme } from './renderPortfolioReadme'
export { buildZip, readZipEntry, portfolioFilename } from './zipWriter'
export type { ZipEntry } from './zipWriter'
export { PortfolioExportStore } from './PortfolioExportStore'
export type { PortfolioExportStoreOptions } from './PortfolioExportStore'
export { handlePortfolioApi } from './portfolioRoutes'
export type { PortfolioRouteContext } from './portfolioRoutes'
export {
  PortfolioUnitMissingError,
  UnbackedPortfolioAttemptError
} from './ports'
export type {
  PortfolioAliasReader,
  PortfolioAttemptReader,
  PortfolioAuditSink,
  PortfolioExportEntry,
  PortfolioExportRecorder,
  PortfolioOrgReader,
  PortfolioQuestionReader
} from './ports'
