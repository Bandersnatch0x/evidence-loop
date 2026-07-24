/**
 * T06 adaptive loop public surface.
 * Orchestrates ReviewScheduler + InterventionService + QuestionBank + Attempt
 * into student next-practice and teacher weakness assignment.
 */
export { EvidenceProjector } from './EvidenceProjector'
export type {
  EvidenceProjectorOptions,
  ProjectionResult
} from './EvidenceProjector'
export {
  AssignByWeaknessError,
  AssignByWeaknessService
} from './AssignByWeaknessService'
export type {
  AssignByWeaknessInput,
  AssignByWeaknessServiceOptions
} from './AssignByWeaknessService'
export { NextPracticeService } from './NextPracticeService'
export type {
  GenerateNextPracticeOptions,
  NextPracticeServiceOptions
} from './NextPracticeService'
export {
  InMemoryOrgReader,
  SqliteOrgReader,
  TeachingUnitNotFoundError
} from './OrgReader'
export type { OrgReader } from './OrgReader'
export { handleAdaptiveApi } from './adaptiveRoutes'
export type { AdaptiveRouteContext } from './adaptiveRoutes'
