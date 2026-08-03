/**
 * player/interactions — declarative whitelist interaction interpreter
 * (spec §6.2). The player reads the scene document's interactions and enables
 * exactly the four whitelisted types; anything else is ignored (never
 * executed). Pure functions drive the UI state; the React layer maps state to
 * controls. No arbitrary scripts, no eval, no plugins.
 */
import type { Interaction, Vec3 } from '../../../server/demonstration/sceneDocumentSchema'

export type InteractionState =
  | { type: 'orbit'; enabled: boolean }
  | { type: 'view-switch'; viewpoints: Array<{ label: string; position: Vec3; target: Vec3 }>; index: number }
  | { type: 'step-visibility'; stepIndex: number; total: number }
  | { type: 'pick-highlight'; nodeId: string; picked: boolean }

/** Resolve the initial player state for an interaction (pure). */
export function initialState(interaction: Interaction): InteractionState {
  switch (interaction.type) {
    case 'orbit':
      return { type: 'orbit', enabled: interaction.enabled }
    case 'view-switch':
      return { type: 'view-switch', viewpoints: interaction.viewpoints, index: 0 }
    case 'step-visibility':
      return { type: 'step-visibility', stepIndex: 0, total: interaction.steps.length }
    case 'pick-highlight':
      return { type: 'pick-highlight', nodeId: interaction.nodeId, picked: false }
  }
}

/** Advance a step-visibility state (wrap at ends, deterministic). */
export function nextStep(state: InteractionState): InteractionState {
  if (state.type !== 'step-visibility') return state
  return { ...state, stepIndex: (state.stepIndex + 1) % state.total }
}

export function prevStep(state: InteractionState): InteractionState {
  if (state.type !== 'step-visibility') return state
  return { ...state, stepIndex: (state.stepIndex - 1 + state.total) % state.total }
}

/** Cycle a view-switch state forward. */
export function nextView(state: InteractionState): InteractionState {
  if (state.type !== 'view-switch') return state
  return { ...state, index: (state.index + 1) % state.viewpoints.length }
}

export function togglePick(state: InteractionState): InteractionState {
  if (state.type !== 'pick-highlight') return state
  return { ...state, picked: !state.picked }
}

/**
 * Which node ids should be visible at a given step-visibility step.
 * show[] overrides; hide[] removes. Returns a set of node ids to show.
 */
export function stepVisibilityNodes(interaction: Interaction, stepIndex: number): Set<string> {
  if (interaction.type !== 'step-visibility') return new Set()
  const step = interaction.steps[stepIndex]
  if (!step) return new Set()
  return new Set(step.show)
}

/** Enabled-state check: orbit available only when declared enabled. */
export function orbitEnabled(interaction: Interaction): boolean {
  return interaction.type === 'orbit' && interaction.enabled
}

/** Human label for an interaction (accessibility + UI). */
export function interactionLabel(interaction: Interaction): string {
  switch (interaction.type) {
    case 'orbit':
      return '旋转/缩放'
    case 'view-switch':
      return '视角切换'
    case 'step-visibility':
      return '步骤显隐'
    case 'pick-highlight':
      return '对象高亮'
  }
}
