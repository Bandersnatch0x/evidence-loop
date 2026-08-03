/**
 * player — student player barrel (ticket T-G).
 * The player is the only read-only consumer of demonstration snapshots.
 */
export { StudentPlayer, type StudentPlayerProps } from './StudentPlayer'
export { SvgSceneRenderer, PlayCanvasScene, StaticAlternative, InlinePrimitive3D } from './renderers'
export { VideoOrchestration } from './videoOrchestration'
export { PlayerControls } from './controls'
export * from './determinism'
export * from './budget'
export * from './interactions'
export * from './lazyLoad'
export * from './capabilityProbe'
