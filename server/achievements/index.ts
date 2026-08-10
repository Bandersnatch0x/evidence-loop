/**
 * T20 证据驱动轻激励模块的公共出口。
 *
 * 分层（与 T18 同构）：
 *   evaluateAchievements   纯函数内核（硬事实快照 → 徽章，确定性可重放）
 *   AchievementService     只读端口编排（收集硬事实 → 调纯函数 → 落自有表）
 *   attachCongratulation   建议层外挂（llm_inference 祝贺文案，不影响授予）
 *   AchievementStore       自有表（迁移 0016 student_achievements）
 *   handleAchievementApi   HTTP 面（学生成就墙 / sync / 教师聚合计数）
 *
 * 整个模块的 import 图里没有任何一条边指向 server/mastery、server/review、
 * server/runner、server/tutoring —— 「授予徽章不写分」是结构性成立的。
 */
export { evaluateAchievements } from './evaluateAchievements'
export {
  attachCongratulation,
  AchievementService
} from './AchievementService'
export type {
  AchievementServiceOptions,
  AchievementSyncResult,
  EvaluateAchievementsOptions
} from './AchievementService'
export { AchievementStore } from './AchievementStore'
export type { AchievementStoreOptions } from './AchievementStore'
export { handleAchievementApi } from './achievementRoutes'
export type {
  AchievementRouteContext,
  AchievementSummaryResponse,
  AchievementWallResponse
} from './achievementRoutes'
export {
  AchievementUnitMissingError,
  UnbackedAchievementError
} from './ports'
export type {
  AchievementAttemptReader,
  AchievementAwardWriter,
  AchievementMistakeReader,
  AchievementOrgReader,
  AchievementQuestionReader,
  AchievementStudyPlanReader
} from './ports'
