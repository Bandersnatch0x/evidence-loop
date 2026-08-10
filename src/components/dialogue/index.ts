/**
 * T21 persona dialogue inquiry — frontend public surface.
 *
 * Panel is self-contained: it fetches from /api/personas and
 * /api/practice/dialogue/* and renders the chat UI with the
 * 「练习探究 · 不计入测评」top banner. Mounting into App.tsx / Sidebar /
 * knowledge-point pages is glued by the main line (see T21-implementation-report).
 */

export { PersonaDialoguePanel } from './PersonaDialoguePanel'
export {
  closeDialogue,
  listPersonas,
  openDialogue,
  sendDialogueTurn,
  type PersonaListResponse
} from './personaDialogueApi'
