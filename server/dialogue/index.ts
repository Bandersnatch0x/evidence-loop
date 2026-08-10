/**
 * T21 persona dialogue inquiry package.
 *
 * Public surface for assembly / tests. The dialogue module is physically
 * isolated from the scoring loop: it only reads the fixed PERSONA_CATALOG and
 * writes its own tables (personas mirror / dialogue_sessions / dialogue_turns).
 * Every assistant reply is stamped llm_inference provenance (ADR-0006); the
 * module never imports AttemptStore / mastery / review / runner.
 */

export {
  PersonaDialogueService,
  type PersonaDialogueServiceOptions
} from './PersonaDialogueService'
export {
  LlmPersonaDialogueGenerator,
  TemplatePersonaDialogueGenerator,
  PERSONA_TEMPLATE_MODEL,
  computeLowEffortStreak,
  type PersonaDialogueDraft,
  type PersonaDialogueGenerator,
  type PersonaDialogueInput
} from './PersonaDialogueGenerator'
export { DialogueStore, createTurnId, type DialogueStoreOptions } from './DialogueStore'
export {
  handleDialogueApi,
  type DialogueRouteContext
} from './dialogueRoutes'
export {
  DialogueModeError,
  DialoguePersonaNotFoundError,
  DialogueRoundLimitError,
  DialogueSessionClosedError,
  DialogueSessionForbiddenError,
  DialogueSessionNotFoundError,
  type DialogueSessionRecord,
  type DialogueSessionWriter
} from './ports'
import { DialogueStore } from './DialogueStore'
import { PersonaDialogueService } from './PersonaDialogueService'
import type { Database } from 'better-sqlite3'

/** 工厂：给定 sqlite 库，构造可直接接线的对话服务（仅 practice 态）。 */
export function createPersonaDialogueService(options: {
  database: Database
  now?: () => Date
}): PersonaDialogueService {
  return new PersonaDialogueService({
    store: new DialogueStore({ database: options.database }),
    ...(options.now ? { now: options.now } : {})
  })
}
