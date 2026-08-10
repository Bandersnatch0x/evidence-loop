/**
 * T18 硬事实学习计划模块的公共出口。
 *
 * 分层：
 *   buildStudyPlan          纯函数内核（硬输入 → 计划，确定性可重放）
 *   StudyPlanService        只读端口编排（收集硬事实 → 调纯函数）
 *   attachPresentationHint  建议层外挂（llm_inference，不影响 tasks）
 *   StudyPlanSnapshotStore  自有快照表（迁移 0013），纯缓存
 *   handleStudyPlanApi      HTTP 面（学生 / 教师四个端点）
 */
export { buildStudyPlan } from './buildStudyPlan'
export type { BuildStudyPlanOptions } from './buildStudyPlan'
export {
  attachPresentationHint,
  StudyPlanService
} from './StudyPlanService'
export type {
  GenerateStudyPlanOptions,
  StudyPlanServiceOptions
} from './StudyPlanService'
export { StudyPlanSnapshotStore } from './StudyPlanSnapshotStore'
export type { StudyPlanSnapshotStoreOptions } from './StudyPlanSnapshotStore'
export { handleStudyPlanApi } from './studyPlanRoutes'
export type {
  StudyPlanAssignPort,
  StudyPlanResponse,
  StudyPlanRouteContext
} from './studyPlanRoutes'
export { TeachingUnitMissingError } from './ports'
export type {
  DependencyGapReader,
  DueCardReader,
  StudyPlanMasteryReader,
  StudyPlanOrgReader,
  StudyPlanQuestionReader,
  StudyPlanSnapshotWriter
} from './ports'
