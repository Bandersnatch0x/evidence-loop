/**
 * T16 跨学科模拟考模块的公共出口。
 *
 * 分层：
 *   assembleMockExam    纯函数内核（硬输入 → 卷面，确定性可重放）
 *   buildPaperReport    纯函数内核（Attempt → 分科报告，只聚合不判分）
 *   MockExamService     只读端口编排 + D2/D4/权限三道闸门
 *   MockExamPlanStore   自有卷面表（迁移 0014）
 *   handleMockExamApi   HTTP 面（教师三个端点 + 学生报告）
 */
export { assembleMockExam } from './assembleMockExam'
export type {
  AssembleMockExamInput,
  AssembleMockExamResult
} from './assembleMockExam'
export { buildPaperReport } from './buildPaperReport'
export type {
  BuildPaperReportInput,
  ReportQuestionMeta
} from './buildPaperReport'
export { MockExamService } from './MockExamService'
export type {
  MockExamServiceOptions,
  SaveMockExamInput,
  SaveMockExamResult,
  SuggestMockExamInput
} from './MockExamService'
export { MockExamPlanStore } from './MockExamPlanStore'
export type { MockExamPlanStoreOptions } from './MockExamPlanStore'
export { handleMockExamApi } from './mockExamRoutes'
export type { MockExamRouteContext } from './mockExamRoutes'
export {
  MockExamForbiddenError,
  MockExamInputError,
  MockExamPlanNotFoundError,
  MockExamUnitNotFoundError
} from './ports'
export type {
  MockExamAssignPort,
  MockExamAttemptReader,
  MockExamMasteryReader,
  MockExamOrgReader,
  MockExamPlanWriter,
  MockExamQuestionReader
} from './ports'
