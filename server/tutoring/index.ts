/**
 * T05 three-layer AI tutoring package.
 *
 * Public surface for assembly / tests. Generators are physically isolated from
 * the scoring loop: they only read FeedbackContext and emit TutoringMessage
 * with provenance=llm_inference.
 */

export {
  callOpenAICompatible,
  resolveLlmProvider,
  type CallOpenAICompatibleOptions,
  type ChatMessage,
  type LlmProviderConfig
} from './callOpenAICompatible'
export { ExplainGenerator } from './ExplainGenerator'
export { SocraticGenerator, HELP_ABUSE_THRESHOLD, countLowEffortStreak, trimHistory } from './SocraticGenerator'
export { DialogueGenerator, DIALOGUE_WINDOW } from './DialogueGenerator'
export {
  TutoringService,
  createTutoringService,
  TutoringModeError,
  TutoringNotFoundError,
  type TutoringCallRequest,
  type TutoringServiceOptions
} from './TutoringService'
export { handleTutoringApi, type TutoringRouteContext } from './tutoringRoutes'
export type {
  TutoringGenerator,
  TutoringGeneratorResult,
  TutoringInput,
  TutoringLlmOptions
} from './types'
