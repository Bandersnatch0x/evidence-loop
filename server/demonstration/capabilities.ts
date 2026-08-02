/**
 * Capability negotiation — resolve what a device can render against the
 * document's declared capabilities (spec §4.5, §6.9).
 *
 * The player probes: WebGL version, device tier, motion preference.
 * Output is one of four levels: full → simplified → static-alternative → refuse.
 * Negotiation completes BEFORE the player loads any assets.
 */
import type { SceneDocument } from './sceneDocumentSchema'

/** Device probe — the player fills this before loading. */
export interface DeviceCapability {
  webgl: 'webgl2' | 'webgl1' | 'none'
  /** Device tier: 'high' | 'medium' | 'low' (heuristic: GPU / RAM / screen). */
  tier: 'high' | 'medium' | 'low'
  prefersReducedMotion: boolean
  /** Max texture size the device supports (pixels) — drives simplified rendering. */
  maxTextureSize: number
}

export type RenderLevel = 'full' | 'simplified' | 'static-alternative' | 'refuse'

/**
 * Negotiate render level. Pure function — no side effects, no I/O.
 * - full: all capabilities met
 * - simplified: reduce texture/LOD/shadows, drop particles to static
 * - static-alternative: show cover/thumbnail, no animation/3D
 * - refuse: device cannot render safely (show message with static alternative)
 */
export function negotiateCapabilities(
  doc: SceneDocument,
  device: DeviceCapability
): RenderLevel {
  const caps = doc.runtimeVersion.capabilities

  // Refuse if device has no WebGL and doc requires 3D.
  if (device.webgl === 'none' && caps.some((c) => c.startsWith('webgl') || c === 'model3d-skinning')) {
    return 'refuse'
  }
  // Refuse if doc requires webgl2 and device only has webgl1 or none.
  if (caps.includes('webgl2') && device.webgl !== 'webgl2') {
    return 'refuse'
  }
  // Refuse if doc requires webgl1 and device has no WebGL at all.
  if (caps.includes('webgl1') && device.webgl === 'none') {
    return 'refuse'
  }
  // Refuse if doc requires webgpu and device only has webgl.
  if (caps.includes('webgpu') && device.webgl !== 'webgl2') {
    return 'refuse'
  }
  // Refuse if doc requires video and device is low-tier (no video decode).
  if (caps.includes('video') && device.tier === 'low') {
    return 'refuse'
  }
  // Refuse if doc requires physics-deterministic and device is low-tier.
  if (caps.includes('physics-deterministic') && device.tier === 'low') {
    return 'refuse'
  }
  // Refuse if doc requires model3d-skinning and device.webgl is 'webgl1'.
  if (caps.includes('model3d-skinning') && device.webgl !== 'webgl2') {
    return 'refuse'
  }
  // Refuse if doc requires model3d-morph-targets and device.webgl is 'webgl1'.
  if (caps.includes('model3d-morph-targets') && device.webgl !== 'webgl2') {
    return 'refuse'
  }
  // Refuse if doc requires particles and device is low-tier.
  if (caps.includes('particles') && device.tier === 'low') {
    return 'refuse'
  }

  // Static alternative: only when the user prefers reduced motion.
  if (device.prefersReducedMotion) {
    return 'static-alternative'
  }

  // Simplified: medium tier → reduce 3D quality.
  if (device.tier === 'medium' && caps.some((c) => c.startsWith('model3d') || c === 'particles')) {
    return 'simplified'
  }

  return 'full'
}