/**
 * player/determinism — deterministic evaluation helpers for the student player
 * (spec §6.3). The player must produce the same result for the same snapshot on
 * every render: fixed camera/light/material parameters, no random seeds, no
 * environment dependence (only capability-probe-driven render-level changes
 * are allowed). Pure functions only — no I/O, no module state.
 *
 * The player interpolates between keyframes deterministically; easing and
 * step functions are implemented here so tests can lock the math.
 */
import type { Keyframe, Vec3 } from '../../../server/demonstration/sceneDocumentSchema'

export type EasingKind = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'step'

/** Clamp t into [0,1] — the interpolation domain. */
export function clamp01(t: number): number {
  if (t <= 0) return 0
  if (t >= 1) return 1
  return t
}

/**
 * Deterministic easing curves (spec §6.3: fixed curves, no randomness).
 * step returns the previous frame's value until t reaches 1 (holds).
 */
export function applyEasing(kind: EasingKind, t: number): number {
  const x = clamp01(t)
  switch (kind) {
    case 'linear':
      return x
    case 'ease-in':
      return x * x
    case 'ease-out':
      return 1 - (1 - x) * (1 - x)
    case 'ease-in-out':
      return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2
    case 'step':
      return x >= 1 ? 1 : 0
  }
}

/** Linear interpolate between two numbers. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Interpolate two finite vec3 tuples component-wise. */
export function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
}

export type KeyframeValue = number | Vec3 | boolean

/**
 * Resolve a keyframe's value at local time t (seconds) on one track.
 * Deterministic: same (keyframes, t) → same value.
 *
 * Returns { value, progress } where progress is the eased 0..1 between the
 * bracketing keyframes (drives step semantics for boolean/step).
 */
export function sampleTrack(
  keyframes: readonly Keyframe[],
  t: number
): { value: KeyframeValue | undefined; progress: number } {
  if (keyframes.length === 0) return { value: undefined, progress: 0 }
  if (keyframes.length === 1) {
    return { value: keyframes[0]!.value, progress: 1 }
  }
  // Keyframes sorted by time (schema-free: sort defensively, stably).
  const sorted = [...keyframes].sort((a, b) => a.time - b.time)
  if (t <= sorted[0]!.time) return { value: sorted[0]!.value, progress: 0 }
  const last = sorted[sorted.length - 1]!
  if (t >= last.time) return { value: last.value, progress: 1 }

  for (let i = 0; i < sorted.length - 1; i += 1) {
    const a = sorted[i]!
    const b = sorted[i + 1]!
    if (t >= a.time && t <= b.time) {
      const span = b.time - a.time
      const raw = span === 0 ? 1 : (t - a.time) / span
      const eased = applyEasing(a.easing, raw)
      const aValue = a.value
      const bValue = b.value
      // Type-mismatched keyframe values on one track are a doc defect; the
      // player resolves deterministically to the first value (never NaN).
      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return { value: lerp(aValue, bValue, eased), progress: eased }
      }
      if (isVec3(aValue) && isVec3(bValue)) {
        return { value: lerpVec3(aValue, bValue, eased), progress: eased }
      }
      if (typeof aValue === 'boolean' || typeof bValue === 'boolean') {
        // Boolean/step semantics: hold previous until eased progress reaches 1.
        return { value: eased >= 1 ? bValue : aValue, progress: eased }
      }
      return { value: aValue, progress: eased }
    }
  }
  return { value: last.value, progress: 1 }
}

function isVec3(value: unknown): value is Vec3 {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((n) => typeof n === 'number' && Number.isFinite(n))
  )
}

/**
 * Deterministic random generator for particle emitters (spec §4.2: same seed →
 * same result). Mulberry32 — pure, seedable, no Date/Math.random dependence.
 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Deterministic particle positions for a point/box/sphere emitter.
 * Same (kind, count, seed) → same positions, forever.
 */
export function particlePositions(
  kind: 'point' | 'box' | 'sphere',
  count: number,
  seed: number
): Vec3[] {
  const rand = seededRandom(seed)
  const out: Vec3[] = []
  for (let i = 0; i < count; i += 1) {
    const u = rand()
    const v = rand()
    const w = rand()
    if (kind === 'point') {
      out.push([0, 0, 0])
    } else if (kind === 'box') {
      out.push([u * 2 - 1, v * 2 - 1, w * 2 - 1])
    } else {
      // Sphere: uniform on unit sphere (deterministic trig on the seed stream).
      const theta = u * 2 * Math.PI
      const phi = Math.acos(2 * v - 1)
      out.push([
        Math.sin(phi) * Math.cos(theta),
        Math.sin(phi) * Math.sin(theta),
        Math.cos(phi)
      ])
    }
  }
  return out
}
