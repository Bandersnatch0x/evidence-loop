/**
 * Frontend feature flag: multimodal (voice + visual pointing) module.
 *
 * See ADR-0005 Section 8 — all multimodal code MUST be reachable behind
 * a single feature flag so we can fall back to the pre-Phase-1 stable
 * scoring loop by flipping one env var.
 *
 * Default: disabled. Only `"true"` (string) turns it on.
 */

export function isMultimodalEnabled(): boolean {
  return import.meta.env.VITE_MULTIMODAL_ENABLED === 'true'
}
