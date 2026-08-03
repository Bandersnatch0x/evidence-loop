/**
 * player/capabilityProbe — client-side device capability probe (spec §6.9).
 * Runs BEFORE any asset load; the result drives the render level. Pure-ish:
 * DOM access isolated here so the rest of the player stays testable with
 * injected probes.
 */
import type { DeviceCapability, RenderLevel } from '../../../server/demonstration/capabilities'

/** Detect WebGL support without creating a visible context. */
export function detectWebGL(): 'webgl2' | 'webgl1' | 'none' {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return 'none'
  }
  try {
    const canvas = document.createElement('canvas')
    const gl2 = canvas.getContext('webgl2')
    if (gl2) return 'webgl2'
    const gl1 = canvas.getContext('webgl')
    if (gl1) return 'webgl1'
    return 'none'
  } catch {
    return 'none'
  }
}

/** Detect device tier by heuristic: screen size + cores + memory. */
export function detectTier(): 'high' | 'medium' | 'low' {
  if (typeof navigator === 'undefined') return 'high'
  const cores = navigator.hardwareConcurrency ?? 4
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 4
  if (cores <= 2 || mem <= 2) return 'low'
  if (cores <= 4 || mem <= 4) return 'medium'
  return 'high'
}

export function detectReducedMotion(): boolean {
  if (typeof matchMedia === 'undefined') return false
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** Max texture size heuristic (2K on low, 4K on medium+, 8K high). */
export function detectMaxTextureSize(tier: 'high' | 'medium' | 'low'): number {
  if (tier === 'low') return 2048
  if (tier === 'medium') return 4096
  return 8192
}

/** Full client probe — the single entry point for the player. */
export function probeDevice(): DeviceCapability {
  const webgl = detectWebGL()
  const tier = detectTier()
  return {
    webgl,
    tier,
    prefersReducedMotion: detectReducedMotion(),
    maxTextureSize: detectMaxTextureSize(tier)
  }
}

/**
 * Degradation ladder (spec §6.9): full → simplified → static-alternative →
 * refuse. The player maps render level to renderer; a static alternative is
 * the same path as the accessibility text alternative (spec §6.10: merged).
 */
export function renderLevelLabel(level: RenderLevel): string {
  switch (level) {
    case 'full':
      return '完整渲染'
    case 'simplified':
      return '简化渲染'
    case 'static-alternative':
      return '静态替代'
    case 'refuse':
      return '无法安全渲染'
  }
}
